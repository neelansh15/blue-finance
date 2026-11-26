from datetime import timedelta
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.config import Policy
from app.integrations.providers import DEMO_TIMES, MockProviders
from app.main import create_app
from app.models import OracleMode
from app.routing.engine import route_markets
from app.routing.models import Controls, MarketInput, RoutingRequest
from app.routing.policy import demo_policy
from app.services.risk_service import RiskService
from app.services.store import AuditStore


@pytest.fixture
def service():
    store = AuditStore(':memory:')
    yield RiskService(Policy(), store)
    store.close()


def request():
    at = DEMO_TIMES['baseline']
    return RoutingRequest(status_mode='SIMULATED', as_of=at, primary_target_id='demo-nvda-primary', markets=[
        MarketInput(target_id=t.target_id, controls=Controls(observed_at=at, source_reference='mock://controls',
                    government_pause='NONE', governance_paused=False, token_transfers_paused=False))
        for t in demo_policy().targets])


def run(service, req=None, policy=None):
    return route_markets(service, 'NVDA', req or request(), policy or demo_policy())


def test_healthy_primary_kept_and_audited(service):
    result = run(service)
    assert result.action == 'KEEP_CURRENT'
    assert result.approval_required and result.simulated and result.signing_status == 'UNSIGNED'
    assert service.store.history('routing', 'BNB_STOCK_NVDA')[0]['decision']['evidence_hash'] == result.evidence_hash


@pytest.mark.parametrize('field,value', [('governance_paused', True), ('government_pause','ASSET'), ('government_pause','VENUE'), ('token_transfers_paused',True)])
def test_paused_primary_proposes_independently_eligible_different_contract(service, field, value):
    req = request()
    setattr(req.markets[0].controls, field, value)
    result = run(service, req)
    assert result.action == 'PROPOSE_ALTERNATIVE'
    assert result.proposed_target.target_id == 'demo-spy-alternative'
    assert result.proposed_target.contract_address != result.evaluations[0].target.contract_address


@pytest.mark.parametrize('change', ['same_asset','same_venue','global','both_paused','unapproved','disabled','same_contract','cross_chain','wrong_loan','missing_alternative','stale_alternative','unknown_alternative'])
def test_no_safe_alternative_holds_exposure(service, change):
    req, policy = request(), demo_policy()
    req.markets[0].controls.government_pause = 'ASSET'
    if change == 'same_asset': policy.targets[1].collateral_asset = 'BNB_STOCK_NVDA'
    if change == 'same_venue':
        req.markets[0].controls.government_pause = 'VENUE'
        policy.targets[1].underlying_venue = 'NASDAQ'
    if change == 'global': req.markets[0].controls.government_pause = 'GLOBAL'
    if change == 'both_paused': req.markets[1].controls.governance_paused = True
    if change == 'unapproved': policy.targets[1].approved = False
    if change == 'disabled': policy.targets[1].enabled = False
    if change == 'same_contract': policy.targets[1].contract_address = policy.targets[0].contract_address
    if change == 'cross_chain': policy.targets[1].chain_id = 1
    if change == 'wrong_loan': policy.targets[1].loan_asset = 'OTHER'
    if change == 'missing_alternative': req.markets.pop()
    if change == 'stale_alternative': req.markets[1].controls.observed_at -= timedelta(seconds=301)
    if change == 'unknown_alternative': req.markets[1].controls = Controls()
    result = run(service, req, policy)
    assert result.action == 'HOLD_NEW_EXPOSURE'
    assert result.proposed_target is None


def test_volatility_and_risk_thresholds(service):
    # A stricter maximum independently blocks both markets, despite unchanged controls.
    policy = demo_policy()
    policy.max_annualised_volatility = .01
    result = run(service, policy=policy)
    assert result.action == 'HOLD_NEW_EXPOSURE'
    assert any('Volatility' in r for r in result.evaluations[0].reasons)
    policy = demo_policy()
    policy.max_score = 1
    assert run(service, policy=policy).action == 'HOLD_NEW_EXPOSURE'


