from typing import Protocol

from app.config import Policy
from app.market_sessions.session_policy import adjustment
from app.models import Assessment, Parameters
from app.optimiser.constraints import morpho_incentive, validate_bounds
from app.risk.issuer import issuer_risk


class Optimiser(Protocol):
    def recommend(self, assessment: Assessment) -> tuple[Parameters, list[str]]: ...


class RuleBasedOptimiser:
    def __init__(self, policy: Policy):
        self.policy = policy

    def recommend(self, assessment: Assessment) -> tuple[Parameters, list[str]]:
        p, a = self.policy, assessment
        session = adjustment(a.session, p)
        _, issuer_haircut, issuer_block = issuer_risk(a.events, p)
        recovery = a.recovery.recovery_ratio
        threshold = p.market_lltv
        if not p.immutable_threshold:
            threshold = min(p.max_liquidation_threshold, max(p.min_liquidation_threshold,
                            recovery - p.recovery_safety_margin))
        incentive = morpho_incentive(threshold)
        # Independent constraints, not a risk-score-to-LTV lookup table.
        price_ratio = a.metrics.reference_to_protocol_price
        recovery_limit = recovery * price_ratio * (1 - p.recovery_safety_margin) / (1 + incentive)
        volatility = a.metrics.annualised_volatility
        volatility_limit = (p.max_ltv - min(.3, (volatility if volatility is not None else 1) * .2)) * price_ratio
        ltv = max(0, min(p.max_ltv, threshold - p.ltv_buffer - session.extra_ltv_buffer,
                         recovery_limit - session.extra_ltv_buffer, volatility_limit))
        if p.immutable_threshold:
            ltv = min(ltv, p.router_target_ltv * price_ratio)
        depth_budget = a.metrics.depth_usd * p.depth_participation
        volume_budget = a.metrics.volume_24h_usd * p.volume_participation
        supply = min(p.max_supply_tokens, min(depth_budget, volume_budget) / a.recovery.reference_price)
        supply *= session.cap_multiplier * (1 - issuer_haircut)
        reasons = [session.reason, f"Recovery constraint: {recovery_limit:.4f} before session buffer",
                   f"Configured BlueRouter ceiling: {p.router_target_ltv:.5f}; deployment parameters must be verified",
                   f"Volatility constraint: {volatility_limit:.4f}",
                   "Supply cap in tokens; borrow cap in USD; exposure constrained by executable depth and volume",
                   "Target LTV is measured against the protocol oracle; conservative-reference/oracle conversion prevents price-premium overborrowing",
                   "LLTV stays immutable; target LTV is advisory router policy" if p.immutable_threshold else
                   "Mutable threshold proposal requires explicit protocol support and governance approval"]
        blocked = (issuer_block or a.oracle.stale or not a.oracle.available or bool(a.score.data_quality)
                   or session.cap_multiplier == 0 or recovery_limit < p.ltv_buffer)
        if blocked:
            ltv, supply = 0, 0
            reasons.append("Stop new collateral/borrowing: issuer uncertainty/restriction, stale data, or insufficient recovery")
        borrow = min(p.max_borrow_usd, supply * a.recovery.reference_price * ltv)
        params = Parameters(ltv=ltv, liquidation_threshold=threshold, supply_cap=supply,
                            borrow_cap=borrow, liquidation_incentive=incentive, collateral_accepted=not blocked)
        validate_bounds(params, p)
        return params, reasons
