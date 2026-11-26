"""Immutable-per-service, versioned risk policy. Defaults are illustrative, not calibrated."""
import hashlib
import json
import os
from pathlib import Path
from typing import Annotated

from pydantic import Field, model_validator

from app.declared import DECLARED, BLUE_DEFAULTS
from app.models import Model, NonNegative, Positive, Ratio


class Policy(Model):
    version: str = "hackathon-v0.1"
    model_version: str = "risk-engine-v0.1"
    weights: dict[str, Ratio] = Field(default_factory=lambda: {
        "volatility": .25, "liquidity": .25, "issuer": .20, "oracle": .15, "concentration": .15})
    category_thresholds: list[float] = Field(default_factory=lambda: [20, 40, 60, 80])
    min_history_points: int = Field(default=20, ge=3)
    history_max_age_hours: Positive = 120
    oracle_max_age_seconds: Positive = 300
    oracle_max_age_by_regime: dict[str, Positive] | None = None
    market_max_age_seconds: Positive = 300
    max_price_divergence: Ratio = .10
    volatility_stress_z: Positive = 2.33
    execution_fee: Ratio = .003
    execution_delay_seconds: Positive = 300
    liquidation_gas_budget_usd: NonNegative = 25
    liquidity_stress_multiplier: Ratio = .5
    max_liquidation_slippage: Ratio = .05
    minimum_liquidation_horizon_seconds: dict[str, Positive] = Field(default_factory=lambda: {
        'OPEN': 300, 'EXTENDED': 3600, 'CLOSED': 28800, 'WEEKEND': 259200})
    min_liquidation_threshold: Positive = .30
    max_liquidation_threshold: Ratio = .77
    market_lltv: Positive = int(DECLARED["market"]["lltv_wad"]) / 1e18
    router_hmax: Ratio = max(BLUE_DEFAULTS["haircuts_bps"][r] for r in DECLARED["regime_order"][:4]) / 10000
    router_margin: Annotated[float, Field(ge=0, le=.5)] = BLUE_DEFAULTS["margin_bps"] / 10000
    max_ltv: Ratio = .60
    ltv_buffer: Positive = .08
    max_supply_tokens: NonNegative = BLUE_DEFAULTS["supply_cap_tokens"]
    max_borrow_usd: NonNegative = 5000000
    depth_participation: Ratio = .25
    volume_participation: Ratio = .05
    recovery_safety_margin: Ratio = .10
    at_risk_health_factor: Positive = 1.15
    recommendation_ttl_seconds: int = Field(default=900, ge=1, le=604800)
    immutable_threshold: bool = True
    weekend_gap: Ratio = .08
    overnight_gap: Ratio = .03
    halted_gap: Ratio = .20
    issuer_restriction_haircut: Ratio = .25
    near_close_minutes: Positive = 60

    @model_validator(mode="after")
    def valid_policy(self):
        if set(self.minimum_liquidation_horizon_seconds) != {'OPEN', 'EXTENDED', 'CLOSED', 'WEEKEND'}:
            raise ValueError('Liquidation horizons require exactly four routine regimes')
        if self.oracle_max_age_by_regime is not None and set(self.oracle_max_age_by_regime) != {
            'OPEN', 'EXTENDED', 'CLOSED', 'WEEKEND', 'HALTED', 'CORP_ACTION'
        }:
            raise ValueError('Per-regime oracle freshness requires all six Blue regimes')
        if set(self.weights) != {"volatility", "liquidity", "issuer", "oracle", "concentration"}:
            raise ValueError("Exactly five known risk weights are required")
        if abs(sum(self.weights.values()) - 1) > 1e-9:
            raise ValueError("Weights must sum to one")
        t = self.category_thresholds
        if len(t) != 4 or not 0 < t[0] < t[1] < t[2] < t[3] < 100:
            raise ValueError("Four ordered category thresholds in (0,100) required")
        if not 0 < self.min_liquidation_threshold <= self.market_lltv <= self.max_liquidation_threshold < 1:
            raise ValueError("Market LLTV must lie within governance bounds")
        if not self.ltv_buffer < self.min_liquidation_threshold or self.max_ltv >= self.max_liquidation_threshold:
            raise ValueError("Invalid LTV bounds or buffer")
        if self.at_risk_health_factor <= 1:
            raise ValueError("At-risk health factor must exceed 1")
        if self.router_target_ltv <= 0:
            raise ValueError("Router haircut and margin leave no borrowing capacity")
        return self

    @property
    def router_target_ltv(self) -> float:
        return self.market_lltv * (1 - self.router_hmax) - self.router_margin

    @property
    def fingerprint(self) -> str:
        raw = json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        return f"{self.version}:{hashlib.sha256(raw.encode()).hexdigest()[:16]}"


def load_policy() -> Policy:
    path = os.getenv("RISK_CONFIG_PATH")
    return Policy.model_validate_json(Path(path).read_text()) if path else Policy()
