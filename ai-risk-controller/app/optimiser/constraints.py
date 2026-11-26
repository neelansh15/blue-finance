from app.config import Policy
from app.models import Parameters


def validate_bounds(parameters: Parameters, policy: Policy) -> None:
    if not policy.min_liquidation_threshold <= parameters.liquidation_threshold <= policy.max_liquidation_threshold:
        raise ValueError("Liquidation threshold outside governance bounds")
    if parameters.ltv > policy.max_ltv or parameters.ltv > parameters.liquidation_threshold - policy.ltv_buffer + 1e-12:
        raise ValueError("LTV violates governance maximum or minimum safety buffer")
    if parameters.supply_cap > policy.max_supply_tokens or parameters.borrow_cap > policy.max_borrow_usd:
        raise ValueError("Exposure exceeds governance caps")
    if policy.immutable_threshold and parameters.liquidation_threshold != policy.market_lltv:
        raise ValueError("Existing Morpho market LLTV is immutable")
    if policy.immutable_threshold and parameters.ltv > policy.router_target_ltv + 1e-12:
        raise ValueError("LTV exceeds configured DawnRouter haircut/margin ceiling")
    if policy.immutable_threshold and abs(parameters.liquidation_incentive - morpho_incentive(policy.market_lltv)) > 1e-12:
        raise ValueError("Existing Morpho market liquidation incentive is fixed by its LLTV")
    if not parameters.collateral_accepted and (parameters.ltv or parameters.borrow_cap or parameters.supply_cap):
        raise ValueError("Rejected collateral cannot acquire new exposure")


def morpho_incentive(lltv: float) -> float:
    return min(1.15, 1 / (1 - .3 * (1 - lltv))) - 1
