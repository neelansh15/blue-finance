"""Analytical Morpho-like health semantics; not integer-exact EVM accounting."""


def health_factor(quantity: float, oracle_price: float, debt: float, threshold: float) -> float | None:
    return quantity * oracle_price * threshold / debt if debt > 0 else None


def position_status(quantity: float, price: float, debt: float, threshold: float,
                    recoverable: float, target_ltv: float | None, at_risk_hf: float) -> str:
    if debt == 0:
        return "HEALTHY"
    hf = health_factor(quantity, price, debt, threshold)
    # Morpho liquidation eligibility is strictly LTV > LLTV (HF < 1).
    if hf < 1:
        return "LIQUIDATABLE"
    if hf < at_risk_hf or recoverable < debt or (target_ltv is not None and debt > quantity * price * target_ltv):
        return "AT_RISK"
    return "HEALTHY"
