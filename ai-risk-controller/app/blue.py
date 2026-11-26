"""Reviewable Blue configuration proposals. No transaction or approval executor."""
import math
import os
from decimal import Decimal, ROUND_DOWN, localcontext
from pathlib import Path
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from app.config import Policy
from app.integrations.signing import evidence_hash
from app.models import Assessment, Model, Recommendation

REGIMES = ('OPEN', 'EXTENDED', 'CLOSED', 'WEEKEND', 'HALTED', 'CORP_ACTION')
ROUTINE = REGIMES[:4]


class BlueConfig(Model):
    """Declared deployment settings; defaults match BlueDeploy's mock path."""
    profile: Literal['MOCK_UI_SHARE', 'ATLAS_RAW_TOKEN'] = 'MOCK_UI_SHARE'
    haircuts_bps: dict[str, int] = Field(default_factory=lambda: dict(zip(REGIMES, [0, 400, 1000, 1500, 2500, 1000])))
    staleness_seconds: dict[str, int] = Field(default_factory=lambda: dict(zip(REGIMES, [3600, 3600, 14400, 21600, 3600, 3600])))
    margin_bps: int = Field(default=200, ge=0, le=5000)
    total_borrow_cap_usd: float = Field(default=1_000_000, ge=0)
    regime_caps_usd: dict[str, float] = Field(default_factory=lambda: dict(zip(REGIMES, [1_000_000, 500_000, 250_000, 250_000, 0, 0])))
    loan_decimals: int = Field(default=18, ge=0, le=36)
    continuity_band_bps: int = Field(default=500, gt=0, le=5000)
    jump_band_bps: int = Field(default=3000, ge=0, le=1_000_000)
    max_freeze_seconds: int = Field(default=43200, gt=0, lt=2**64)
    expired_freeze_haircut_bps: int = Field(default=1000, ge=0, le=5000)
    eligibility_ttl_seconds: int = Field(default=900, gt=0, le=3600)
    max_override_seconds: int = Field(default=259200, gt=0, le=30*86400)
    keeper_can_clear: bool = False
    override_duration_seconds: int = Field(default=3600, gt=0)
    refresh_margin_seconds: int = Field(default=600, ge=0)
    unknown_timeout_seconds: int = Field(default=600, gt=0)
    poll_seconds: int = Field(default=30, gt=0)
    nasdaq_poll_seconds: int = Field(default=60, ge=60)
    calendar_source: str = 'RegimeRegistry / BlueDeploy 2026–2027; verify deployed holiday and early-close entries'

    @model_validator(mode='after')
    def constraints(self):
        for values in [self.haircuts_bps, self.staleness_seconds, self.regime_caps_usd]:
            if set(values) != set(REGIMES):
                raise ValueError('Exactly six Blue regime entries required')
        if any(not 0 <= h <= 5000 for h in self.haircuts_bps.values()):
            raise ValueError('Oracle haircuts must be between 0 and 5000 bps')
        if any(self.haircuts_bps[a] > self.haircuts_bps[b] for a, b in zip(ROUTINE, ROUTINE[1:])):
            raise ValueError('Routine haircuts must be nondecreasing')
        if self.haircuts_bps['HALTED'] < self.haircuts_bps['CORP_ACTION']:
            raise ValueError('HALTED haircut must cover CORP_ACTION')
        if any(not 0 < t < 2**32 for t in self.staleness_seconds.values()):
            raise ValueError('Staleness must fit a positive uint32')
        if any(c < 0 or not math.isfinite(c) or c > self.total_borrow_cap_usd for c in self.regime_caps_usd.values()):
            raise ValueError('Regime caps must be finite and within the total cap')
        if Decimal(str(self.total_borrow_cap_usd)) * Decimal(10)**self.loan_decimals >= 2**256:
            raise ValueError('Borrow cap does not fit uint256 loan-asset units')
        if self.profile == 'ATLAS_RAW_TOKEN' and 'staleness_seconds' not in self.model_fields_set:
            raise ValueError('Atlas profiles require explicit per-regime staleness settings')
        if self.jump_band_bps and self.jump_band_bps <= self.continuity_band_bps:
            raise ValueError('Enabled jump band must exceed continuity band')
        if self.refresh_margin_seconds >= self.override_duration_seconds or self.override_duration_seconds > self.max_override_seconds:
            raise ValueError('Invalid override duration or refresh margin')
        if self.unknown_timeout_seconds < self.poll_seconds:
            raise ValueError('Unknown timeout must cover a polling interval')
        return self

    @property
    def hmax(self):
        return max(self.haircuts_bps[r] for r in ROUTINE) / 10000


def load_blue_config():
    path = os.getenv('BLUE_CONFIG_PATH')
    return BlueConfig.model_validate_json(Path(path).read_text()) if path else BlueConfig()


