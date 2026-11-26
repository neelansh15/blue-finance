from datetime import datetime
import math
import statistics

import pytest

from app.config import Policy
from app.integrations.providers import DEMO_TIMES, MockProviders
from app.market_sessions.oracle_health import assess_oracle
from app.market_sessions.session_detector import detect_session
from app.models import BidLevel, OracleMode, Session
from app.risk.liquidity import bid_ask_spread, execute_bids, price_divergence
from app.risk.volatility import historical_volatility, maximum_drawdown, momentum


@pytest.mark.parametrize("time, expected", [
    ("2026-11-20T16:00:00+00:00", Session.REGULAR),
    ("2026-07-01T13:30:00+00:00", Session.REGULAR),  # DST
    ("2026-01-07T14:30:00+00:00", Session.REGULAR),
    ("2026-11-20T13:00:00+00:00", Session.EXTENDED),
    ("2026-11-20T07:00:00+00:00", Session.OVERNIGHT),
    ("2026-11-21T16:00:00+00:00", Session.WEEKEND_CLOSED),
    ("2026-11-26T16:00:00+00:00", Session.HOLIDAY_CLOSED),
    ("2026-11-27T17:00:00+00:00", Session.EARLY_CLOSE),
    ("2026-11-27T18:00:00+00:00", Session.EXTENDED),
])
def test_exchange_sessions(time, expected):
    assert detect_session(datetime.fromisoformat(time), Policy()).underlying_session == expected


@pytest.mark.parametrize('time,regime,effective', [
    ('2026-11-20T19:59:00-05:00', 'EXTENDED', Session.EXTENDED),
    ('2026-11-20T20:00:00-05:00', 'WEEKEND', Session.WEEKEND_CLOSED),
    ('2026-11-22T19:59:00-05:00', 'WEEKEND', Session.WEEKEND_CLOSED),
    ('2026-11-22T20:00:00-05:00', 'CLOSED', Session.OVERNIGHT),
    ('2026-11-25T20:00:00-05:00', 'WEEKEND', Session.WEEKEND_CLOSED),
    ('2026-11-26T20:00:00-05:00', 'CLOSED', Session.OVERNIGHT),
    ('2026-11-27T16:59:00-05:00', 'EXTENDED', Session.EXTENDED),
    ('2026-11-27T17:00:00-05:00', 'WEEKEND', Session.WEEKEND_CLOSED),
    ('2026-07-02T20:00:00-04:00', 'WEEKEND', Session.WEEKEND_CLOSED),
])
def test_policy_regimes_match_registry_boundaries(time, regime, effective):
    from app.market_sessions.session_policy import adjustment
    info = detect_session(datetime.fromisoformat(time), Policy())
    assert info.protocol_regime == regime
    assert info.effective_session == effective
    if regime == 'WEEKEND':
        assert adjustment(info, Policy()).cap_multiplier == .4
        assert adjustment(info, Policy()).gap_floor == .08


def test_overrides_and_friday_warning():
    at = DEMO_TIMES["friday"]
    assert detect_session(at, Policy()).prolonged_closure_approaching
    assert detect_session(at, Policy(), halted=True).effective_session == Session.HALTED
    info = detect_session(at, Policy(), degraded=True)
    assert info.effective_session == Session.DATA_DEGRADED
    assert info.underlying_session == Session.REGULAR


def test_republished_stale_and_smoothed_feed():
    at = DEMO_TIMES["saturday"]
    mock = MockProviders()
    old = assess_oracle(mock.oracle(at, OracleMode.FEED_24_5), at, Policy())
    smooth = assess_oracle(mock.oracle(at, OracleMode.SMOOTHED_24_7), at, Policy())
    assert old.stale and old.publication_age_seconds == 5
    assert not smooth.stale and smooth.haircut > 0
    missing = mock.oracle(at, OracleMode.FEED_24_5).model_copy(update={"price": None})
    assert not assess_oracle(missing, at, Policy()).available


def test_financial_metrics():
    prices = [100, 110, 88, 99]
    returns = [math.log(1.1), math.log(.8), math.log(1.125)]
    assert historical_volatility(prices) == pytest.approx(statistics.stdev(returns) * math.sqrt(252))
    assert maximum_drawdown(prices) == pytest.approx(.2)
    assert momentum(prices) == pytest.approx(-.01)
    assert historical_volatility([100, 100, 100]) == 0
    assert historical_volatility([100]) is None
    assert maximum_drawdown([]) is None
    with pytest.raises(ValueError):
        historical_volatility([100, 0, 10])
    assert bid_ask_spread(99, 101) == pytest.approx(.02)
    assert price_divergence(90, 100) == pytest.approx(.1)


def test_finite_executable_depth():
    book = [BidLevel(price=99, quantity=2), BidLevel(price=90, quantity=3)]
    fill = execute_bids(10, 100, book)
    assert fill.proceeds == 468
    assert fill.fraction == .5
    assert fill.slippage == pytest.approx(.064)
    assert execute_bids(10, 100, []).proceeds == 0
    assert execute_bids(0, 100, book).fraction == 1
