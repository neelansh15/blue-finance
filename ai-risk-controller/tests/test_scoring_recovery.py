import math

import pytest

from app.config import Policy
from app.market_sessions.session_policy import SessionAdjustment
from app.models import BidLevel, Metrics, OracleHealth
from app.risk.recoverable_value import recoverable_value
from app.risk.scoring import category, score_risk


def test_categories_continuous_and_configurable():
    assert [category(x, Policy()) for x in [0, 20, 20.01, 40, 60, 80, 100]] == [
        "LOW", "LOW", "MODERATE", "MODERATE", "ELEVATED", "HIGH", "CRITICAL"]
    assert category(25, Policy(category_thresholds=[10, 20, 30, 40])) == "ELEVATED"


def test_weighted_score_explainable():
    metrics = Metrics(annualised_volatility=.4, maximum_drawdown=.2, momentum=0,
                      spread=.01, volume_24h_usd=100, depth_usd=100, expected_liquidation_slippage=.01,
                      executable_fraction=1, price_divergence=0, liquidity_deterioration=.3)
    oracle = OracleHealth(available=True, stale=False, observation_age_seconds=0,
                          publication_age_seconds=0, risk_score=20, haircut=0, confidence=.9, reasons=[])
    score = score_risk(metrics, 40, oracle, .5, [], Policy())
    assert score.overall == pytest.approx(.25 * 50 + .25 * 30 + .2 * 40 + .15 * 20 + .15 * 50)
    assert len(score.explanation) == 5


def test_recovery_product_matches_book_proceeds_without_double_count():
    p = Policy()
    s = SessionAdjustment(.1, 1, 1, 0, "test")
    r = recoverable_value(10, 100, [BidLevel(price=90, quantity=5)], 0, s, .2, .1, .9, p)
    assert r.recoverable_value_usd == pytest.approx(450 * .9 * .8 * .9 * (1 - p.execution_fee))
    assert r.haircuts["liquidity"] == .5
    assert r.haircuts["execution"] == pytest.approx(1 - .9 * .997)
    assert r.recovery_ratio == pytest.approx(math.prod(1 - h for h in r.haircuts.values()))
    assert recoverable_value(10, 100, [], 0, s, 0, 0, .9, p).recoverable_value_usd == 0


def test_recovery_more_conservative_with_volatility_and_size():
    p = Policy()
    s = SessionAdjustment(.01, 1, 1, 0, "test")
    book = [BidLevel(price=99, quantity=10)]
    a = recoverable_value(10, 100, book, .2, s, 0, 0, .9, p)
    b = recoverable_value(10, 100, book, .8, s, 0, 0, .9, p)
    c = recoverable_value(20, 100, book, .2, s, 0, 0, .9, p)
    assert b.recovery_ratio < a.recovery_ratio
    assert c.recovery_ratio < a.recovery_ratio
