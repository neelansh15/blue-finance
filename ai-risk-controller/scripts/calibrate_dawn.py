"""Offline adverse-gap evidence report. Exit 2 means no candidate may be proposed."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

from app.calibration import CalibrationManifest, CalibrationSettings, calibrate
from app.config import load_policy
from app.dawn import load_dawn_config
from app.integrations.signing import evidence_hash


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, help='CSV with adjusted, classified historical gap windows')
    parser.add_argument('--manifest', type=Path, help='JSON provenance and adjustment declarations')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--as-of', help='Timezone-aware evidence cutoff; defaults to current UTC')
    parser.add_argument('--quantile', type=float, default=.99)
    parser.add_argument('--min-training', type=int, default=500)
    parser.add_argument('--min-holdout', type=int, default=100)
    args = parser.parse_args(argv)
    try:
        settings = CalibrationSettings(quantile=args.quantile, min_training_samples=args.min_training, min_holdout_samples=args.min_holdout)
        as_of = datetime.fromisoformat(args.as_of) if args.as_of else datetime.now(timezone.utc)
        if as_of.tzinfo is None or as_of > datetime.now(timezone.utc):
            raise ValueError('Evidence cutoff must be timezone-aware and not in the future')
        manifest = None
        if args.manifest:
            with args.manifest.open('rb') as file:
                raw_manifest = file.read(20_001)
            if len(raw_manifest) > 20_000:
                raise ValueError('Provenance manifest exceeds 20 KB')
            manifest = CalibrationManifest.model_validate_json(raw_manifest)
        data = None
        if args.input:
            with args.input.open('rb') as file:
                data = file.read(10_000_001)
            if len(data) > 10_000_000:
                raise ValueError('Calibration input exceeds 10 MB')
        report = calibrate(data, manifest, settings, load_dawn_config(), load_policy(), as_of)
    except (ValueError, OSError) as exc:
        # Replace an older candidate file on runtime validation failure. A stale
        # successful artifact must not masquerade as this failed invocation.
        report = dict(status='INVALID_INPUT', calibrated=False, executable=False, approval_required=True,
                      candidate_haircuts_bps=None, candidate_margin_bps=None, candidate_target_ltv=None,
                      risk_policy_patch=None, blockers=[str(exc)])
        report['report_hash'] = evidence_hash(report)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(f"{report['status']}: {args.output.resolve()}")
    for blocker in report['blockers']:
        print(f'- {blocker}')
    return 0 if report['status'] == 'CANDIDATE_REQUIRES_REVIEW' else 2


if __name__ == '__main__':
    raise SystemExit(main())
