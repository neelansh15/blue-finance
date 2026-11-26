"""Offline evidence gates for adverse-gap estimates; never production approval."""
import csv
import hashlib
import io
import math
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_CEILING
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, StrictBool, model_validator

from app.config import Policy
from app.dawn import DawnConfig, REGIMES, ROUTINE
from app.integrations.signing import evidence_hash
from app.models import Model

BUCKETS = (*REGIMES, 'INTRADAY_BUFFER')
HEADERS = {'asset', 'regime', 'window_start', 'window_end', 'start_price', 'end_price'}
Price = Annotated[Decimal, Field(ge=Decimal('1e-12'), le=Decimal('1e12'))]


class CalibrationManifest(Model):
    asset: str = Field(min_length=1, max_length=100)
    source_reference: str = Field(min_length=1, max_length=2000)
    methodology: str = Field(min_length=1, max_length=4000)
    simulated: StrictBool = True
    corporate_action_adjusted: StrictBool = False
    price_unit: Literal['PER_NORMALIZED_TOKEN'] = 'PER_NORMALIZED_TOKEN'


class CalibrationSettings(Model):
    quantile: float = Field(default=.99, ge=.9, lt=1)
    holdout_fraction: float = Field(default=.2, ge=.1, le=.5)
    min_training_samples: int = Field(default=500, ge=100)
    min_holdout_samples: int = Field(default=100, ge=20)
    max_holdout_age_days: int = Field(default=365, ge=1)


class GapObservation(Model):
    asset: str
    regime: Literal['OPEN', 'EXTENDED', 'CLOSED', 'WEEKEND', 'HALTED', 'CORP_ACTION', 'INTRADAY_BUFFER']
    window_start: AwareDatetime
    window_end: AwareDatetime
    start_price: Price
    end_price: Price

    @model_validator(mode='after')
    def ordered(self):
        if self.window_start >= self.window_end:
            raise ValueError('A gap window must end after it starts')
        return self

    @property
    def adverse_loss(self):
        return max(Decimal(0), 1 - self.end_price / self.start_price)


def read_gaps(data: bytes, manifest: CalibrationManifest, as_of: datetime):
    if as_of.tzinfo is None:
        raise ValueError('Calibration as_of must include a timezone')
    if len(data) > 10_000_000:
        raise ValueError('Calibration input exceeds 10 MB')
    reader = csv.DictReader(io.StringIO(data.decode('utf-8-sig')))
    if reader.fieldnames is None or len(reader.fieldnames) != len(HEADERS) or set(reader.fieldnames) != HEADERS:
        raise ValueError('CSV must contain exactly the documented asset/regime/window/price columns')
    rows, identities = [], set()
    for index, raw in enumerate(reader, start=2):
        if index > 100001:
            raise ValueError('Calibration input exceeds 100000 observations')
        try:
            row = GapObservation.model_validate(raw)
        except ValueError as exc:
            raise ValueError(f'Invalid gap observation at CSV line {index}') from exc
        if row.asset != manifest.asset or row.window_end > as_of:
            raise ValueError(f'Asset mismatch or future information at CSV line {index}')
        identity = (row.asset, row.window_start, row.window_end)
        if identity in identities:
            raise ValueError('Duplicate windows cannot count as independent observations')
        identities.add(identity)
        rows.append(row)
    for bucket in BUCKETS:
        ordered = sorted((r for r in rows if r.regime == bucket), key=lambda r: r.window_start)
        if any(a.window_end > b.window_start for a, b in zip(ordered, ordered[1:])):
            raise ValueError(f'Overlapping windows in {bucket} cannot count as independent samples')
    return rows


def nearest_rank(losses: list[Decimal], quantile: float):
    if not losses:
        raise ValueError('Quantiles require observations')
    rank = int((Decimal(str(quantile)) * len(losses)).to_integral_value(rounding=ROUND_CEILING))
    return sorted(losses)[max(0, rank - 1)]


