import pytest

from app.config import Policy
from app.integrations.providers import DEMO_TIMES, MockProviders, synthetic_borrowers
from app.integrations.signing import evidence_hash, signing_payload
from app.models import AssessRequest, Borrower, OracleMode, Scenario, Signature, SimulateRequest
from app.optimiser.parameters import RuleBasedOptimiser
from app.services.risk_service import RiskService
from app.services.store import AuditStore
from app.simulation.portfolio import simulate


@pytest.fixture
def service():
    store = AuditStore(":memory:")
    yield RiskService(Policy(), store)
    store.close()


def baseline(service):
    return service.assess("NVDA", AssessRequest(as_of=DEMO_TIMES["baseline"]))


def test_complete_weekend_demo_and_signature_payload(service):
    outputs = [service.recommend("NVDA", SimulateRequest(scenario=s, as_of=DEMO_TIMES[s]))
               for s in ["baseline", "friday", "saturday"]]
    base, friday, saturday = outputs
    assert friday.recommended_parameters.ltv < base.recommended_parameters.ltv
    assert friday.recommended_parameters.borrow_cap < base.recommended_parameters.borrow_cap
    assert saturday.risk_score > friday.risk_score
    assert not saturday.recommended_parameters.collateral_accepted
    assert saturday.recommended_parameters.borrow_cap == 0
    assert saturday.simulation.at_risk > 0
    assert all(r.simulated and r.approval_required and r.signing_status == "UNSIGNED" for r in outputs)
    assert len(service.recommendations("NVDA")) == 3
    payload = signing_payload(saturday.model_dump(mode="json"), service.chain_id, service.market_id)
    assert evidence_hash(payload) == saturday.payload_hash
    payload["chain_id"] = 1
    assert evidence_hash(payload) != saturday.payload_hash


def test_optimiser_monotonic_volatility_depth_and_oracle(service):
    a, _ = baseline(service)
    opt = RuleBasedOptimiser(service.policy)
    base, _ = opt.recommend(a)
    high_vol = a.model_copy(deep=True)
    high_vol.metrics.annualised_volatility = 1
    high_vol.recovery.recovery_ratio *= .75
    assert opt.recommend(high_vol)[0].ltv < base.ltv
    thin = a.model_copy(deep=True)
    thin.metrics.depth_usd *= .01
    thin.metrics.volume_24h_usd *= .01
    assert opt.recommend(thin)[0].borrow_cap < base.borrow_cap
    old = a.model_copy(deep=True)
    old.oracle.stale = True
    assert opt.recommend(old)[0].borrow_cap == 0


def test_parameter_change_alone_does_not_liquidate(service):
    a, snapshot = baseline(service)
    borrowers = [Borrower(borrower_id="near", collateral_quantity=10, debt_usd=700)]
    params, _ = service.optimiser.recommend(a)
    params.ltv = .2
    result = simulate(a, snapshot, borrowers, Scenario(name="router_target", proposed_parameters=params), service.policy)
    assert result.liquidatable == 0
    assert result.at_risk == 1
    with pytest.raises(ValueError, match="immutable"):
        simulate(a, snapshot, borrowers, Scenario(name="wrong", proposed_parameters=params,
                                                apply_threshold_to_existing=True), service.policy)
    oracle_change = simulate(a, snapshot, borrowers, Scenario(name="explicit_oracle_haircut", oracle_price_multiplier=.6), service.policy)
    assert oracle_change.newly_liquidatable == 1


def test_shocks_and_empty_portfolio(service):
    a, snapshot = baseline(service)
    borrowers = synthetic_borrowers()
    results = [simulate(a, snapshot, borrowers, Scenario(name=str(drop), price_drop=drop), service.policy)
               for drop in [0, .05, .10, .20, .30]]
    assert [r.liquidatable for r in results] == sorted(r.liquidatable for r in results)
    assert results[-1].estimated_bad_debt_usd >= results[0].estimated_bad_debt_usd
    assert results[-1].newly_liquidatable > 0
    empty = simulate(a, snapshot, [], Scenario(name="empty"), service.policy)
    assert empty.total_positions == empty.estimated_bad_debt_usd == 0


def test_finite_depth_not_reused_and_restoration_flag(service):
    a, snapshot = baseline(service)
    borrowers = [Borrower(borrower_id=str(i), collateral_quantity=10000, debt_usd=400000) for i in range(10)]
    result = simulate(a, snapshot, borrowers, Scenario(name="shared_liquidity"), service.policy)
    assert sum(i.recoverable_value_usd for i in result.positions) <= sum(b.price * b.quantity for b in snapshot.market.bids)
    assert not result.safety_restoration_feasible


def test_missing_history_or_quote_fail_closed(service):
    for field, value in [("history", []), ("market_observed_at", None)]:
        snapshot = MockProviders().snapshot("NVDA", DEMO_TIMES["baseline"], "baseline", OracleMode.FEED_24_5)
        setattr(snapshot.market, field, value)
        r = service.recommend("NVDA", SimulateRequest(snapshot=snapshot))
        assert r.recommended_parameters.borrow_cap == 0
        assert r.confidence <= .35


def test_audit_persistence_and_ordering(tmp_path):
    path = str(tmp_path / "audit.sqlite3")
    store = AuditStore(path)
    s = RiskService(Policy(), store)
    newest = s.recommend("NVDA", SimulateRequest(scenario="saturday"))
    s.recommend("NVDA", SimulateRequest(scenario="friday"))
    store.close()
    reopened = AuditStore(path)
    assert RiskService(Policy(), reopened).recommendations("NVDA")[0] == newest
    reopened.close()


def test_oracle_price_premium_cannot_raise_borrowing_capacity(service):
    snapshot = MockProviders().snapshot("NVDA", DEMO_TIMES["baseline"], "baseline", OracleMode.FEED_24_5)
    base, _ = service.assess("NVDA", AssessRequest(snapshot=snapshot))
    base_params = service.optimiser.recommend(base)[0]
    snapshot.oracle.price = 147  # a 5% oracle premium must scale target LTV down
    premium, _ = service.assess("NVDA", AssessRequest(snapshot=snapshot))
    premium_params = service.optimiser.recommend(premium)[0]
    assert premium_params.ltv * 147 <= base_params.ltv * 140 + 1e-9
    snapshot.oracle.price = 280
    extreme = service.recommend("NVDA", SimulateRequest(snapshot=snapshot))
    assert not extreme.recommended_parameters.collateral_accepted


def test_signer_seam_receives_exact_hashed_bytes(service):
    import hashlib

    class TestSigner:
        received = None

        def sign(self, canonical_payload):
            self.received = canonical_payload
            return Signature(scheme="TEST_STUB_NOT_CRYPTOGRAPHIC", signer_id="test-only", value="test-only")

    signer = TestSigner()
    service.signer = signer
    r = service.recommend("NVDA", SimulateRequest(scenario="friday"))
    assert r.signing_status == "SIGNED" and r.approval_status == "PENDING_REVIEW"
    assert r.payload_hash == "sha256:" + hashlib.sha256(signer.received).hexdigest()


def test_fixed_input_reproduces_evidence_hash(service):
    request = AssessRequest(scenario="friday")
    a, _ = service.assess("NVDA", request)
    b, _ = service.assess("NVDA", request)
    assert a.evidence_hash == b.evidence_hash
