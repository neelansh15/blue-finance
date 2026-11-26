"""Reviewable Blue configuration proposals. No transaction or approval executor."""
import math
import os
from decimal import Decimal, ROUND_DOWN, localcontext
from pathlib import Path
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from app.config import Policy
from app.declared import BLUE_DEFAULTS
from app.declared import DECLARED
from app.integrations.signing import evidence_hash
from app.models import Assessment, Borrower, Model, Recommendation, Snapshot

REGIMES = ('OPEN', 'EXTENDED', 'CLOSED', 'WEEKEND', 'HALTED', 'CORP_ACTION')
ROUTINE = REGIMES[:4]


class BlueConfig(Model):
    """Declared deployment settings; defaults match BlueDeploy's mock path."""
    profile: Literal['MOCK_UI_SHARE', 'ATLAS_RAW_TOKEN'] = 'MOCK_UI_SHARE'
    haircuts_bps: dict[str, int] = Field(default_factory=lambda: dict(BLUE_DEFAULTS["haircuts_bps"]))
    staleness_seconds: dict[str, int] = Field(default_factory=lambda: dict(BLUE_DEFAULTS["staleness_seconds"]))
    margin_bps: int = Field(default=BLUE_DEFAULTS["margin_bps"], ge=0, le=5000)
    total_borrow_cap_usd: float = Field(default=BLUE_DEFAULTS["total_borrow_cap_usd"], ge=0)
    regime_caps_usd: dict[str, float] = Field(default_factory=lambda: dict(BLUE_DEFAULTS["regime_caps_usd"]))
    collateral_decimals: int = Field(default=BLUE_DEFAULTS["collateral_decimals"], ge=0, le=36)
    supply_cap_tokens: float = Field(default=BLUE_DEFAULTS["supply_cap_tokens"], ge=0)
    loan_decimals: int = Field(default=BLUE_DEFAULTS["loan_decimals"], ge=0, le=36)
    continuity_band_bps: int = Field(default=BLUE_DEFAULTS["continuity_band_bps"], gt=0, le=5000)
    jump_band_bps: int = Field(default=BLUE_DEFAULTS["jump_band_bps"], ge=0, le=1_000_000)
    max_freeze_seconds: int = Field(default=BLUE_DEFAULTS["max_freeze_seconds"], gt=0, lt=2**64)
    expired_freeze_haircut_bps: int = Field(default=BLUE_DEFAULTS["expired_freeze_haircut_bps"], ge=0, le=5000)
    eligibility_ttl_seconds: int = Field(default=BLUE_DEFAULTS["eligibility_ttl_seconds"], gt=0, le=3600)
    max_override_seconds: int = Field(default=BLUE_DEFAULTS["max_override_seconds"], gt=0, le=30*86400)
    keeper_can_clear: bool = False
    override_duration_seconds: int = Field(default=BLUE_DEFAULTS["override_duration_seconds"], gt=0)
    refresh_margin_seconds: int = Field(default=BLUE_DEFAULTS["refresh_margin_seconds"], ge=0)
    unknown_timeout_seconds: int = Field(default=BLUE_DEFAULTS["unknown_timeout_seconds"], gt=0)
    poll_seconds: int = Field(default=BLUE_DEFAULTS["poll_seconds"], gt=0)
    nasdaq_poll_seconds: int = Field(default=BLUE_DEFAULTS["nasdaq_poll_seconds"], ge=60)
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
        if Decimal(str(self.supply_cap_tokens)) * Decimal(10)**self.collateral_decimals >= 2**256:
            raise ValueError("Supply cap does not fit uint256 raw-asset units")
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
    declared_configuration_sha256: str = DECLARED['configuration_sha256']
    deployment_verification: Literal['DECLARED_ONLY'] = 'DECLARED_ONLY'
    current_router_target_ltv: float
    current_total_borrow_cap_usd: float
    liquidation_budgets_usd: dict[str, float]
    position_policy_impacts: list[dict] = Field(default_factory=list)
    router: RouterProposal
    advisory_oracle_max_age_seconds: float
    managed_supply_cap_tokens: str
    unmapped_supply_cap_tokens: float
    approval_required: Literal[True] = True
    approval_status: Literal['PENDING_REVIEW'] = 'PENDING_REVIEW'
    executable: Literal[False] = False
    signing_status: Literal['UNSIGNED'] = 'UNSIGNED'
    calibration_status: Literal['UNCALIBRATED'] = 'UNCALIBRATED'
    unchanged_controls: list[str]
    reasons: list[str]


