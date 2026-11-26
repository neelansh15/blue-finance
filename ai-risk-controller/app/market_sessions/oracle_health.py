from datetime import datetime

from app.config import Policy
from app.models import OracleHealth, OracleMode, OracleObservation


def assess_oracle(observation: OracleObservation, at: datetime, policy: Policy) -> OracleHealth:
    observed_age = (at - observation.observed_at).total_seconds() if observation.observed_at else None
    published_age = (at - observation.published_at).total_seconds() if observation.published_at else None
    if any(age is not None and age < 0 for age in [observed_age, published_age]):
        raise ValueError("Future-dated oracle data")
    available = observation.price is not None and observed_age is not None and published_age is not None
    if not available:
        return OracleHealth(available=False, stale=True, observation_age_seconds=observed_age,
                            publication_age_seconds=published_age, risk_score=100, haircut=.4, confidence=0,
                            reasons=["Oracle price or observation/publication timestamp missing"])
    # Publication freshness cannot compensate for an old underlying observation.
    age = max(observed_age + observation.smoothing_lag_seconds, published_age)
    stale = age > policy.oracle_max_age_seconds
    reasons = ["Observation and publication timestamps checked independently"]
    if stale:
        reasons.append("Underlying observation or transport is stale despite possible republishing")
    basis = observation.basis_risk
    if observation.mode == OracleMode.SMOOTHED_24_7:
        basis = max(.02, basis)
        reasons.append("24/7 smoothed reference includes lag and basis uncertainty; not an executable equity quote")
    score = min(100, (90 if stale else 15 * age / policy.oracle_max_age_seconds) + basis * 200)
    haircut = min(.45, (.20 if stale else 0) + basis)
    return OracleHealth(available=True, stale=stale, observation_age_seconds=observed_age,
                        publication_age_seconds=published_age, risk_score=score, haircut=haircut,
                        confidence=.25 if stale else max(.4, .95 - basis * 3), reasons=reasons)
