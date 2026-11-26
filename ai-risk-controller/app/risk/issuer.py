from app.config import Policy
from app.models import RiskEvent


def issuer_risk(events: list[RiskEvent], policy: Policy) -> tuple[float, float, bool]:
    """Return severity score, recovery haircut, and restriction on new exposure."""
    severity = {"LOW": 20, "MODERATE": 45, "HIGH": 85, "CRITICAL": 100}
    issuer_events = [e for e in events if e.event_type not in {"MARKET_SESSION", "ORACLE_STALE"}]
    score = max([15.0] + [float(severity[e.severity]) for e in issuer_events])
    restricted = any(e.event_type in {"REDEMPTION_RESTRICTION", "SUSPENSION", "BACKING_CHANGE"}
                     and e.severity in {"HIGH", "CRITICAL"} for e in issuer_events)
    uncertain = any(e.event_type == "UNCERTAIN" for e in issuer_events)
    haircut = policy.issuer_restriction_haircut if restricted else .15 if uncertain else .02
    return score, haircut, restricted or uncertain
