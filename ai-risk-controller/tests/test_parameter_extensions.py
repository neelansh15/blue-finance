"""Generated examples exercise code paths only; none are historical market evidence."""
import csv
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import io

import pytest

from app.backtesting import BenchmarkPolicy, Episode, compare_policies
from app.blue import BlueConfig, REGIMES
from app.calibration import BUCKETS, CalibrationManifest, CalibrationSettings, calibrate, wilson_interval
from app.config import Policy
from app.historical_windows import AdjustedHistory, build_windows
from app.integrations.providers import DEMO_TIMES, MockProviders
from app.models import OracleMode
from app.risk.budgets import liquidation_budgets
from app.market_sessions.session_detector import detect_session
from app.simulation.morpho import MorphoReplay, replay, assets

AT=datetime(2026,10,1,tzinfo=timezone.utc)


def budgets(policy=Policy(), liquidity=1, volatility=.3):
    market=MockProviders().market(DEMO_TIMES['baseline'],'baseline')
    if liquidity == 0:
        market.bids=[]
    else:
        for bid in market.bids:
            bid.quantity*=liquidity
    return liquidation_budgets(market,140,volatility,detect_session(market.as_of,policy),0,0,policy)


def test_debt_budgets_depend_on_finite_token_liquidity_and_stress():
    baseline=budgets()
    assert baseline['OPEN']>=baseline['EXTENDED']>=baseline['CLOSED']>=baseline['WEEKEND']>0
    assert baseline['HALTED']==baseline['CORP_ACTION']==0
    for adverse in [budgets(liquidity=.1),budgets(volatility=3),
                    budgets(policy=Policy(execution_delay_seconds=7*86400))]:
        assert adverse['OPEN']<baseline['OPEN']
    assert all(v==0 for v in budgets(liquidity=0).values())


def test_stale_book_and_missing_volatility_cannot_supply_a_debt_budget():
    market=MockProviders().market(DEMO_TIMES['baseline'],'baseline')
    policy=Policy();session=detect_session(market.as_of,policy)
    market.market_observed_at-=timedelta(hours=1)
    assert not any(liquidation_budgets(market,140,.3,session,0,0,policy).values())
    market.market_observed_at=market.as_of
    assert not any(liquidation_budgets(market,140,None,session,0,0,policy).values())


def calibration_fixture():
    output=io.StringIO();writer=csv.DictWriter(output,fieldnames=['asset','regime','window_start','window_end','start_price','end_price','event'])
    writer.writeheader()
    for bucket_index,bucket in enumerate(BUCKETS):
        if bucket in {'HALTED','CORP_ACTION'}:
            continue
        for i in range(150):
            start=AT-timedelta(days=200-i)+timedelta(hours=bucket_index*2)
            writer.writerow(dict(asset='TEST',regime=bucket,window_start=start.isoformat(),
                window_end=(start+timedelta(hours=1)).isoformat(),start_price=100,end_price=99,
                event='EARNINGS' if i%20==0 else 'NONE'))
    return output.getvalue().encode()


def test_rare_event_stress_is_explicit_and_walk_forward_has_no_future_training():
    manifest=CalibrationManifest(asset='TEST',source_reference='fixture-only',methodology='Generated gate test',
        simulated=False,corporate_action_adjusted=True,special_stress_floors_bps={'HALTED':3000,'CORP_ACTION':1500},
        stress_review_reference='fixture-review-only')
    result=calibrate(calibration_fixture(),manifest,CalibrationSettings(quantile=.95,min_training_samples=100,min_holdout_samples=20),BlueConfig(),Policy(),AT)
    assert result['status']=='CANDIDATE_REQUIRES_REVIEW'
    assert result['buckets']['HALTED']['evidence_method']=='DECLARED_STRESS_ASSUMPTION_NOT_CALIBRATED'
    assert result['buckets']['HALTED']['holdout_breach_interval_95'] is None
    assert result['candidate_haircuts_bps']['HALTED']==3000
    assert any('EARNINGS' in key for key in result['context_diagnostics'])
    for fold in result['buckets']['OPEN']['walk_forward']:
        assert datetime.fromisoformat(fold['training_end'])<=datetime.fromisoformat(fold['validation_start'])
    assert result['buckets']['OPEN']['holdout_breach_interval_95'][1]>0
    assert wilson_interval(0,100)[1]>0  # zero breaches never implies a zero true tail probability
    assert result['calibrated'] is result['executable'] is False