def test_high_volatility_primary_can_choose_lower_volatility_asset(service):
    req = request()
    snap = MockProviders().snapshot('BNB_STOCK_NVDA', req.as_of, 'baseline', OracleMode.FEED_24_5)
    for i, point in enumerate(snap.market.history):
        point.price = 140 if i % 2 else 180
    req.markets[0].assessment.snapshot = snap
    result = run(service, req)
    assert result.action == 'PROPOSE_ALTERNATIVE'
    assert result.proposed_target.collateral_asset == 'BNB_STOCK_SPY'
    policy = demo_policy()
    policy.targets[1].collateral_asset = 'BNB_STOCK_NVDA'
    assert run(service, req, policy).action == 'HOLD_NEW_EXPOSURE'


def test_unknown_identity_future_controls_and_bad_asset(service):
    req = request()
    req.markets[1].target_id = 'unapproved-injected-contract'
    with pytest.raises(ValueError, match='server-configured'): run(service, req)
    req = request()
    for item in req.markets: item.controls.observed_at += timedelta(seconds=1)
    assert run(service, req).action == 'HOLD_NEW_EXPOSURE'
    req = request()
    req.markets[0].assessment.as_of = req.as_of - timedelta(seconds=1)
    with pytest.raises(ValueError, match='evidence time'): run(service, req)
    req = request()
    req.markets[0].assessment.snapshot = MockProviders().snapshot('BNB_STOCK_SPY', req.as_of, 'baseline', OracleMode.FEED_24_5)
    with pytest.raises(ValueError, match='Snapshot asset'): run(service, req)


def test_duplicate_identities_rejected():
    policy = demo_policy()
    raw = policy.model_dump()
    raw['targets'][1] = raw['targets'][0]
    with pytest.raises(ValidationError): type(policy).model_validate(raw)


def test_route_api_and_immutable_registry(service):
    with TestClient(create_app(service)) as client:
        r = client.post('/risk/route/NVDA', json=request().model_dump(mode='json'))
        assert r.status_code == 200, r.text
        assert r.json()['action'] == 'KEEP_CURRENT'
        assert '/risk/route/{asset}' in client.get('/openapi.json').json()['paths']
        raw = request().model_dump(mode='json')
        raw['markets'][1]['contract_address'] = '0x' + '3'*40
        assert client.post('/risk/route/NVDA', json=raw).status_code == 422


def test_issuer_restriction_propagates_across_same_asset_contracts(service):
    req, policy = request(), demo_policy()
    policy.targets[1].collateral_asset = 'BNB_STOCK_NVDA'
    req.markets[0].assessment.scenario = 'saturday'
    result = run(service, req, policy)
    assert result.action == 'HOLD_NEW_EXPOSURE'
    assert any('Issuer restriction' in r for r in result.evaluations[1].reasons)


def test_destination_lltv_uses_its_own_governance_bounds(service):
    req, policy = request(), demo_policy()
    req.markets[0].controls.governance_paused = True
    policy.targets[1].market_lltv = .385
    result = run(service, req, policy)
    assert result.action == 'PROPOSE_ALTERNATIVE'
    assert result.evaluations[1].parameters.liquidation_threshold == .385
    assert result.evaluations[1].parameters.ltv < .385


def test_failed_recovery_and_stale_oracle_never_selected(service):
    req = request()
    req.markets[0].controls.governance_paused = True
    snap = MockProviders().snapshot('BNB_STOCK_SPY', req.as_of, 'baseline', OracleMode.FEED_24_5)
    snap.market.bids = []
    req.markets[1].assessment.snapshot = snap
    assert run(service, req).action == 'HOLD_NEW_EXPOSURE'
    snap.market = MockProviders().market(req.as_of, 'baseline')
    snap.oracle.observed_at -= timedelta(hours=2)
    assert run(service, req).action == 'HOLD_NEW_EXPOSURE'