class RouterProposal(Model):
    margin_bps: int
    target_ltv: float
    total_borrow_cap_usd: float
    regime_caps_usd: dict[str, float]
    total_cap_assets: str
    regime_cap_assets: list[str]
    regime_order: list[str] = Field(default_factory=lambda: list(REGIMES))
    methods: list[str] = Field(default_factory=lambda: ['BlueRouter.setMargin(MarketParams,uint16)', 'BlueRouter.setCaps(Id,uint256,uint256[6])'])


class BlueProposal(Model):
    asset: str
    chain_id: int
    market_id: str
    market_lltv: float
    recommendation_id: str
    expires_at: AwareDatetime
    evidence_hash: str
    configuration_hash: str
    proposal_hash: str
    configured: BlueConfig
    router: RouterProposal
    advisory_oracle_max_age_seconds: float
    unmapped_supply_cap_tokens: float
    approval_required: Literal[True] = True
    approval_status: Literal['PENDING_REVIEW'] = 'PENDING_REVIEW'
    executable: Literal[False] = False
    signing_status: Literal['UNSIGNED'] = 'UNSIGNED'
    calibration_status: Literal['UNCALIBRATED'] = 'UNCALIBRATED'
    unchanged_controls: list[str]
    reasons: list[str]


def propose_blue(a: Assessment, recommendation: Recommendation, policy: Policy, config: BlueConfig) -> BlueProposal:
    if (recommendation.asset != a.asset or recommendation.evidence_hash != a.evidence_hash
            or recommendation.timestamp != a.as_of or a.configuration_version != policy.fingerprint):
        raise ValueError('Blue proposal requires matching assessment, recommendation and risk policy evidence')
    if abs(config.hmax - policy.router_hmax) > 1e-12 or abs(config.margin_bps / 10000 - policy.router_margin) > 1e-12:
        raise ValueError('Risk policy and declared Blue router configuration disagree')
    p = recommendation.recommended_parameters
    base = policy.market_lltv * (1 - config.hmax)
    desired_margin = max(config.margin_bps, math.ceil((base - p.ltv) * 10000 - 1e-9))
    accepted = p.collateral_accepted and p.ltv > 0 and desired_margin <= 5000 and desired_margin < base * 10000
    margin = desired_margin if accepted else config.margin_bps
    total = min(config.total_borrow_cap_usd, p.borrow_cap) if accepted else 0
    # These are explicit scenario ceilings, not empirically calibrated per-regime limits.
    factors = dict(zip(REGIMES, [1, .7, .7, .4, 0, 0]))
    caps = {r: min(config.regime_caps_usd[r], total * factors[r]) for r in REGIMES}
    def units(usd):
        with localcontext() as ctx:
            ctx.prec = 100
            return str(int((Decimal(str(usd)) * Decimal(10)**config.loan_decimals).to_integral_value(rounding=ROUND_DOWN)))
    age = (policy.oracle_max_age_by_regime or {}).get(a.session.protocol_regime, policy.oracle_max_age_seconds)
    data = dict(asset=a.asset, chain_id=recommendation.chain_id, market_id=recommendation.market_id,
                market_lltv=p.liquidation_threshold, recommendation_id=recommendation.recommendation_id,
                expires_at=recommendation.expires_at, evidence_hash=a.evidence_hash, configured=config,
                configuration_hash=evidence_hash({'blue': config.model_dump(mode='json'), 'risk': policy.model_dump(mode='json')}),
                router=RouterProposal(margin_bps=margin, target_ltv=base - margin / 10000,
                    total_borrow_cap_usd=total, regime_caps_usd=caps, total_cap_assets=units(total),
                    regime_cap_assets=[units(caps[r]) for r in REGIMES]),
                advisory_oracle_max_age_seconds=age, unmapped_supply_cap_tokens=p.supply_cap,
                unchanged_controls=['oracle haircuts and staleness', 'continuity/jump/freeze controls',
                    'eligibility TTL', 'keeper override/clear/unknown-source/polling controls', 'holiday and early-close entries'],
                reasons=[
                    'Declared configuration is unverified against deployed contracts; verify chain, market ID, MarketParams, decimals and admin authority before any execution',
                    'Margin rounds up to whole basis points; lowering caps prevents new exposure and never forces repayment',
                    'Six regime ceilings use illustrative factors and configured maxima; HALTED/CORP_ACTION new borrowing stays disabled',
                    'Oracle parameters are immutable: changed haircuts or staleness require a new oracle and compatible new Morpho market, not an in-place edit',
                    'Supply cap requires a separately enforcing vault/wrapper; current BlueRouter only enforces borrowing caps',
                    'No EIP-712 eligibility attestation, approval, calldata or transaction is produced',
                    *([] if accepted else ['Hold new exposure with zero caps; no invalid zero-target-LTV margin is proposed']),
                ])
    proposal = BlueProposal(**data, proposal_hash='')
    proposal.proposal_hash = evidence_hash(proposal.model_dump(mode='json', exclude={'proposal_hash'}))
    return proposal
