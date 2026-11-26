"""Debt capacity from one shared, finite TOKEN bid book. No underlying-share volume substitution."""
import math

from app.config import Policy
from app.models import MarketData, SessionInfo
from app.optimiser.constraints import morpho_incentive

REGIMES = ('OPEN', 'EXTENDED', 'CLOSED', 'WEEKEND', 'HALTED', 'CORP_ACTION')


def liquidation_budgets(market: MarketData, reference: float, volatility: float | None,
                        session: SessionInfo, issuer_haircut: float, oracle_haircut: float,
                        policy: Policy) -> dict[str, float]:
    """Ceilings apply to the aggregate liquidation, never once per borrower.

    Participation, delay, loss floors and liquidity shocks remain declared assumptions.
    Returns zero for stale/unknown execution evidence. It does not calibrate the assumptions.
    """
    budgets = dict.fromkeys(REGIMES, 0.0)
    if (volatility is None or not market.market_observed_at or market.data_degraded
            or (market.as_of - market.market_observed_at).total_seconds() > policy.market_max_age_seconds):
        return budgets
    remaining = min(policy.max_supply_tokens, market.volume_24h_usd * policy.volume_participation / reference)
    proceeds = 0.0
    for level in market.bids:
        price = min(reference, level.price)
        if price < reference * (1 - policy.max_liquidation_slippage):
            break
        fill = min(remaining, level.quantity * policy.depth_participation * policy.liquidity_stress_multiplier)
        proceeds += fill * price
        remaining -= fill
        if remaining <= 0:
            break
    floors = {'OPEN': .01, 'EXTENDED': policy.overnight_gap, 'CLOSED': policy.overnight_gap,
              'WEEKEND': policy.weekend_gap}
    for regime, floor in floors.items():
        horizon = max(policy.execution_delay_seconds, policy.minimum_liquidation_horizon_seconds[regime])
        if regime != 'OPEN':
            horizon = max(horizon, session.hours_to_next_open * 3600)
        loss = min(1, max(floor, policy.volatility_stress_z * volatility * math.sqrt(horizon / (365 * 86400))))
        stressed = proceeds * (1-loss) * (1-issuer_haircut) * (1-oracle_haircut) * (1-policy.execution_fee)
        budgets[regime] = max(0, stressed-policy.liquidation_gas_budget_usd) * (1-policy.recovery_safety_margin) / (
            1 + morpho_incentive(policy.market_lltv))
    return budgets
