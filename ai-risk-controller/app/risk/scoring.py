from app.config import Policy
from app.models import Metrics, OracleHealth, RiskScore


def category(score: float, policy: Policy) -> str:
    for bound, label in zip(policy.category_thresholds, ["LOW", "MODERATE", "ELEVATED", "HIGH"]):
        if score <= bound:
            return label
    return "CRITICAL"


def score_risk(metrics: Metrics, issuer: float, oracle: OracleHealth, concentration: float,
               data_quality: list[str], policy: Policy) -> RiskScore:
    vol = 100 if metrics.annualised_volatility is None else min(100, metrics.annualised_volatility / .8 * 100)
    liquidity = min(100, 100 * max(metrics.spread / .05, 1 - metrics.executable_fraction,
                                  metrics.liquidity_deterioration, metrics.expected_liquidation_slippage / .20))
    factors = {"volatility": vol, "liquidity": liquidity, "issuer": issuer,
               "oracle": oracle.risk_score, "concentration": concentration * 100}
    overall = sum(factors[k] * weight for k, weight in policy.weights.items())
    ranked = sorted(factors, key=lambda k: factors[k] * policy.weights[k], reverse=True)
    confidence = min(oracle.confidence, .9 if not data_quality else .35)
    return RiskScore(overall=round(overall, 4), factors=factors, category=category(overall, policy),
                     key_contributors=ranked[:3], confidence=confidence, data_quality=data_quality,
                     explanation=[f"{k}: {factors[k]:.2f}/100 × weight {policy.weights[k]:.2f} "
                                  f"= {factors[k] * policy.weights[k]:.2f}" for k in ranked])
