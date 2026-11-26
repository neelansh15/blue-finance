from datetime import datetime, time
from zoneinfo import ZoneInfo

from app.config import Policy
from app.market_sessions.calendar import schedule_around
from app.models import Session, SessionInfo

EASTERN = ZoneInfo("America/New_York")


def detect_session(at: datetime, policy: Policy, *, halted: bool = False, degraded: bool = False) -> SessionInfo:
    local = at.astimezone(EASTERN)
    schedule = schedule_around(at)
    today = schedule[schedule.index.date == local.date()]
    future = schedule[schedule.market_open > at]
    if future.empty:
        raise ValueError("Exchange calendar has no future session")
    next_open = future.iloc[0].market_open.to_pydatetime()
    opened = closed = None
    early = approaching = False
    if today.empty:
        session = Session.WEEKEND_CLOSED if local.weekday() >= 5 else Session.HOLIDAY_CLOSED
    else:
        row = today.iloc[0]
        opened, closed = row.market_open.to_pydatetime(), row.market_close.to_pydatetime()
        early = closed.astimezone(EASTERN).time() < time(16)
        if opened <= at < closed:
            session = Session.EARLY_CLOSE if early else Session.REGULAR
            until_close = (closed - at).total_seconds() / 60
            approaching = until_close <= policy.near_close_minutes and (next_open - closed).total_seconds() > 36 * 3600
        elif time(4) <= local.time() < time(20):
            session = Session.EXTENDED
        else:
            session = Session.OVERNIGHT
    effective = Session.HALTED if halted else Session.DATA_DEGRADED if degraded else session
    return SessionInfo(underlying_session=session, effective_session=effective, regular_open=opened,
                       regular_close=closed, next_regular_open=next_open,
                       hours_to_next_open=max(0, (next_open - at).total_seconds() / 3600),
                       prolonged_closure_approaching=approaching, early_close_day=early)
