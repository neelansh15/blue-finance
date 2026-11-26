"""Finite executable-depth recovery with disjoint haircut attribution."""
import math

from app.config import Policy
from app.market_sessions.session_policy import SessionAdjustment
from app.models import BidLevel, Recovery
from app.risk.liquidity import execute_bids


def recoverable_value(quantity: float, reference_price: float, bids: list[BidLevel],
                      volatility: float | None, session: SessionAdjustment, issuer_haircut: float,
                      oracle_haircut: float, confidence: float, policy: Policy,
                      *, liquidity_multiplier: float = 1) -> Recovery:
    # Gap floor and volatility overlap: use their maximum, not their sum.
    volatility_haircut = max(session.gap_floor, min(.8, policy.volatility_stress_z *
                              (volatility if volatility is not None else 1) * math.sqrt(session.horizon_days / 252)))
    execution = execute_bids(quantity, reference_price, bids, liquidity_multiplier)
    liquidity_haircut = 1 - execution.fraction
    # Spread and book price impact already appear in average execution price.
    execution_haircut = 1 - (1 - execution.slippage) * (1 - policy.execution_fee)
    haircuts = {"volatility": volatility_haircut, "liquidity": liquidity_haircut,
                "execution": execution_haircut, "issuer": issuer_haircut, "oracle": oracle_haircut}
    ratio = math.prod(1 - h for h in haircuts.values())
    gross = quantity * reference_price
    return Recovery(quantity=quantity, reference_price=reference_price, gross_value_usd=gross,
                    recoverable_value_usd=gross * ratio, recovery_ratio=ratio, haircuts=haircuts,
                    expected_slippage=execution.slippage, executable_fraction=execution.fraction,
                    confidence=min(confidence, .8 if execution.fraction == 1 else .35),
                    assumptions=["Illustrative model, not calibrated or validated for production",
                                 "Volatility stress is max(z-sigma horizon loss, session gap floor); no additive gap double count",
                                 "Liquidity haircut is unfilled quantity only; unfilled inventory has zero immediate recovery",
                                 "Execution haircut contains bid spread, price impact and fees exactly once",
                                 "Bids capped at conservative reference price; no extra divergence haircut",
                                 "Issuer haircut assumes reduced realisation; redemption is not guaranteed",
                                 "Oracle haircut represents reference uncertainty; separate from price-gap stress"])
