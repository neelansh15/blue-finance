from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Policy
from app.integrations.market_status import (BINANCE_RWA, NASDAQ_HALTS, NASDAQ_MARKET,
                                            LiveMarketStatusProvider, parse_bstock, parse_market)
from app.integrations.providers import DEMO_TIMES
from app.main import create_app
from app.models import Session
from app.routing.engine import route_markets
from app.routing.models import Controls, MarketInput, RoutingRequest
from app.routing.policy import demo_policy
from app.services.risk_service import RiskService
from app.services.store import AuditStore

AT = DEMO_TIMES['baseline']


def rss(at=AT, ticker=None, resumed=None):
    item = ''
    if ticker:
        item = f'''<item><ndaq:IssueSymbol>{ticker}</ndaq:IssueSymbol>
          <ndaq:HaltDate>11/20/2026</ndaq:HaltDate><ndaq:HaltTime>10:00:00.000</ndaq:HaltTime>
          <ndaq:ReasonCode>T1</ndaq:ReasonCode><ndaq:ResumptionDate>{'11/20/2026' if resumed else ''}</ndaq:ResumptionDate>
          <ndaq:ResumptionTradeTime>{resumed or ''}</ndaq:ResumptionTradeTime></item>'''
    return f'<rss xmlns:ndaq="http://www.nasdaqtrader.com/"><channel><pubDate>{format_datetime(at)}</pubDate>{item}</channel></rss>'


def market(label='Market Open', day='2026-11-20'):
    return {'status': {'rCode': 200}, 'data': {'marketIndicator': label, 'clndr_dt': day + 'T00:00:00'}}


def bstock(code='TRADING', **extra):
    return {'success': True, 'code': '000000', 'data': {'reasonCode': code, 'openState': True, **extra}}


@pytest.fixture
def setup():
    store = AuditStore(':memory:')
    state = {'now': AT, 'market': market(), 'rss': rss(), 'bstock': bstock(), 'calls': []}
    def handler(req):
        state['calls'].append(req)
        if req.url.host == 'api.nasdaq.com': data = state['market']
        elif req.url.host == 'www.nasdaqtrader.com':
            return httpx.Response(200, text=state['rss'])
        elif req.url.path.endswith('/exchangeInfo'):
            return httpx.Response(200, json={'symbols': [{'symbol': 'NVDABUSDT', 'status': state.get('spot', 'TRADING')}]})
        else: data = state['bstock']
        if data == 'timeout': raise httpx.ReadTimeout('fixture timeout')
        if data == 'rate_limit': return httpx.Response(429)
        return httpx.Response(200, json=data)
    provider = LiveMarketStatusProvider(store, httpx.Client(transport=httpx.MockTransport(handler)), clock=lambda: state['now'])
    yield RiskService(Policy(), store), provider, state
    provider.close()
    store.close()


@pytest.mark.parametrize('label,expected', [('Market Open', 'OPEN'), ('Market Closed', 'CLOSED'),
                         ('Pre-Market', 'PRE_MARKET'), ('After Hours', 'AFTER_HOURS'),
                         ('Market Suspended', 'HALTED'), ('unrecognised', 'UNKNOWN')])
def test_market_api_status_mapping(label, expected):
    assert parse_market(market(label), AT)[0] == expected


@pytest.mark.parametrize('code,extra,expected', [
    ('TRADING', {}, 'TRADING'), ('MARKET_CLOSED', {}, 'CLOSED'), ('ASSET_PAUSED', {}, 'PAUSED'),
    ('MARKET_PAUSED', {'reasonMsg': 'stock_split'}, 'CORP_ACTION'),
    ('ASSET_LIMITED', {}, 'LIMITED'), ('MARKET_MAINTENANCE', {}, 'MAINTENANCE'),
    ('UNSUPPORTED', {}, 'UNKNOWN'), ('new-code', {}, 'UNKNOWN'),
    ('TRADING', {'marketStatus': 'pause'}, 'PAUSED'), ('TRADING', {'openState': False}, 'UNKNOWN')])
def test_individual_bstock_mapping(code, extra, expected):
    assert parse_bstock(bstock(code, **extra))[0] == expected


