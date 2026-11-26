import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.agents.issuer_agent import IssuerAgent
from app.config import Policy
from app.integrations.providers import DEMO_TIMES, MockProviders, SnapshotProvider, synthetic_borrowers
from app.integrations.signing import (RecommendationSigner, canonical_bytes, evidence_hash, signing_payload)
from app.market_sessions.oracle_health import assess_oracle
from app.market_sessions.session_detector import detect_session
from app.market_sessions.session_policy import adjustment
from app.models import (Assessment, AssessRequest, Metrics, Recommendation, RiskEvent, Scenario,
                        SimulateRequest, SimulationResult, Snapshot)
from app.optimiser.parameters import RuleBasedOptimiser
from app.risk.issuer import issuer_risk
from app.risk.liquidity import bid_ask_spread, deterioration, execute_bids, market_depth, price_divergence
from app.risk.recoverable_value import recoverable_value
from app.risk.scoring import score_risk
from app.risk.volatility import historical_volatility, maximum_drawdown, momentum
from app.services.store import AuditStore
from app.simulation.portfolio import default_scenarios, simulate

logger = logging.getLogger(__name__)
ASSETS = {"NVDA": "BNB_STOCK_NVDA", "NVDAB": "BNB_STOCK_NVDA", "BNB_STOCK_NVDA": "BNB_STOCK_NVDA"}


class UnsupportedAsset(ValueError):
    pass


