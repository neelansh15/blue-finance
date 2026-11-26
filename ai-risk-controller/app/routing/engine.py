"""Advisory destination selection; pause scopes propagate across configured exposures."""
from datetime import timedelta
from uuid import uuid4
from app.integrations.signing import evidence_hash
from app.integrations.market_status import LiveMarketStatusProvider
from app.models import Assessment, Session
from app.risk.issuer import issuer_risk
from app.routing.models import MarketEvaluation, RoutingDecision, RoutingPolicy, RoutingRequest
from app.services.risk_service import RiskService


def route_markets(service: RiskService, asset: str, request: RoutingRequest, policy: RoutingPolicy,
                  status_provider: LiveMarketStatusProvider | None = None) -> RoutingDecision:
    targets = {t.target_id: t for t in policy.targets}
    if any(m.target_id not in targets for m in request.markets):
        raise ValueError('Market input is not in the server-configured destination registry')
    primary = targets[request.primary_target_id]
    if service.asset_id(asset) != primary.collateral_asset:
        raise ValueError('Primary target collateral must match the route asset')
    if primary.chain_id != service.chain_id or primary.loan_asset != 'USDT':
        raise ValueError('Primary target must use the configured chain and USD-valued USDT debt')
    if request.status_mode == 'LIVE':
        if status_provider is None:
            raise ValueError('Live routing requires a server-configured status provider')
        if abs((status_provider.clock() - request.as_of).total_seconds()) > 60:
            raise ValueError('Live routing requires current evidence time; use SIMULATED for historical replay')
    live_status = {t.target_id: status_provider.get(t) for t in policy.targets} if request.status_mode == 'LIVE' else {}
    inputs = {m.target_id: m for m in request.markets}
    blocked_assets, blocked_venues = set(), set()
    global_pause = False
    # Propagate positive restrictions even when stale. A live provider must persist halts until a verified clear.
    for item in request.markets:
        target = targets[item.target_id]
        pause = item.controls.government_pause
        if pause == 'ASSET' or item.controls.token_transfers_paused is True:
            blocked_assets.add(target.collateral_asset)
        if pause == 'VENUE': blocked_venues.add(target.underlying_venue)
        global_pause |= pause == 'GLOBAL'
    # Registry controls identity; assessment requests cannot substitute an asset or address.
    evaluations = []
    for target in policy.targets:
        item, reasons = inputs.get(target.target_id), []
        assessment: Assessment | None = None
        parameters = None
        status = live_status.get(target.target_id)
        if status:
            now = status_provider.clock()
            observations = [
                ('Nasdaq market', status.nasdaq_market, {'OPEN', 'CLOSED', 'PRE_MARKET', 'AFTER_HOURS'}),
                ('Underlying stock', status.underlying_halt, {'NO_ACTIVE_HALT', 'RESUMED'}),
                ('Binance bStock', status.binance_bstock, {'TRADING', 'CLOSED'}),
            ]
            if status.binance_spot: observations.append(('Binance Spot', status.binance_spot, {'TRADING'}))
            for label, observation, accepted in observations:
                age = (now - observation.fetched_at).total_seconds()
                if observation.status not in accepted or not 0 <= age <= policy.observation_max_age_seconds:
                    reasons.append(f'{label} status {observation.status}: unavailable, restricted or stale')
        if not target.approved or not target.enabled: reasons.append('Destination not approved/enabled')
        if target.chain_id != primary.chain_id: reasons.append('Cross-chain movement is unsupported')
        if target.loan_asset != primary.loan_asset: reasons.append('Loan asset is incompatible')
        if (target.target_id != primary.target_id and target.chain_id == primary.chain_id
                and target.market_id.lower() == primary.market_id.lower()):
            reasons.append('Alternative must use a different market ID')
        if global_pause or target.collateral_asset in blocked_assets or target.underlying_venue in blocked_venues:
            reasons.append('Government/regulator restriction applies to this exposure')
        if item is None:
            reasons.append('Market observations missing')
        else:
            controls = item.controls
            age = (request.as_of - controls.observed_at).total_seconds() if controls.observed_at else None
            if age is None or not 0 <= age <= policy.observation_max_age_seconds or not controls.source_reference.strip():
                reasons.append('Control evidence missing, stale or future-dated')
            if controls.government_pause == 'UNKNOWN': reasons.append('Government pause status unknown')
            if controls.governance_paused is not False: reasons.append('Protocol governance pause active or unknown')
            if controls.token_transfers_paused is not False: reasons.append('Token transfer availability paused or unknown')
            req = item.assessment.model_copy(deep=True)
            if req.as_of and req.as_of != request.as_of:
                raise ValueError('All assessments must share routing evidence time')
            if req.snapshot and req.snapshot.market.as_of != request.as_of:
                raise ValueError('Snapshot time must match routing evidence time')
            req.as_of = request.as_of
            target_policy = type(service.policy).model_validate(service.policy.model_dump() | {'market_lltv': target.market_lltv})
            evaluator = RiskService(target_policy, service.store, provider=service.provider, agent=service.agent,
                                    assets={t.collateral_asset: t.collateral_asset for t in policy.targets})
            if status:
                req.snapshot = evaluator.resolve(target.collateral_asset, req)
                req.snapshot.market.halted |= (status.underlying_halt.status == 'HALTED' or
                    status.nasdaq_market.status == 'HALTED' or
                    status.binance_bstock.status in {'PAUSED', 'CORP_ACTION', 'LIMITED', 'MAINTENANCE'} or
                    status.binance_spot is not None and status.binance_spot.status in {'HALTED', 'PAUSED', 'LIMITED'})
                req.snapshot.market.data_degraded |= any(o.status == 'UNKNOWN' for o in
                    [status.nasdaq_market, status.underlying_halt, status.binance_bstock])
            assessment, _ = evaluator.assess(target.collateral_asset, req)
            parameters, _ = evaluator.optimiser.recommend(assessment)
            if status and status.nasdaq_market.status != 'OPEN' and assessment.session.underlying_session in {Session.REGULAR, Session.EARLY_CLOSE}:
                reasons.append('Nasdaq reports market not open during calendar regular session')
            vol = assessment.metrics.annualised_volatility
            if assessment.score.overall >= policy.max_score: reasons.append('Market risk score reaches policy limit')
            if vol is None or vol >= policy.max_annualised_volatility: reasons.append('Volatility missing or reaches policy limit')
            if assessment.recovery.recovery_ratio < policy.min_recovery_ratio: reasons.append('Insufficient stressed recoverable value')
            if not parameters.collateral_accepted or parameters.borrow_cap == 0:
                reasons.append('Deterministic risk constraints reject new borrowing')
        evaluations.append(MarketEvaluation(target=target, controls=item.controls if item else None,
                                            market_status=status, eligible=not reasons, reasons=reasons, assessment=assessment, parameters=parameters))
    # Underlying volatility is shared: relabelling the same asset into another contract cannot erase it.
    risky_assets = {e.target.collateral_asset for e in evaluations if e.assessment and
                    (e.assessment.metrics.annualised_volatility is None or
                     e.assessment.metrics.annualised_volatility >= policy.max_annualised_volatility)}
    restricted_issuer_assets = {e.target.collateral_asset for e in evaluations if e.assessment and
                               issuer_risk(e.assessment.events, service.policy)[2]}
    for e in evaluations:
        if e.target.collateral_asset in restricted_issuer_assets:
            e.eligible = False
            e.reasons.append('Issuer restriction/uncertainty affects this asset across contracts')
        if e.target.collateral_asset in risky_assets:
            e.eligible = False
            if 'Underlying volatility missing/high in another market for this asset' not in e.reasons:
                e.reasons.append('Underlying volatility missing/high in another market for this asset')
    # A different contract cannot bypass a halt on the same underlying or bStock token.
    halted_tickers = {s.ticker for s in live_status.values() if s.underlying_halt.status == 'HALTED'}
    paused_tokens = {(s.chain_id, s.collateral_token_address.lower()) for s in live_status.values()
                     if s.collateral_token_address and s.binance_bstock.status in {'PAUSED', 'CORP_ACTION', 'LIMITED', 'MAINTENANCE'}}
    for e in evaluations:
        token = e.target.collateral_token_address
        if (e.target.underlying_ticker and e.target.underlying_ticker in halted_tickers or
                token and (e.target.chain_id, token.lower()) in paused_tokens):
            e.eligible = False
            e.reasons.append('Live underlying/token restriction applies across configured contracts')
    current = next(e for e in evaluations if e.target.target_id == request.primary_target_id)
    candidates = sorted([e for e in evaluations if e.eligible], key=lambda e: (
        e.assessment.score.overall, e.assessment.metrics.annualised_volatility, e.target.target_id))
    selected = current if current.eligible else (candidates[0] if candidates else None)
    action = 'KEEP_CURRENT' if current.eligible else 'PROPOSE_ALTERNATIVE' if selected else 'HOLD_NEW_EXPOSURE'
    reasoning = ['Current market passes all constraints'] if current.eligible else current.reasons.copy()
    reasoning.append('Alternative must pass independent controls, quantitative risk and recovery checks; existing positions stay in their original market')
    evidence = {'request': request.model_dump(mode='json'), 'routing_policy': policy.model_dump(mode='json'),
                'risk_policy': service.policy.model_dump(mode='json'),
                'live_market_status': {k: v.model_dump(mode='json') for k, v in live_status.items()},
                'assessments': {e.target.target_id: e.assessment.evidence_hash if e.assessment else None for e in evaluations}}
    expires_at = request.as_of + timedelta(seconds=policy.expiry_seconds)
    if selected and selected.market_status:
        observations = [selected.market_status.nasdaq_market, selected.market_status.underlying_halt,
                        selected.market_status.binance_bstock]
        if selected.market_status.binance_spot: observations.append(selected.market_status.binance_spot)
        expires_at = min(expires_at, *(o.fetched_at + timedelta(seconds=policy.observation_max_age_seconds) for o in observations))
    if selected and selected.controls.observed_at:
        expires_at = min(expires_at, selected.controls.observed_at + timedelta(seconds=policy.observation_max_age_seconds))
    decision = RoutingDecision(decision_id=str(uuid4()), action=action, primary_target_id=request.primary_target_id,
                               proposed_target=selected.target if selected else None, evaluations=evaluations,
                               reasoning=reasoning, timestamp=request.as_of,
                               expires_at=expires_at,
                               evidence_hash=evidence_hash(evidence), configuration_version=policy.version + ':' + evidence_hash(policy.model_dump(mode='json')),
                               )
    service.store.put('routing', primary.collateral_asset, request.as_of.isoformat(),
                      {'decision': decision.model_dump(mode='json'), 'evidence': evidence})
    return decision