def test_closed_stock_exchange_and_trading_bstock_are_separate(setup):
    _, provider, state = setup
    state['market'] = market('Market Closed')
    target = demo_policy().targets[0]
    result = provider.get(target)
    assert result.nasdaq_market.status == 'CLOSED'
    assert result.binance_bstock.status == 'TRADING'
    assert result.underlying_halt.status == 'NO_ACTIVE_HALT'
    assert result.simulated is False
    call = next(c for c in state['calls'] if c.url.path.startswith('/bapi'))
    assert call.url.params['contractAddress'] == target.collateral_token_address
    assert call.url.params['chainId'] == '56'
    assert result.collateral_token_address != target.contract_address  # never use lending router as token identity


def test_cache_shared_across_assets_and_failures_rate_limited(setup):
    _, provider, state = setup
    provider.get(demo_policy().targets[0]); provider.get(demo_policy().targets[1])
    assert sum(c.url.host == 'www.nasdaqtrader.com' for c in state['calls']) == 1
    assert sum(c.url.host == 'api.nasdaq.com' for c in state['calls']) == 1
    state['now'] += timedelta(seconds=61)
    state['bstock'] = 'rate_limit'
    assert provider.bstock(56, '0x' + 'a'*40).status == 'UNKNOWN'
    count = len(state['calls'])
    provider.bstock(56, '0x' + 'a'*40)
    assert len(state['calls']) == count


@pytest.mark.parametrize('response', ['timeout', 'rate_limit', {}, {'success': False, 'code': '000000', 'data': {}}])
def test_bstock_failures_are_unknown(setup, response):
    _, provider, state = setup
    state['bstock'] = response
    assert provider.get(demo_policy().targets[0]).binance_bstock.status == 'UNKNOWN'


def test_stale_market_and_malformed_or_stale_feed_are_unknown(setup):
    _, provider, state = setup
    state['market'] = market(day='2026-11-19')
    state['rss'] = '<html>WAF</html>'
    result = provider.get(demo_policy().targets[0])
    assert result.nasdaq_market.status == result.underlying_halt.status == 'UNKNOWN'
    state['now'] += timedelta(seconds=61)
    state['rss'] = rss(AT - timedelta(minutes=10))
    assert provider.halt('NVDA').status == 'UNKNOWN'


def test_halt_survives_restart_and_disappearance_then_effective_resumption_clears(setup):
    service, provider, state = setup
    state['rss'] = rss(ticker='NVDA')
    assert provider.halt('NVDA').status == 'HALTED'
    # New provider, same durable store, no halt entry: cannot silently clear.
    restarted = LiveMarketStatusProvider(service.store, provider.client, provider.clock)
    state['rss'] = rss()
    assert restarted.halt('NVDA').status == 'HALTED'
    state['now'] += timedelta(seconds=61)
    state['rss'] = rss(state['now'], 'NVDA', '12:00:00')  # scheduled in future (17:00 UTC)
    assert restarted.halt('NVDA').status == 'HALTED'
    state['now'] += timedelta(seconds=61)
    state['rss'] = rss(state['now'], 'NVDA', '10:30:00')
    assert restarted.halt('NVDA').status == 'RESUMED'


def live_request(policy, at=AT):
    return RoutingRequest(as_of=at, primary_target_id=policy.targets[0].target_id, markets=[
        MarketInput(target_id=t.target_id, controls=Controls(observed_at=at, source_reference='mock://protocol-controls',
                    government_pause='NONE', governance_paused=False, token_transfers_paused=False)) for t in policy.targets])


def live_policy():
    policy = demo_policy()
    # Synthetic alternative token mapping; served exclusively by MockTransport.
    policy.targets[1].collateral_token_address = '0x' + 'f'*40
    return policy


def test_live_route_underlying_halt_cannot_be_overridden_by_caller(setup):
    service, provider, state = setup
    policy = live_policy()
    state['rss'] = rss(ticker='NVDA')
    result = route_markets(service, 'NVDA', live_request(policy), policy, provider)
    assert result.action == 'PROPOSE_ALTERNATIVE'
    assert result.evaluations[0].assessment.session.effective_session == Session.HALTED
    assert result.evaluations[0].market_status.underlying_halt.status == 'HALTED'
    stored = service.store.history('routing', 'BNB_STOCK_NVDA')[0]
    assert stored['evidence']['live_market_status'][policy.targets[0].target_id]['underlying_halt']['raw']['ReasonCode'] == 'T1'
    policy.targets[1].underlying_ticker = 'NVDA'
    assert route_markets(service, 'NVDA', live_request(policy), policy, provider).action == 'HOLD_NEW_EXPOSURE'


