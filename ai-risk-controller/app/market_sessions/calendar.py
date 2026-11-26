"""Exchange schedule, including DST, holidays and scheduled early closes."""
from datetime import datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

import pandas_market_calendars as mcal


@lru_cache(maxsize=1)
def exchange_calendar():
    return mcal.get_calendar("NASDAQ")


def schedule_around(at: datetime):
    day = at.astimezone(ZoneInfo("America/New_York")).date()
    return exchange_calendar().schedule(start_date=day - timedelta(days=14), end_date=day + timedelta(days=21))


def last_regular_close(at: datetime) -> datetime:
    rows = schedule_around(at)
    past = rows[rows.market_close <= at]
    if past.empty:
        raise ValueError("No preceding exchange close available")
    return past.iloc[-1].market_close.to_pydatetime()
