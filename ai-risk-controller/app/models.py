"""Validated service contracts. Money is USD; quantities are raw normalized tokens."""
from datetime import datetime
from enum import StrEnum
import math
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

NonNegative = Annotated[float, Field(ge=0)]
Positive = Annotated[float, Field(gt=0)]
Ratio = Annotated[float, Field(ge=0, le=1)]
Score = Annotated[float, Field(ge=0, le=100)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, validate_assignment=True)


class Session(StrEnum):
    REGULAR = "REGULAR"
    EXTENDED = "EXTENDED"
    OVERNIGHT = "OVERNIGHT"
    WEEKEND_CLOSED = "WEEKEND_CLOSED"
    HOLIDAY_CLOSED = "HOLIDAY_CLOSED"
    EARLY_CLOSE = "EARLY_CLOSE"
    HALTED = "HALTED"
    DATA_DEGRADED = "DATA_DEGRADED"


class OracleMode(StrEnum):
    FEED_24_5 = "24_5"
    SMOOTHED_24_7 = "24_7_smoothed"


class Source(Model):
    reference: str = Field(min_length=1)
    simulated: bool = True
    description: str = "Simulated demonstration data; not live observations."


class PricePoint(Model):
    at: AwareDatetime
    price: Positive


class BidLevel(Model):
    price: Positive
    quantity: Positive


class OracleObservation(Model):
    mode: OracleMode = OracleMode.FEED_24_5
    price: Positive | None = None
    observed_at: AwareDatetime | None = None
    published_at: AwareDatetime | None = None
    basis_risk: Ratio = 0
    smoothing_lag_seconds: NonNegative = 0
    price_unit: Literal['PER_NORMALIZED_TOKEN', 'PER_RAW_TOKEN'] = 'PER_NORMALIZED_TOKEN'
    ui_multiplier: Annotated[float, Field(ge=1e-9, le=1e9)] | None = None
    source: Source

    @model_validator(mode="after")
    def publication_order(self):
        if self.price_unit == 'PER_RAW_TOKEN' and self.ui_multiplier is None:
            raise ValueError('Raw-token oracle prices require an explicit UI multiplier')
        if self.price is not None and (not math.isfinite(self.normalized_price) or self.normalized_price <= 0):
            raise ValueError('Normalized oracle price must be finite and positive')
        if self.observed_at and self.published_at and self.observed_at > self.published_at:
            raise ValueError("Observation cannot postdate publication")
        return self

    @property
    def normalized_price(self) -> float | None:
        if self.price is not None and self.price_unit == 'PER_RAW_TOKEN':
            return self.price / self.ui_multiplier
        return self.price


class MarketData(Model):
    as_of: AwareDatetime
    underlying_price: Positive
    token_bid: Positive
    token_ask: Positive
    history: list[PricePoint] = Field(default_factory=list, max_length=5000)
    bids: list[BidLevel] = Field(default_factory=list, max_length=1000)
    volume_24h_usd: NonNegative
    previous_volume_24h_usd: NonNegative
    previous_depth_usd: NonNegative
    market_observed_at: AwareDatetime | None
    concentration: Ratio = 0.4
    halted: bool = False
    data_degraded: bool = False
    source: Source

    @model_validator(mode="after")
    def coherent(self):
        if self.token_bid > self.token_ask:
            raise ValueError("Crossed token market")
        if self.bids and self.bids[0].price > self.token_bid:
            raise ValueError("Order book bid exceeds quoted best bid")
        if any(a.price < b.price for a, b in zip(self.bids, self.bids[1:])):
            raise ValueError("Bids must be sorted by descending price")
        if any(a.at >= b.at for a, b in zip(self.history, self.history[1:])):
            raise ValueError("History must be strictly time ordered")
        if any(p.at > self.as_of for p in self.history):
            raise ValueError("History contains future information")
        if self.market_observed_at and self.market_observed_at > self.as_of:
            raise ValueError("Market observation is in the future")
        return self


class IssuerDocument(Model):
    document_id: str
    published_at: AwareDatetime
    text: str = Field(min_length=1, max_length=50000)
    source: Source


class RiskEvent(Model):
    asset: str
    event_type: Literal["REDEMPTION_RESTRICTION", "BACKING_CHANGE", "CORPORATE_ACTION", "REGULATORY", "SUSPENSION", "UNCERTAIN", "MARKET_SESSION", "ORACLE_STALE"]
    severity: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
    description: str
    confidence: Ratio
    source: str
    document_id: str | None = None
    evidence: str
    requires_review: bool = True
    simulated: bool = True


class Snapshot(Model):
    asset: str = "BNB_STOCK_NVDA"
    market: MarketData
    oracle: OracleObservation
    documents: list[IssuerDocument] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def no_future_data(self):
        dates = [self.oracle.observed_at, self.oracle.published_at]
        dates += [d.published_at for d in self.documents]
        if any(t and t > self.market.as_of for t in dates):
            raise ValueError("Snapshot contains future observations or documents")
        return self


class SessionInfo(Model):
    underlying_session: Session
    effective_session: Session
    # Older persisted evidence predates protocol-regime reporting.
    protocol_regime: Literal['OPEN', 'EXTENDED', 'CLOSED', 'WEEKEND', 'HALTED', 'CORP_ACTION'] | None = None
    exchange_timezone: str = "America/New_York"
    regular_open: AwareDatetime | None = None
    regular_close: AwareDatetime | None = None
    next_regular_open: AwareDatetime
    hours_to_next_open: NonNegative
    prolonged_closure_approaching: bool
    early_close_day: bool


