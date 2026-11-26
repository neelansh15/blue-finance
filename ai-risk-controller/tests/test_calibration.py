"""All generated rows below are test fixtures, never real calibration evidence."""
import csv
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import io
import json

import pytest
from pydantic import ValidationError

from app.calibration import BUCKETS, CalibrationManifest, CalibrationSettings, calibrate, nearest_rank, read_gaps
from app.config import Policy
from app.dawn import DawnConfig
from app.integrations.signing import evidence_hash
from scripts.calibrate_dawn import main

AS_OF = datetime(2026, 10, 1, tzinfo=timezone.utc)
MANIFEST = CalibrationManifest(asset='BNB_STOCK_NVDA', source_reference='test-only://not-market-evidence',
    methodology='Generated nonoverlapping windows used only to test evidence gates.', simulated=False, corporate_action_adjusted=True)
SETTINGS = CalibrationSettings(quantile=.95, min_training_samples=100, min_holdout_samples=20)


def rows(n=150):
    result = []
    for bucket_index, bucket in enumerate(BUCKETS):
        for i in range(n):
            start = AS_OF - timedelta(days=n+50-i) + timedelta(hours=bucket_index*2)
            result.append(dict(asset=MANIFEST.asset, regime=bucket, window_start=start.isoformat(),
                window_end=(start+timedelta(hours=1)).isoformat(), start_price='100', end_price='99'))
    return result


def csv_bytes(data):
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=['asset','regime','window_start','window_end','start_price','end_price'])
    writer.writeheader()
    writer.writerows(data)
    return output.getvalue().encode()


def run(data, manifest=MANIFEST, settings=SETTINGS):
    return calibrate(csv_bytes(data), manifest, settings, DawnConfig(), Policy(), AS_OF)


def test_nearest_rank_and_non_adverse_moves():
    assert nearest_rank([Decimal('.01'),Decimal('.02'),Decimal('.03')], .95) == Decimal('.03')
    data = rows()
    for row in data:
        if row['regime'] == 'OPEN': row['end_price'] = '101'
    result = run(data)
    assert result['candidate_haircuts_bps']['OPEN'] == 0


def test_candidate_stays_non_executable_and_does_not_loosen_configured_floors():
    result = run(rows())
    assert result['status'] == 'CANDIDATE_REQUIRES_REVIEW'
    assert result['calibrated'] is result['executable'] is False
    assert result['approval_required'] is True
    assert result['source_verification'] == 'UNVERIFIED_CALLER_DECLARATION'
    assert result['candidate_haircuts_bps']['OPEN'] == 100
    for regime, value in DawnConfig().haircuts_bps.items():
        assert result['candidate_haircuts_bps'][regime] >= value
    assert result['candidate_margin_bps'] >= 200
    assert result['report_hash'] == evidence_hash({k:v for k,v in result.items() if k != 'report_hash'})
    assert result == run(rows())


def test_upward_monotonic_adjustments_and_margin_use_ltv_points():
    data = rows()
    for row in data:
        if row['regime'] == 'OPEN': row['end_price'] = '94'
        if row['regime'] == 'CORP_ACTION': row['end_price'] = '70'
        if row['regime'] == 'INTRADAY_BUFFER': row['end_price'] = '95'
    result = run(data)
    assert result['candidate_haircuts_bps']['EXTENDED'] == 600
    assert result['candidate_haircuts_bps']['HALTED'] == 3000
    assert result['candidate_margin_bps'] == 313  # ceil(62.5% × 5% × 10000)


@pytest.mark.parametrize('change', ['missing_bucket','sparse','simulated','unadjusted'])
def test_incomplete_or_simulated_evidence_never_yields_candidates(change):
    data, manifest = rows(), MANIFEST
    if change == 'missing_bucket': data = [r for r in data if r['regime'] != 'HALTED']
    if change == 'sparse': data = rows(5)
    if change == 'simulated': manifest = MANIFEST.model_copy(update={'simulated': True})
    if change == 'unadjusted': manifest = MANIFEST.model_copy(update={'corporate_action_adjusted': False})
    result = run(data, manifest)
    assert result['status'] == 'EVIDENCE_INSUFFICIENT'
    assert result['candidate_haircuts_bps'] is result['candidate_margin_bps'] is None
    assert result['blockers']


def test_holdout_cannot_leak_into_training_quantiles():
    data = rows()
    weekend = [r for r in data if r['regime'] == 'WEEKEND']
    for row in weekend[-30:]: row['end_price'] = '60'
    result = run(data)
    assert result['status'] == 'HOLDOUT_REJECTED'
    assert result['buckets']['WEEKEND']['training_loss_quantile'] == .01
    assert result['buckets']['WEEKEND']['holdout_breaches'] == 30
    assert result['candidate_haircuts_bps'] is None