def calibrate(data: bytes | None, manifest: CalibrationManifest | None, settings: CalibrationSettings,
              config: DawnConfig, policy: Policy, as_of: datetime) -> dict:
    """All candidates are withheld unless provenance, sample, holdout and contract gates pass.

    Provenance is caller-declared. Passing gates is not calibrated production safety.
    """
    if as_of.tzinfo is None or as_of > datetime.now(timezone.utc):
        raise ValueError('Calibration as_of must be timezone-aware and not in the future')
    if (not policy.immutable_threshold or abs(config.hmax - policy.router_hmax) > 1e-12
            or abs(config.margin_bps / 10000 - policy.router_margin) > 1e-12):
        raise ValueError('Calibration requires matching declared Dawn/Morpho baseline policies')
    report = dict(status='NO_DATA', as_of=as_of.isoformat(), asset=manifest.asset if manifest else None,
                  calibrated=False, executable=False, approval_required=True, source_verification='UNVERIFIED_CALLER_DECLARATION',
                  input_sha256=hashlib.sha256(data).hexdigest() if data is not None else None,
                  manifest=manifest.model_dump(mode='json') if manifest else None,
                  settings=settings.model_dump(mode='json'),
                  configuration_hash=evidence_hash({'dawn': config.model_dump(mode='json'), 'risk': policy.model_dump(mode='json')}),
                  buckets={}, candidate_haircuts_bps=None, candidate_margin_bps=None, candidate_target_ltv=None,
                  risk_policy_patch=None, blockers=[], limitations=[
                      'Prices must already be corporate-action adjusted and regime windows correctly classified by the data supplier',
                      'Nearest-rank empirical quantiles and a chronological holdout are diagnostics; they do not prove tail probabilities or independence',
                      'No liquidity-cap, heartbeat, continuity/jump-band, freeze-duration, keeper or eligibility calibration is inferred from these prices',
                      'No contract address, signature, calldata or execution authorization is generated; all candidates require independent review',
                  ])
    def finish(status):
        report['status'] = status
        report['report_hash'] = evidence_hash(report)
        return report
    if data is None or manifest is None:
        report['blockers'].append('A historical CSV and explicit provenance manifest are both required')
        return finish('NO_DATA')
    rows = read_gaps(data, manifest, as_of)
    if manifest.simulated:
        report['blockers'].append('Simulated observations cannot support calibration candidates')
    if not manifest.corporate_action_adjusted:
        report['blockers'].append('Corporate-action adjustment is not declared')
    # At least five expected tail observations, in addition to the sample floor.
    tail = 1 - Decimal(str(settings.quantile))
    required_training = max(settings.min_training_samples, int((5 / tail).to_integral_value(rounding=ROUND_CEILING)))
    report['required_training_samples_per_bucket'] = required_training
    splits, quantiles = {}, {}
    for bucket in BUCKETS:
        ordered = sorted((r for r in rows if r.regime == bucket), key=lambda r: r.window_end)
        split = math.floor(len(ordered) * (1 - settings.holdout_fraction))
        training, holdout = ordered[:split], ordered[split:]
        enough = len(training) >= required_training and len(holdout) >= settings.min_holdout_samples
        q = nearest_rank([r.adverse_loss for r in training], settings.quantile) if enough else None
        report['buckets'][bucket] = dict(training_count=len(training), holdout_count=len(holdout),
            training_loss_quantile=float(q) if q is not None else None, holdout_breaches=None, holdout_breach_fraction=None)
        if not enough:
            report['blockers'].append(f'{bucket}: insufficient non-overlapping training/holdout observations')
        elif holdout[-1].window_end < as_of - timedelta(days=settings.max_holdout_age_days):
            report['blockers'].append(f'{bucket}: latest holdout window is too old')
        else:
            quantiles[bucket], splits[bucket] = q, holdout
    if report['blockers']:
        return finish('EVIDENCE_INSUFFICIENT')
    # Never loosen the currently declared haircuts/margin automatically.
    haircuts = {r: max(config.haircuts_bps[r], int((quantiles[r] * 10000).to_integral_value(rounding=ROUND_CEILING))) for r in REGIMES}
    for a, b in zip(ROUTINE, ROUTINE[1:]):
        haircuts[b] = max(haircuts[a], haircuts[b])
    haircuts['HALTED'] = max(haircuts['HALTED'], haircuts['CORP_ACTION'])
    margin = max(config.margin_bps, int((Decimal(str(policy.market_lltv)) * quantiles['INTRADAY_BUFFER'] * 10000).to_integral_value(rounding=ROUND_CEILING)))
    try:
        candidate = DawnConfig.model_validate(config.model_dump() | {'haircuts_bps': haircuts, 'margin_bps': margin})
        candidate_policy = Policy.model_validate(policy.model_dump() | {'router_hmax': candidate.hmax, 'router_margin': margin / 10000})
    except ValueError:
        report['blockers'].append('Empirical losses exceed oracle/router bounds or leave no positive target LTV; no downward clamp is permitted')
        return finish('CONTRACT_BOUNDS_REJECTED')
    for bucket, holdout in splits.items():
        threshold = (Decimal(margin) / 10000 / Decimal(str(policy.market_lltv)) if bucket == 'INTRADAY_BUFFER'
                     else Decimal(haircuts[bucket]) / 10000)
        breaches = sum(r.adverse_loss > threshold for r in holdout)
        fraction = Decimal(breaches) / len(holdout)
        report['buckets'][bucket].update(holdout_breaches=breaches, holdout_breach_fraction=float(fraction))
        if fraction > tail:
            report['blockers'].append(f'{bucket}: holdout breach fraction exceeds the declared quantile tail')
    if report['blockers']:
        return finish('HOLDOUT_REJECTED')
    report.update(candidate_haircuts_bps=haircuts, candidate_margin_bps=margin,
                  candidate_target_ltv=candidate_policy.router_target_ltv,
                  risk_policy_patch={'router_hmax': candidate.hmax, 'router_margin': margin / 10000})
    return finish('CANDIDATE_REQUIRES_REVIEW')
