from datetime import datetime, timedelta
from unittest.mock import Mock

import pytest

from app.config import Policy
from app.integrations.providers import DEMO_TIMES
from app.market_sessions import calendar
from app.models import AssessRequest
from app.services.risk_service import RiskService
from app.services.store import AuditStore


@pytest.fixture
def calendar_calls(monkeypatch):
    calendar._schedule.cache_clear()
    exchange = calendar.exchange_calendar()
    calls = Mock(wraps=exchange.schedule)
    monkeypatch.setattr(exchange, 'schedule', calls)
    yield calls
    calendar._schedule.cache_clear()


def test_five_asset_refresh_reuses_calendar_but_recalculates_fresh_evidence(calendar_calls):
    store = AuditStore(':memory:')
    try:
        service = RiskService(Policy(), store)
        at = DEMO_TIMES['baseline']
        assets = list(dict.fromkeys(service.assets.values()))
        for instant in [at, at + timedelta(seconds=5)]:
            for asset in assets:
                assessment, _ = service.assess(asset, AssessRequest(as_of=instant))
                assert assessment.as_of == instant
                assert assessment.oracle.observation_age_seconds == 15
        # Two calendar ranges across all assets and both calculation cycles.
        assert calendar_calls.call_count == 2
        for asset in assets:
            rows = store.history('assessment', asset)
            assert len(rows) == 2
            assert rows[0]['assessment']['evidence_hash'] != rows[1]['assessment']['evidence_hash']
    finally:
        store.close()


def test_schedule_cache_is_date_sensitive_and_caller_mutations_are_isolated(calendar_calls):
    at = datetime.fromisoformat('2026-11-27T17:00:00+00:00')
    original = calendar.schedule_around(at)
    expected = original.iloc[0].market_close
    original.iloc[0, original.columns.get_loc('market_close')] = expected + timedelta(hours=5)
    again = calendar.schedule_around(at + timedelta(minutes=1))
    assert again.iloc[0].market_close == expected
    assert calendar_calls.call_count == 1
    calendar.schedule_around(at + timedelta(days=1))
    assert calendar_calls.call_count == 2