def test_contract_bounds_reject_instead_of_clamping_losses_downward():
    data = rows()
    for row in data: row['end_price'] = '40'
    result = run(data)
    assert result['status'] == 'CONTRACT_BOUNDS_REJECTED'
    assert result['candidate_haircuts_bps'] is result['candidate_margin_bps'] is None


@pytest.mark.parametrize('change', ['duplicate','overlap','future','asset','nan','negative','naive'])
def test_invalid_windows_and_prices_are_rejected(change):
    data = rows(2)
    if change == 'duplicate': data.append(data[0].copy())
    if change == 'overlap':
        other = data[0].copy()
        other['window_start'] = (datetime.fromisoformat(other['window_start'])+timedelta(minutes=30)).isoformat()
        data.append(other)
    if change == 'future': data[0]['window_end'] = (AS_OF+timedelta(days=1)).isoformat()
    if change == 'asset': data[0]['asset'] = 'OTHER'
    if change == 'nan': data[0]['start_price'] = 'NaN'
    if change == 'negative': data[0]['end_price'] = '-1'
    if change == 'naive': data[0]['window_start'] = '2026-01-01T12:00:00'
    with pytest.raises(ValueError): run(data)


def test_default_tail_sample_gate_requires_500_training_rows():
    result = run(rows(), settings=CalibrationSettings())
    assert result['required_training_samples_per_bucket'] == 500
    assert result['candidate_haircuts_bps'] is None
    with pytest.raises(ValidationError): CalibrationSettings(quantile=1)
    with pytest.raises(ValidationError): CalibrationSettings(min_training_samples=5)
    with pytest.raises(ValidationError): CalibrationManifest.model_validate(MANIFEST.model_dump() | {'price_unit':'PER_RAW_TOKEN'})


def test_default_settings_can_yield_only_a_review_candidate_with_enough_evidence():
    result = run(rows(625), settings=CalibrationSettings())
    assert result['status'] == 'CANDIDATE_REQUIRES_REVIEW'
    assert all(b['training_count'] == 500 and b['holdout_count'] == 125 for b in result['buckets'].values())
    assert result['calibrated'] is False and result['executable'] is False


def test_old_holdout_is_reported_and_candidates_withheld():
    data = rows()
    for row in data:
        for field in ['window_start','window_end']:
            row[field] = (datetime.fromisoformat(row[field])-timedelta(days=1000)).isoformat()
    result = run(data)
    assert result['candidate_haircuts_bps'] is None
    assert any('too old' in b for b in result['blockers'])


def test_empty_data_cli_exits_nonzero_with_an_auditable_report(tmp_path):
    output = tmp_path / 'no-data.json'
    assert main(['--output',str(output),'--as-of',AS_OF.isoformat()]) == 2
    report = json.loads(output.read_text())
    assert report['status'] == 'NO_DATA'
    assert report['candidate_haircuts_bps'] is None
    with pytest.raises(ValueError): read_gaps(b'price\n100\n', MANIFEST, AS_OF)


def test_invalid_cli_input_replaces_a_stale_candidate_report(tmp_path):
    output, manifest, data = tmp_path/'report.json', tmp_path/'manifest.json', tmp_path/'input.csv'
    output.write_text('{"candidate_haircuts_bps":{"OPEN":100}}')
    manifest.write_text(MANIFEST.model_dump_json())
    data.write_text('price\n100\n')
    assert main(['--input',str(data),'--manifest',str(manifest),'--output',str(output),'--as-of',AS_OF.isoformat()]) == 2
    report = json.loads(output.read_text())
    assert report['status'] == 'INVALID_INPUT'
    assert report['candidate_haircuts_bps'] is None
    assert report['executable'] is False


def test_cli_validates_supplied_files_and_emits_only_a_review_candidate(tmp_path):
    output, manifest, data = tmp_path/'report.json', tmp_path/'manifest.json', tmp_path/'input.csv'
    manifest.write_text(MANIFEST.model_dump_json())
    data.write_bytes(csv_bytes(rows()))
    assert main(['--input',str(data),'--manifest',str(manifest),'--output',str(output),
                 '--as-of',AS_OF.isoformat(),'--quantile','.95','--min-training','100','--min-holdout','20']) == 0
    report = json.loads(output.read_text())
    assert report['status'] == 'CANDIDATE_REQUIRES_REVIEW'
    assert report['calibrated'] is report['executable'] is False


def test_future_cutoff_and_mismatched_baseline_cannot_produce_reports():
    with pytest.raises(ValueError, match='not in the future'):
        calibrate(None, None, SETTINGS, DawnConfig(), Policy(), datetime(2099,1,1,tzinfo=timezone.utc))
    with pytest.raises(ValueError, match='matching declared'):
        calibrate(None, None, SETTINGS, DawnConfig(), Policy(router_margin=.03), AS_OF)
