import pytest

from app.config import Policy
from app.models import Parameters
from app.optimiser.constraints import morpho_incentive, validate_bounds


def test_governance_constraints():
    p = Policy()
    values = dict(ltv=.4, liquidation_threshold=.625, supply_cap=100, borrow_cap=1000,
                  liquidation_incentive=morpho_incentive(.625))
    validate_bounds(Parameters(**values), p)
    for change in [dict(ltv=.59), dict(liquidation_threshold=.77), dict(supply_cap=100001),
                   dict(borrow_cap=5000001), dict(collateral_accepted=False), dict(liquidation_incentive=.05)]:
        with pytest.raises(ValueError):
            validate_bounds(Parameters(**(values | change)), p)


def test_morpho_incentive():
    assert morpho_incentive(.625) == pytest.approx(1 / .8875 - 1)
    assert morpho_incentive(.385) == pytest.approx(.15)


def test_router_ceiling_is_enforced_in_recommendations_and_proposals():
    from app.integrations.providers import DEMO_TIMES
    from app.models import AssessRequest
    from app.services.risk_service import RiskService
    from app.services.store import AuditStore
    store = AuditStore(':memory:')
    try:
        service = RiskService(Policy(), store)
        assessment, _ = service.assess('NVDA', AssessRequest(as_of=DEMO_TIMES['baseline']))
        params, _ = service.optimiser.recommend(assessment)
        assert params.ltv == pytest.approx(.51125)
        with pytest.raises(ValueError, match='DawnRouter'):
            validate_bounds(params.model_copy(update={'ltv': .5327}), service.policy)
        with pytest.raises(ValueError, match='no borrowing capacity'):
            Policy(router_hmax=1)
    finally:
        store.close()