def test_history_builder_uses_early_close_and_actual_long_closure_boundaries():
    times=['2025-11-26T20:00:00-05:00','2025-11-28T04:00:00-05:00','2025-11-28T09:30:00-05:00',
           '2025-11-28T10:00:00-05:00','2025-11-28T13:00:00-05:00','2025-11-28T17:00:00-05:00',
           '2025-12-01T04:00:00-05:00']
    history=AdjustedHistory(asset='TEST',source_reference='fixture-only',points=[{'at':t,'price':100} for t in times])
    rows,manifest,missing=build_windows(history,datetime.fromisoformat(times[-1]))
    assert any(r.regime=='OPEN' and r.window_end.hour==18 for r in rows)  # 13:00 ET early close
    closure=next(r for r in rows if r.regime=='WEEKEND' and r.window_start.day==28)
    assert (closure.window_end-closure.window_start).total_seconds()==59*3600
    assert manifest.simulated and not manifest.corporate_action_adjusted
    sparse=history.model_copy(update={"points":[p for p in history.points if p.at.hour!=13]})
    assert build_windows(sparse,datetime.fromisoformat(times[-1]))[2]
    with pytest.raises(ValueError,match='Future'):
        build_windows(history,datetime.fromisoformat(times[0]))


def state(**changes):
    return MorphoReplay(**(dict(total_borrow_assets=900*10**18,total_borrow_shares=900*10**24,
        total_supply_assets=100000*10**18,total_supply_shares=100000*10**24,
        collateral=10*10**18,borrow_shares=900*10**24,oracle_price=120*10**36)|changes))


def test_integer_replay_accrues_interest_and_replays_partial_liquidation():
    result=replay(state(elapsed_seconds=86400,borrow_rate_wad=10**9,repaid_shares=100*10**24))
    assert int(result['interest_assets'])>0
    assert int(result['remaining_borrow_shares'])==800*10**24
    assert 0<int(result['seized_assets'])<10*10**18
    assert result['healthy_before_liquidation'] is False
    assert int(result['bad_debt_assets'])==0
    assert assets(1,1,1,up=True)>=assets(1,1,1)
    with pytest.raises(ValueError,match='Healthy'):
        replay(state(oracle_price=200*10**36,repaid_shares=1))
    with pytest.raises(ValueError,match='partial liquidation'):
        replay(state(oracle_price=10**36,repaid_shares=900*10**24))
    with pytest.raises(ValueError,match='overflow'):
        replay(state(borrow_rate_wad=2**255,elapsed_seconds=10))


def test_comparison_uses_identical_episodes_and_rejects_shared_liquidity_reuse():
    episode=Episode(asset='TEST',start=AT-timedelta(days=3),end=AT,initial_regime='OPEN',final_regime='WEEKEND',
        start_price=100,end_price=80,collateral_quantity=100,executable_bids=[{'price':79,'quantity':100}],execution_available=True)
    values=dict(lltv=.625,margin=.02,haircuts={r:h/10000 for r,h in BlueConfig().haircuts_bps.items()},borrow_cap_usd=100000)
    a,b=BenchmarkPolicy(name='a',**values),BenchmarkPolicy(name='b',**values)
    report=compare_policies([episode],[a,b],AT)
    assert report['results'][0]|{'policy':'b'}==report['results'][1]
    assert report['results'][0]['aggregate_opening_debt_usd']==pytest.approx(5112.5)
    with pytest.raises(ValueError,match='reuse liquidity'):
        compare_policies([episode,episode],[a],AT)
    with pytest.raises(ValueError,match='future'):
        compare_policies([episode],[a],AT-timedelta(days=1))
