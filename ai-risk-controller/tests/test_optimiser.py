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