@pytest.mark.parametrize('code', ['ASSET_PAUSED', 'MARKET_PAUSED', 'ASSET_LIMITED', 'MARKET_MAINTENANCE', 'UNSUPPORTED'])
def test_bstock_restrictions_or_unknown_block_live_routes(setup, code):
    service, provider, state = setup
    state['bstock'] = bstock(code)
    policy = live_policy()
    assert route_markets(service, 'NVDA', live_request(policy), policy, provider).action == 'HOLD_NEW_EXPOSURE'


def test_live_routing_needs_provider_and_current_time(setup):
    service, provider, _ = setup
    policy = live_policy()
    with pytest.raises(ValueError, match='provider'):
        route_markets(service, 'NVDA', live_request(policy), policy)
    with pytest.raises(ValueError, match='current evidence'):
        route_markets(service, 'NVDA', live_request(policy, AT - timedelta(days=1)), policy, provider)


def test_status_endpoint_and_default_live_route(setup):
    service, provider, state = setup
    with TestClient(create_app(service, provider)) as client:
        result = client.get('/risk/market-status/NVDA')
        assert result.status_code == 200, result.text
        assert result.json()[0]['binance_bstock']['status'] == 'TRADING'
        assert client.get('/risk/market-status/not-configured').status_code == 404
        assert service.store.history('market_status', 'BNB_STOCK_NVDA')
        state['bstock'] = bstock('ASSET_PAUSED')
        state['now'] += timedelta(seconds=61)
        state['rss'] = rss(state['now'])
        response = client.post('/risk/route/NVDA', json=live_request(demo_policy(), state['now']).model_dump(mode='json'))
        assert response.status_code == 200, response.text
        assert response.json()['action'] == 'HOLD_NEW_EXPOSURE'
        assert response.json()['simulated']  # real statuses don't promote mock quantitative inputs to production


def test_spot_is_supplementary_and_missing_bstock_is_not_assumed_trading(setup):
    _, provider, state = setup
    target = demo_policy().targets[1]
    target.binance_spot_symbol = 'NVDABUSDT'
    state['spot'] = 'CANCEL_ONLY'
    result = provider.get(target)
    assert result.binance_spot.status == 'LIMITED'
    assert result.binance_bstock.status == 'UNKNOWN'  # missing token mapping


def test_healthy_live_route_and_expiry_bind_cached_evidence(setup):
    service, provider, state = setup
    policy = live_policy()
    result = route_markets(service, 'NVDA', live_request(policy), policy, provider)
    assert result.action == 'KEEP_CURRENT'
    assert result.evaluations[0].market_status.nasdaq_market.status == 'OPEN'
    state['now'] += timedelta(seconds=59)
    result = route_markets(service, 'NVDA', live_request(policy, state['now']), policy, provider)
    assert result.expires_at <= AT + timedelta(seconds=policy.observation_max_age_seconds)
    assert result.evaluations[0].market_status.nasdaq_market.fetched_at == AT


def test_api_closure_overrides_calendar_open_and_no_bstock_transfer_claim(setup):
    service, provider, state = setup
    policy = live_policy()
    state['market'] = market('Market Closed')
    result = route_markets(service, 'NVDA', live_request(policy), policy, provider)
    assert result.action == 'HOLD_NEW_EXPOSURE'
    assert any('calendar regular' in r for r in result.evaluations[0].reasons)
    assert result.evaluations[0].market_status.binance_bstock.status == 'TRADING'
    req = live_request(policy)
    req.markets[0].controls.token_transfers_paused = None
    result = route_markets(service, 'NVDA', req, policy, provider)
    assert any('Token transfer availability' in r for r in result.evaluations[0].reasons)


def test_nasdaq_403_is_explicit_unknown_and_not_calendar_fallback(setup):
    service, _, _ = setup
    with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(403))) as client:
        provider = LiveMarketStatusProvider(service.store, client, lambda: AT)
        result = provider.get(demo_policy().targets[0])
        assert result.nasdaq_market.status == 'UNKNOWN'
        assert 'HTTP 403' in result.nasdaq_market.detail
        assert result.underlying_halt.status == result.binance_bstock.status == 'UNKNOWN'
