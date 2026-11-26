from dataclasses import dataclass

from app.config import Policy
from app.models import Session, SessionInfo


@dataclass(frozen=True)
class SessionAdjustment:
    gap_floor: float
    horizon_days: float
    cap_multiplier: float
    extra_ltv_buffer: float
    reason: str


def adjustment(info: SessionInfo, policy: Policy) -> SessionAdjustment:
    s = info.effective_session
    if s in {Session.HALTED, Session.DATA_DEGRADED}:
        return SessionAdjustment(policy.halted_gap, max(3, info.hours_to_next_open / 24), 0, .15,
                                 f"{s}: stop new exposure pending review")
    if s in {Session.WEEKEND_CLOSED, Session.HOLIDAY_CLOSED} or info.prolonged_closure_approaching:
        return SessionAdjustment(policy.weekend_gap, max(2, info.hours_to_next_open / 24), .4, .06,
                                 "Prolonged closure: gap buffer; token liquidity assessed separately")
    if s in {Session.EXTENDED, Session.OVERNIGHT}:
        return SessionAdjustment(policy.overnight_gap, max(1, info.hours_to_next_open / 24), .7, .03,
                                 "Off-hours underlying price discovery; token market may remain executable")
    return SessionAdjustment(.01, 1, 1, 0, "Regular exchange session")
