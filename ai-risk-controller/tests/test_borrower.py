from app.simulation.borrower import health_factor, position_status
from app.simulation.portfolio import default_scenarios


def test_health_and_exact_liquidation_boundary():
    assert health_factor(10, 100, 625, .625) == 1
    assert position_status(10, 100, 625, .625, 1000, None, 1.15) == "AT_RISK"
    assert position_status(10, 100, 626, .625, 1000, None, 1.15) == "LIQUIDATABLE"
    assert health_factor(10, 100, 0, .625) is None
    assert position_status(10, 100, 0, .625, 0, 0, 1.15) == "HEALTHY"


def test_target_ltv_is_not_liquidation_threshold():
    assert position_status(10, 100, 400, .625, 1000, .3, 1.15) == "AT_RISK"
    assert len(default_scenarios()) == 8