class OracleHealth(Model):
    available: bool
    stale: bool
    observation_age_seconds: NonNegative | None
    publication_age_seconds: NonNegative | None
    risk_score: Score
    haircut: Ratio
    confidence: Ratio
    reasons: list[str]


class Metrics(Model):
    annualised_volatility: NonNegative | None
    maximum_drawdown: Ratio | None
    momentum: float | None
    spread: Ratio
    volume_24h_usd: NonNegative
    depth_usd: NonNegative
    expected_liquidation_slippage: Ratio
    executable_fraction: Ratio
    price_divergence: NonNegative
    oracle_price_divergence: NonNegative = 0
    reference_to_protocol_price: Ratio = 1
    liquidity_deterioration: Ratio


class RiskScore(Model):
    overall: Score
    factors: dict[str, Score]
    category: Literal["LOW", "MODERATE", "ELEVATED", "HIGH", "CRITICAL"]
    key_contributors: list[str]
    explanation: list[str]
    confidence: Ratio
    data_quality: list[str]


class Recovery(Model):
    quantity: NonNegative
    reference_price: Positive
    gross_value_usd: NonNegative
    recoverable_value_usd: NonNegative
    recovery_ratio: Ratio
    haircuts: dict[str, Ratio]
    expected_slippage: Ratio
    executable_fraction: Ratio
    confidence: Ratio
    assumptions: list[str]


class Assessment(Model):
    assessment_id: str
    asset: str
    as_of: AwareDatetime
    simulated: bool
    session: SessionInfo
    oracle: OracleHealth
    metrics: Metrics
    score: RiskScore
    recovery: Recovery
    events: list[RiskEvent]
    sources: list[Source]
    evidence_hash: str
    configuration_version: str
    model_version: str


class Parameters(Model):
    ltv: Ratio
    liquidation_threshold: Annotated[float, Field(gt=0, lt=1)]
    supply_cap: NonNegative  # token units
    borrow_cap: NonNegative  # USD
    liquidation_incentive: Annotated[float, Field(ge=0, le=0.3)]
    collateral_accepted: bool = True

    @model_validator(mode="after")
    def ordered(self):
        if self.ltv >= self.liquidation_threshold:
            raise ValueError("LTV must be below liquidation threshold")
        return self


class Borrower(Model):
    borrower_id: str = Field(min_length=1)
    collateral_quantity: Positive
    debt_usd: NonNegative
    liquidation_threshold: Annotated[float, Field(gt=0, lt=1)] = 0.625


class Scenario(Model):
    name: str = Field(min_length=1, max_length=100)
    price_drop: Annotated[float, Field(ge=0, lt=1)] = 0
    liquidity_multiplier: Ratio = 1
    oracle_stale: bool = False
    weekend: bool = False
    issuer_restriction: bool = False
    proposed_parameters: Parameters | None = None
    apply_threshold_to_existing: bool = False
    oracle_price_multiplier: Annotated[float, Field(gt=0, le=1)] = 1


class PositionImpact(Model):
    borrower_id: str
    current_ltv: NonNegative
    health_factor: NonNegative | None  # None = no debt (infinite health)
    status: Literal["HEALTHY", "AT_RISK", "LIQUIDATABLE"]
    previous_status: Literal["HEALTHY", "AT_RISK", "LIQUIDATABLE"]
    recoverable_value_usd: NonNegative
    estimated_bad_debt_usd: NonNegative
    additional_collateral_tokens: NonNegative


class SimulationResult(Model):
    scenario: str
    total_positions: int
    healthy: int
    at_risk: int
    liquidatable: int
    newly_at_risk: int
    newly_liquidatable: int
    debt_at_risk_usd: NonNegative
    estimated_bad_debt_usd: NonNegative
    additional_collateral_tokens: NonNegative
    safety_restoration_feasible: bool
    positions: list[PositionImpact]
    assumptions: list[str]


class Signature(Model):
    scheme: str
    signer_id: str
    value: str


class Recommendation(Model):
    recommendation_id: str
    asset: str
    chain_id: int = Field(ge=1)
    market_id: str
    risk_score: Score
    risk_category: str
    recommended_parameters: Parameters
    parameter_scope: str
    reasoning: list[str]
    simulation: SimulationResult
    approval_required: Literal[True] = True
    approval_status: Literal["PENDING_REVIEW"] = "PENDING_REVIEW"
    timestamp: AwareDatetime
    expires_at: AwareDatetime
    evidence_hash: str
    data_source_references: list[Source]
    configuration_version: str
    model_version: str
    confidence: Ratio
    simulated: bool
    payload_hash: str
    signing_status: Literal["UNSIGNED", "SIGNED"]
    signature: Signature | None = None

    @model_validator(mode="after")
    def valid_envelope(self):
        if self.expires_at <= self.timestamp:
            raise ValueError("Expiry must follow evidence timestamp")
        if (self.signing_status == "SIGNED") != (self.signature is not None):
            raise ValueError("Signature and signing status disagree")
        return self


class AssessRequest(Model):
    scenario: Literal["baseline", "friday", "saturday"] = "baseline"
    as_of: AwareDatetime | None = None
    oracle_mode: OracleMode = OracleMode.FEED_24_5
    liquidation_quantity: Positive = 1000
    snapshot: Snapshot | None = None


class SimulateRequest(AssessRequest):
    borrowers: list[Borrower] | None = Field(default=None, max_length=1000)
    scenarios: list[Scenario] | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def unique_borrowers(self):
        if self.borrowers and len({b.borrower_id for b in self.borrowers}) != len(self.borrowers):
            raise ValueError("Borrower IDs must be unique")
        return self
