from datetime import timedelta
from decimal import Decimal
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Policy
from app.blue import BlueConfig, REGIMES, propose_blue
from app.integrations.providers import DEMO_TIMES, MockProviders
from app.integrations.signing import evidence_hash
from app.models import AssessRequest, OracleMode, OracleObservation, SimulateRequest
from app.services.risk_service import RiskService
from app.services.store import AuditStore


@pytest.fixture
def service():
    store = AuditStore(':memory:')
    yield RiskService(Policy(), store)
    store.close()


def proposal(service, scenario='baseline'):
    request = SimulateRequest(as_of=DEMO_TIMES[scenario], scenario=scenario, borrowers=[])
    a, snapshot = service.assess('NVDA', request)
    recommendation = service.recommend_assessed(a, snapshot, request)
    return propose_blue(a, recommendation, service.policy, BlueConfig()), recommendation


def test_proposal_maps_only_enforceable_blue_controls_and_binds_evidence(service):
    result, recommendation = proposal(service)
    assert result.router.margin_bps == 200
    assert result.router.target_ltv == pytest.approx(.51125)
    assert result.router.regime_order == list(REGIMES)
    assert len(result.router.regime_cap_assets) == 6
    assert result.router.regime_caps_usd['HALTED'] == result.router.regime_caps_usd['CORP_ACTION'] == 0
    assert result.router.regime_caps_usd['WEEKEND'] <= result.router.regime_caps_usd['CLOSED']
    assert result.evidence_hash == recommendation.evidence_hash
    assert result.recommendation_id == recommendation.recommendation_id
    assert result.expires_at == recommendation.expires_at
    assert result.proposal_hash == evidence_hash(result.model_dump(mode='json', exclude={'proposal_hash'}))
    assert Decimal(result.router.total_cap_assets) <= Decimal(str(result.router.total_borrow_cap_usd)) * 10**18
    assert result.executable is False and result.calibration_status == 'UNCALIBRATED'
    assert any('Supply cap requires' in reason for reason in result.reasons)
    wrong = recommendation.model_copy(update={'evidence_hash': 'sha256:wrong'})
    with pytest.raises(ValueError, match='matching assessment'):
        propose_blue(service.latest('NVDA'), wrong, service.policy, BlueConfig())


def test_margin_rounds_conservatively_and_blocked_exposure_uses_zero_caps(service):
    req = SimulateRequest(scenario='baseline', as_of=DEMO_TIMES['baseline'], borrowers=[])
    a, snap = service.assess('NVDA', req)
    r = service.recommend_assessed(a, snap, req)
    r.recommended_parameters.ltv = .43216
    p = propose_blue(a, r, service.policy, BlueConfig())
    assert p.router.margin_bps == 991
    assert p.router.target_ltv <= .43216
    # A target below the contract's legal margin range cannot become an invalid call.
    r.recommended_parameters.ltv = .001
    p = propose_blue(a, r, service.policy, BlueConfig())
    assert p.router.margin_bps == 200 and p.router.total_borrow_cap_usd == 0
    assert all(cap == '0' for cap in p.router.regime_cap_assets)
    blocked, _ = proposal(service, 'saturday')
    assert blocked.router.total_cap_assets == '0'


def test_contract_configuration_bounds_and_mismatches_fail_closed(service):
    for change in [dict(haircuts_bps={'OPEN': 0}), dict(jump_band_bps=100),
                   dict(margin_bps=5001), dict(nasdaq_poll_seconds=30),
                   dict(refresh_margin_seconds=3600), dict(profile='ATLAS_RAW_TOKEN')]:
        with pytest.raises(ValidationError):
            BlueConfig(**change)
    p, r = proposal(service)
    a = service.latest('NVDA')
    with pytest.raises(ValueError, match='disagree'):
        propose_blue(a, r, service.policy, BlueConfig(margin_bps=300))
    root = Path(__file__).resolve().parents[1]
    atlas = BlueConfig.model_validate_json((root / 'blue-parameters.atlas.example.json').read_text())
    assert atlas.staleness_seconds['OPEN'] == atlas.staleness_seconds['EXTENDED'] == 7200


def test_raw_atlas_price_normalizes_once_and_preserves_raw_evidence(service):
    snap = MockProviders().snapshot('NVDA', DEMO_TIMES['baseline'], 'baseline', OracleMode.FEED_24_5)
    a, _ = service.assess('NVDA', AssessRequest(snapshot=snap))
    raw = snap.model_dump(mode='json')
    raw['oracle'].update(price=1120, price_unit='PER_RAW_TOKEN', ui_multiplier=8)
    b, original = service.assess('NVDA', AssessRequest(snapshot=raw))
    assert original.oracle.price == 1120 and original.oracle.normalized_price == 140
    assert b.recovery.recoverable_value_usd == a.recovery.recoverable_value_usd
    assert b.metrics.reference_to_protocol_price == a.metrics.reference_to_protocol_price
    r = service.recommend('NVDA', SimulateRequest(snapshot=raw, borrowers=[
        {'borrower_id': 'raw-price-check', 'collateral_quantity': 10, 'debt_usd': 350}]))
    assert r.simulation.positions[0].health_factor == pytest.approx(2.5)
    with pytest.raises(ValidationError, match='explicit UI multiplier'):
        OracleObservation.model_validate(raw['oracle'] | {'ui_multiplier': None})


def test_explicit_per_regime_freshness_preserves_strict_default(service):
    snap = MockProviders().snapshot('NVDA', DEMO_TIMES['baseline'], 'baseline', OracleMode.FEED_24_5)
    snap.oracle.observed_at -= timedelta(minutes=45)
    strict, _ = service.assess('NVDA', AssessRequest(snapshot=snap))
    assert strict.oracle.stale
    ages = dict(zip(REGIMES, [7200, 7200, 14400, 21600, 3600, 3600]))
    configured = RiskService(Policy(oracle_max_age_by_regime=ages), service.store)
    age_aware, _ = configured.assess('NVDA', AssessRequest(snapshot=snap))
    assert not age_aware.oracle.stale
    with pytest.raises(ValidationError, match='all six'):
        Policy(oracle_max_age_by_regime={'OPEN': 7200})


def test_declared_haircuts_and_margin_match_deployment_defaults():
    root = Path(__file__).resolve().parents[2]
    deployment = (root / 'protocol-old/script/BlueDeploy.sol').read_text()
    config = BlueConfig()
    # Detect backend/Solidity configuration drift without depending on frontend code.
    for regime in REGIMES:
        onchain = int(re.search(rf'H_{regime}\s*=\s*(\d+)', deployment)[1])
        assert onchain == config.haircuts_bps[regime]
    assert int(re.search(r'MARGIN_BPS\s*=\s*(\d+)', deployment)[1]) == config.margin_bps