class RiskService:
    def __init__(self, policy: Policy, store: AuditStore, provider: SnapshotProvider | None = None,
                 agent: IssuerAgent | None = None, signer: RecommendationSigner | None = None,
                 chain_id: int = 56, market_id: str = "DEMO_NVDA_MARKET_NOT_DEPLOYED",
                 assets: dict[str, str] | None = None):
        self.policy, self.store = policy, store
        self.assets = dict(ASSETS if assets is None else assets)
        self.provider, self.agent = provider or MockProviders(), agent or IssuerAgent()
        self.signer, self.chain_id, self.market_id = signer, chain_id, market_id
        self.optimiser = RuleBasedOptimiser(policy)

    def asset_id(self, asset: str) -> str:
        if asset.upper() not in self.assets:
            raise UnsupportedAsset("Unsupported collateral asset for this service")
        return self.assets[asset.upper()]

    def resolve(self, asset: str, request: AssessRequest) -> Snapshot:
        asset = self.asset_id(asset)
        if request.snapshot:
            if self.asset_id(request.snapshot.asset) != asset:
                raise ValueError("Snapshot asset does not match route")
            if request.as_of and request.as_of != request.snapshot.market.as_of:
                raise ValueError("Request time conflicts with snapshot time")
            # HTTP callers cannot promote user-supplied evidence to trusted/live observations.
            snapshot = request.snapshot.model_copy(deep=True)
            snapshot.asset = asset
            for source in [snapshot.market.source, snapshot.oracle.source] + [d.source for d in snapshot.documents]:
                source.simulated = True
                source.description = "Client-supplied, unverified scenario input; not a trusted live feed."
            return snapshot
        at = request.as_of or (DEMO_TIMES[request.scenario] if request.scenario != "baseline" else datetime.now(timezone.utc))
        return self.provider.snapshot(asset, at, request.scenario, request.oracle_mode)

    def assess(self, asset: str, request: AssessRequest) -> tuple[Assessment, Snapshot]:
        snapshot = self.resolve(asset, request)
        m, oracle, p = snapshot.market, snapshot.oracle, self.policy
        quality = []
        prices = [point.price for point in m.history]
        if len(prices) < p.min_history_points:
            quality.append("Insufficient daily-close history")
        if not m.history or (m.as_of - m.history[-1].at).total_seconds() > p.history_max_age_hours * 3600:
            quality.append("Daily-close history missing or too old")
        if m.history and any(not 12 * 3600 <= (b.at - a.at).total_seconds() <= 7 * 86400
                             for a, b in zip(m.history, m.history[1:])):
            quality.append("History cadence is not daily exchange closes")
        market_stale = not m.market_observed_at or (m.as_of - m.market_observed_at).total_seconds() > p.market_max_age_seconds
        if market_stale:
            quality.append("Executable token market quotes missing or stale")
        if m.data_degraded:
            quality.append("Provider reports degraded market data")
        vol = historical_volatility(prices) if not any("history" in q.lower() or "cadence" in q for q in quality) else None
        session = detect_session(m.as_of, p, halted=m.halted, degraded=m.data_degraded or market_stale)
        freshness = (p.oracle_max_age_by_regime or {}).get(session.protocol_regime, p.oracle_max_age_seconds)
        oracle_health = assess_oracle(oracle, m.as_of, p, freshness)
        if not oracle_health.available:
            quality.append("Oracle observation unavailable")
        events = self.agent.analyse(snapshot.asset, snapshot.documents)
        events.append(RiskEvent(asset=snapshot.asset, event_type="MARKET_SESSION", severity="MODERATE",
                                description=adjustment(session, p).reason, confidence=1,
                                source="calendar://NASDAQ", evidence=f"{m.as_of.isoformat()} -> {session.effective_session}",
                                requires_review=False, simulated=m.source.simulated))
        if oracle_health.stale:
            events.append(RiskEvent(asset=snapshot.asset, event_type="ORACLE_STALE", severity="HIGH",
                                    description="Oracle missing/stale; recent publication does not prove a fresh observation",
                                    confidence=1, source=oracle.source.reference,
                                    evidence=f"observed_at={oracle.observed_at}; published_at={oracle.published_at}",
                                    simulated=oracle.source.simulated))
        token_mid = (m.token_bid + m.token_ask) / 2
        oracle_price = oracle.normalized_price
        reference = min(m.underlying_price, token_mid, oracle_price or m.underlying_price)
        token_divergence = price_divergence(token_mid, m.underlying_price)
        oracle_divergence = price_divergence(oracle_price, reference) if oracle_price else 1
        if max(token_divergence, oracle_divergence) > p.max_price_divergence:
            quality.append("Oracle/token reference divergence exceeds policy tolerance")
        oracle_health.risk_score = max(oracle_health.risk_score, min(100, oracle_divergence * 500))
        execution = execute_bids(request.liquidation_quantity, reference, m.bids, 0 if market_stale else 1)
        metrics = Metrics(annualised_volatility=vol, maximum_drawdown=maximum_drawdown(prices), momentum=momentum(prices),
                          spread=bid_ask_spread(m.token_bid, m.token_ask), volume_24h_usd=m.volume_24h_usd,
                          depth_usd=0 if market_stale else market_depth(m.bids),
                          expected_liquidation_slippage=execution.slippage, executable_fraction=execution.fraction,
                          price_divergence=token_divergence, oracle_price_divergence=oracle_divergence,
                          reference_to_protocol_price=min(1, reference / oracle_price) if oracle_price else 0,
                          liquidity_deterioration=deterioration(m))
        issuer_score, issuer_haircut, _ = issuer_risk(events, p)
        score = score_risk(metrics, issuer_score, oracle_health, m.concentration, quality, p)
        issuer_confidences = [e.confidence for e in events if e.event_type not in {"MARKET_SESSION", "ORACLE_STALE"}]
        if issuer_confidences:
            score.confidence = min(score.confidence, min(issuer_confidences))
        recovery = recoverable_value(request.liquidation_quantity, reference, m.bids, vol, adjustment(session, p),
                                     issuer_haircut, oracle_health.haircut, score.confidence, p,
                                     liquidity_multiplier=0 if market_stale else 1)
        sources = [m.source, oracle.source] + [d.source for d in snapshot.documents]
        evidence = {"snapshot": snapshot.model_dump(mode="json"), "policy": p.model_dump(mode="json"),
                    "events": [e.model_dump(mode="json") for e in events], "liquidation_quantity": request.liquidation_quantity}
        assessment = Assessment(assessment_id=str(uuid4()), asset=snapshot.asset, as_of=m.as_of,
                                simulated=any(s.simulated for s in sources), session=session, oracle=oracle_health,
                                metrics=metrics, score=score, recovery=recovery, events=events, sources=sources,
                                evidence_hash=evidence_hash(evidence), configuration_version=p.fingerprint,
                                model_version=p.model_version)
        self.store.put("assessment", snapshot.asset, m.as_of.isoformat(),
                       {"assessment": assessment.model_dump(mode="json"), "evidence": evidence})
        logger.info("Assessed asset=%s id=%s score=%.2f simulated=%s", snapshot.asset, assessment.assessment_id,
                    score.overall, assessment.simulated)
        return assessment, snapshot

    def latest(self, asset: str) -> Assessment | None:
        rows = self.store.history("assessment", self.asset_id(asset), 1)
        return Assessment.model_validate(rows[0]["assessment"]) if rows else None

    def simulate(self, asset: str, request: SimulateRequest) -> tuple[Assessment, list[SimulationResult]]:
        assessment, snapshot = self.assess(asset, request)
        borrowers = request.borrowers if request.borrowers is not None else synthetic_borrowers()
        scenarios = request.scenarios if request.scenarios is not None else default_scenarios()
        return assessment, [simulate(assessment, snapshot, borrowers, s, self.policy) for s in scenarios]

    def recommend(self, asset: str, request: SimulateRequest) -> Recommendation:
        assessment, snapshot = self.assess(asset, request)
        return self.recommend_assessed(assessment, snapshot, request)

    def recommend_assessed(self, assessment: Assessment, snapshot: Snapshot, request: SimulateRequest) -> Recommendation:
        """Reuse one evidence snapshot for the frontend summary and stress results."""
        parameters, reasons = self.optimiser.recommend(assessment)
        borrowers = request.borrowers if request.borrowers is not None else synthetic_borrowers()
        impact = simulate(assessment, snapshot, borrowers, Scenario(name="proposed_router_policy",
                          proposed_parameters=parameters), self.policy)
        # Replay expiry is tied to evidence time, not the wall-clock invocation time.
        data = dict(recommendation_id=str(uuid4()), asset=assessment.asset, chain_id=self.chain_id,
                    market_id=self.market_id, risk_score=assessment.score.overall,
                    risk_category=assessment.score.category, recommended_parameters=parameters.model_dump(mode="json"),
                    parameter_scope="ADVISORY_ROUTER_AND_VAULT_LIMITS_IMMUTABLE_MARKET_LLTV" if self.policy.immutable_threshold else "GOVERNANCE_PROPOSAL_MUTABLE_MARKET",
                    reasoning=reasons, simulation=impact.model_dump(mode="json"), approval_required=True,
                    approval_status="PENDING_REVIEW", timestamp=assessment.as_of.isoformat(),
                    expires_at=(assessment.as_of + timedelta(seconds=self.policy.recommendation_ttl_seconds)).isoformat(),
                    evidence_hash=assessment.evidence_hash, data_source_references=[s.model_dump(mode="json") for s in assessment.sources],
                    configuration_version=self.policy.fingerprint, model_version=self.policy.model_version,
                    confidence=assessment.score.confidence, simulated=assessment.simulated)
        # Serialize through the response model before hashing (UTC dates normalize to Z).
        envelope = Recommendation(**data, payload_hash="", signing_status="UNSIGNED")
        payload = signing_payload(envelope.model_dump(mode="json"), self.chain_id, self.market_id)
        signature = self.signer.sign(canonical_bytes(payload)) if self.signer else None
        recommendation = Recommendation.model_validate(envelope.model_dump() | {
            "payload_hash": evidence_hash(payload), "signature": signature,
            "signing_status": "SIGNED" if signature else "UNSIGNED"})
        self.store.put("recommendation", assessment.asset, assessment.as_of.isoformat(), recommendation.model_dump(mode="json"))
        return recommendation

    def recommendations(self, asset: str, limit: int = 100) -> list[Recommendation]:
        return [Recommendation.model_validate(r) for r in self.store.history("recommendation", self.asset_id(asset), limit)]
