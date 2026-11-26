"""Server-approved destinations and untrusted, explicitly simulated control observations."""
from typing import Literal
from pydantic import AwareDatetime, Field, model_validator
from app.integrations.market_status import AssetMarketStatus
from app.models import Assessment, AssessRequest, Model, Parameters, Ratio, Score


class ContractTarget(Model):
    target_id: str = Field(min_length=1)
    chain_id: int = Field(gt=0)
    market_id: str = Field(pattern=r'^0x[0-9a-fA-F]{64}$')
    contract_address: str = Field(pattern=r'^0x[0-9a-fA-F]{40}$')
    collateral_asset: str = Field(min_length=1)
    underlying_venue: str = Field(min_length=1)
    underlying_ticker: str | None = Field(default=None, pattern=r'^[A-Z0-9.\-]{1,20}$')
    collateral_token_address: str | None = Field(default=None, pattern=r'^0x[0-9a-fA-F]{40}$')
    binance_spot_symbol: str | None = Field(default=None, pattern=r'^[A-Z0-9]{1,30}$')
    loan_asset: str = 'USDT'
    market_lltv: float = Field(default=.625, gt=0, lt=1)
    approved: bool = False
    enabled: bool = True
    simulated: bool = True

    @model_validator(mode='after')
    def nonzero(self):
        if (int(self.contract_address, 16) == 0 or int(self.market_id, 16) == 0 or
                self.collateral_token_address is not None and int(self.collateral_token_address, 16) == 0):
            raise ValueError('Zero contract address or market identity is not a destination')
        return self


class RoutingPolicy(Model):
    version: str = 'market-routing-v0.1'
    targets: list[ContractTarget] = Field(min_length=1, max_length=50)
    max_score: Score = 60
    max_annualised_volatility: float = Field(default=.65, gt=0)
    min_recovery_ratio: Ratio = .70
    observation_max_age_seconds: int = Field(default=300, gt=0, le=3600)
    expiry_seconds: int = Field(default=300, gt=0, le=3600)

    @model_validator(mode='after')
    def unique_targets(self):
        if len({t.target_id for t in self.targets}) != len(self.targets):
            raise ValueError('Duplicate target IDs')
        identities = {(t.chain_id, t.contract_address.lower(), t.market_id.lower()) for t in self.targets}
        if len(identities) != len(self.targets):
            raise ValueError('Duplicate contract/market identities')
        return self


class Controls(Model):
    observed_at: AwareDatetime | None = None
    source_reference: str = Field(default='', max_length=2000)
    government_pause: Literal['NONE', 'ASSET', 'VENUE', 'GLOBAL', 'UNKNOWN'] = 'UNKNOWN'
    governance_paused: bool | None = None
    token_transfers_paused: bool | None = None


class MarketInput(Model):
    target_id: str
    controls: Controls = Field(default_factory=Controls)
    assessment: AssessRequest = Field(default_factory=AssessRequest)


class RoutingRequest(Model):
    status_mode: Literal['LIVE', 'SIMULATED'] = 'LIVE'
    as_of: AwareDatetime
    primary_target_id: str
    markets: list[MarketInput] = Field(min_length=1, max_length=50)

    @model_validator(mode='after')
    def unique_inputs(self):
        ids = [m.target_id for m in self.markets]
        if len(ids) != len(set(ids)) or self.primary_target_id not in ids:
            raise ValueError('Unique market inputs including the primary target are required')
        return self


class MarketEvaluation(Model):
    target: ContractTarget
    controls: Controls | None
    market_status: AssetMarketStatus | None = None
    eligible: bool
    reasons: list[str]
    assessment: Assessment | None = None
    parameters: Parameters | None = None


class RoutingDecision(Model):
    decision_id: str
    action: Literal['KEEP_CURRENT', 'PROPOSE_ALTERNATIVE', 'HOLD_NEW_EXPOSURE']
    primary_target_id: str
    proposed_target: ContractTarget | None
    evaluations: list[MarketEvaluation]
    reasoning: list[str]
    timestamp: AwareDatetime
    expires_at: AwareDatetime
    evidence_hash: str
    configuration_version: str
    approval_required: Literal[True] = True
    approval_status: Literal['PENDING_REVIEW'] = 'PENDING_REVIEW'
    signing_status: Literal['UNSIGNED'] = 'UNSIGNED'
    simulated: Literal[True] = True
    scope: str = 'Advisory new-exposure selection only; no transactions or existing debt/collateral migration'
