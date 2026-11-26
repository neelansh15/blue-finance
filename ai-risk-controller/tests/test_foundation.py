from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.config import Policy
from app.models import AssessRequest, Borrower, Parameters
from app.integrations.providers import DEMO_TIMES, MockProviders, synthetic_borrowers
from app.models import OracleMode


def test_policy_constraints_and_fingerprint():
    assert Policy().fingerprint == Policy().fingerprint
    assert Policy(version="changed").fingerprint != Policy().fingerprint
    with pytest.raises(ValidationError):
        Policy(weights={"oracle": 1})
    with pytest.raises(ValidationError):
        Policy(market_lltv=.9)


def test_invalid_inputs():
    with pytest.raises(ValidationError):
        Parameters(ltv=.6, liquidation_threshold=.5, supply_cap=1, borrow_cap=1, liquidation_incentive=.05)
    with pytest.raises(ValidationError):
        Borrower(borrower_id="a", collateral_quantity=1, debt_usd=float("nan"))
    with pytest.raises(ValidationError):
        AssessRequest(as_of=datetime(2026, 11, 26))
    assert AssessRequest(as_of=datetime.now(timezone.utc)).as_of.tzinfo


def test_reproducible_mock_providers():
    provider = MockProviders()
    args = ("BNB_STOCK_NVDA", DEMO_TIMES["saturday"], "saturday", OracleMode.FEED_24_5)
    a, b = provider.snapshot(*args), provider.snapshot(*args)
    assert a == b
    assert a.market.source.simulated
    assert a.oracle.observed_at < a.oracle.published_at
    assert len(synthetic_borrowers()) == 120
