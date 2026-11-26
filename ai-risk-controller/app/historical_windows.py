"""Reproducible exchange-calendar windows from supplied, adjusted observations. No data vendor is implied."""
from bisect import bisect_right
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, Field, StrictBool, model_validator

from app.calibration import CalibrationManifest, GapObservation
from app.market_sessions.calendar import exchange_calendar
from app.models import Model


class AdjustedPoint(Model):
    at: AwareDatetime
    price: Decimal = Field(ge=Decimal('1e-12'), le=Decimal('1e12'))


class HistoricalEvent(Model):
    start: AwareDatetime
    end: AwareDatetime
    kind: Literal['EARNINGS', 'HALT', 'CORPORATE_ACTION']
    reference: str = Field(min_length=1)

    @model_validator(mode='after')
    def ordered(self):
        if self.start >= self.end:
            raise ValueError('Event window must be ordered')
        return self


class AdjustedHistory(Model):
    asset: str = Field(min_length=1)
    source_reference: str = Field(min_length=1)
    corporate_action_adjusted: StrictBool = False
    simulated: StrictBool = True
    points: list[AdjustedPoint] = Field(min_length=2, max_length=100000)
    events: list[HistoricalEvent] = Field(default_factory=list, max_length=1000)

    @model_validator(mode='after')
    def ordered(self):
        if any(a.at >= b.at for a,b in zip(self.points, self.points[1:])):
            raise ValueError('Adjusted observations must be strictly ordered and unique')
        return self


def build_windows(history: AdjustedHistory, as_of: datetime, tolerance_seconds: int = 60):
    if as_of.tzinfo is None or as_of > datetime.now(timezone.utc) or not 0 <= tolerance_seconds <= 300:
        raise ValueError('Timezone-aware cutoff and bounded observation tolerance required')
    if any(p.at > as_of for p in history.points) or any(e.end > as_of for e in history.events):
        raise ValueError('Future observations/events cannot construct historical windows')
    points, times = history.points, [p.at for p in history.points]
    tz = ZoneInfo('America/New_York')
    schedule = exchange_calendar().schedule(start_date=times[0].date()-timedelta(days=1),
                                             end_date=times[-1].date()+timedelta(days=7))
    windows, missing = {}, []

    def emit(regime, start, end, event='NONE'):
        if end > as_of or start < times[0] or start >= end:
            return
        indices = [bisect_right(times, boundary)-1 for boundary in (start,end)]
        if any(i < 0 or (boundary-times[i]).total_seconds() > tolerance_seconds
               for boundary,i in zip((start,end), indices)):
            missing.append({'regime': regime, 'start': start.isoformat(), 'end': end.isoformat()})
            return
        overlaps = [e.kind for e in history.events if e.start < end and e.end > start]
        tag = event if event != 'NONE' else (overlaps[0] if overlaps else 'HOLIDAY' if regime == 'WEEKEND' and (end-start).total_seconds() >= 72*3600 else 'NONE')
        identity = (start,end)
        if identity in windows and regime == 'INTRADAY_BUFFER':
            return  # a window cannot masquerade as two independent observations
        windows[identity] = GapObservation(asset=history.asset, regime=regime, window_start=start,
            window_end=end, start_price=points[indices[0]].price, end_price=points[indices[1]].price, event=tag)

    sessions = list(schedule.itertuples())
    for index, row in enumerate(sessions):
        opened, closed = row.market_open.to_pydatetime(), row.market_close.to_pydatetime()
        local = opened.astimezone(tz)
        # Match the protocol's declared 17:00 post-market end on a 13:00 early close.
        # Extended-session executability is still an assumption, not established by the cash calendar.
        post_hour = 17 if closed.astimezone(tz).hour == 13 else 20
        pre, post = local.replace(hour=4, minute=0), local.replace(hour=post_hour, minute=0)
        emit('OPEN', opened, closed)
        emit('EXTENDED', pre, opened)
        emit('EXTENDED', closed, post)
        if index+1 < len(sessions):
            next_pre = sessions[index+1].market_open.to_pydatetime().astimezone(tz).replace(hour=4,minute=0)
            regime = 'WEEKEND' if (next_pre.date()-post.date()).days > 1 else 'CLOSED'
            emit(regime, post, next_pre, 'HOLIDAY' if regime == 'WEEKEND' and post.weekday() != 4 else 'NONE')
        inside = [p for p in points if opened <= p.at <= closed]
        for a,b in zip(inside, inside[1:]):
            if (b.at-a.at).total_seconds() <= 3600:
                emit('INTRADAY_BUFFER', a.at, b.at)
    for event in history.events:
        if event.kind != 'EARNINGS':
            emit('HALTED' if event.kind == 'HALT' else 'CORP_ACTION', event.start, event.end, event.kind)
    rows = sorted(windows.values(), key=lambda r: (r.window_start,r.regime))
    manifest = CalibrationManifest(asset=history.asset, source_reference=history.source_reference,
        simulated=history.simulated, corporate_action_adjusted=history.corporate_action_adjusted,
        methodology=f'NASDAQ schedule; actual DST/holidays/early closes; regular, extended, overnight and closure windows. '
                    f'Last supplied observation at or before each boundary, at most {tolerance_seconds}s old. '
                    'No missing boundary is interpolated. Intraday intervals <=1h; explicit event windows. '
                    'Non-overlap does not establish independence. Adjustment and vendor authenticity require review.')
    return rows, manifest, missing