def propose_blue(a: Assessment, recommendation: Recommendation, policy: Policy, config: BlueConfig,
                 *, borrowers: list[Borrower] | None = None, snapshot: Snapshot | None = None) -> BlueProposal:
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
    # The same finite book backs all borrowers. Never invent regime capacity from a fixed multiplier.
    caps = {r: min(config.regime_caps_usd[r], total, a.liquidation_budgets_usd.get(r, 0))
            if r in ROUTINE else 0 for r in REGIMES}
    def units(usd):
        with localcontext() as ctx:
            ctx.prec = 100
            return str(int((Decimal(str(usd)) * Decimal(10)**config.loan_decimals).to_integral_value(rounding=ROUND_DOWN)))
    age = (policy.oracle_max_age_by_regime or {}).get(a.session.protocol_regime, policy.oracle_max_age_seconds)
    impacts = []
    if borrowers and snapshot and snapshot.oracle.normalized_price:
        for borrower in borrowers:
            value = borrower.collateral_quantity * snapshot.oracle.normalized_price
            current_limit = value * (base-config.margin_bps/10000)
            proposed_limit = value * (base-margin/10000)
            impacts.append(dict(borrower_id=borrower.borrower_id, debt_usd=borrower.debt_usd,
                current_ltv_ceiling_usd=current_limit, proposed_ltv_ceiling_usd=proposed_limit,
                current_headroom_before_market_caps_usd=max(0,current_limit-borrower.debt_usd),
                proposed_headroom_before_market_caps_usd=max(0,proposed_limit-borrower.debt_usd) if total else 0,
                newly_over_target=borrower.debt_usd>proposed_limit and borrower.debt_usd<=current_limit,
                new_borrowing_blocked=total==0, liquidation_threshold_unchanged=True,
                note='Declared LTV ceilings at the same protocol oracle mark; market cap headroom and available loan liquidity are additional constraints. No forced repayment.'))
    data = dict(asset=a.asset, chain_id=recommendation.chain_id, market_id=recommendation.market_id,
                market_lltv=p.liquidation_threshold, recommendation_id=recommendation.recommendation_id,
                expires_at=recommendation.expires_at, evidence_hash=a.evidence_hash, configured=config,
                current_router_target_ltv=base-config.margin_bps/10000,
                current_total_borrow_cap_usd=config.total_borrow_cap_usd,
                liquidation_budgets_usd=a.liquidation_budgets_usd,
                position_policy_impacts=impacts,
                configuration_hash=evidence_hash({'blue': config.model_dump(mode='json'), 'risk': policy.model_dump(mode='json')}),
                router=RouterProposal(margin_bps=margin, target_ltv=base - margin / 10000,
                    total_borrow_cap_usd=total, regime_caps_usd=caps, total_cap_assets=units(total),
                    regime_cap_assets=[units(caps[r]) for r in REGIMES]),
                advisory_oracle_max_age_seconds=age, unmapped_supply_cap_tokens=p.supply_cap,
                managed_supply_cap_tokens=format(Decimal(str(min(config.supply_cap_tokens,p.supply_cap))), "f"),
                unchanged_controls=['oracle haircuts and staleness', 'continuity/jump/freeze controls',
                    'eligibility TTL', 'keeper override/clear/unknown-source/polling controls', 'holiday and early-close entries'],
                reasons=[
                    'Declared configuration is unverified against deployed contracts; verify chain, market ID, MarketParams, decimals and admin authority before any execution',
                    'Margin rounds up to whole basis points; lowering caps prevents new exposure and never forces repayment',
                    'Six regime ceilings use stressed shared token-book recovery budgets and configured maxima; assumptions remain uncalibrated; HALTED/CORP_ACTION borrowing stays disabled',
                    'Oracle parameters are immutable: changed haircuts or staleness require a new oracle and compatible new Morpho market, not an in-place edit',
                    'Supply cap requires a managed market: setSupplyCap enforces raw receipt supply; legacy markets retain unmapped supply advice',
                    'No EIP-712 eligibility attestation, approval, calldata or transaction is produced',
                    *([] if accepted else ['Hold new exposure with zero caps; no invalid zero-target-LTV margin is proposed']),
                ])
    proposal = BlueProposal(**data, proposal_hash='')
    proposal.proposal_hash = evidence_hash(proposal.model_dump(mode='json', exclude={'proposal_hash'}))
    return proposal
