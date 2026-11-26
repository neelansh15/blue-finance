"""Read-only Nasdaq and Binance status adapters, separate from prices and onchain pauses."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from threading import RLock
import subprocess
from typing import Any, Callable, Literal
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

import httpx
from pydantic import AwareDatetime, Field

from app.models import Model
from app.services.store import AuditStore

NASDAQ_MARKET = 'https://api.nasdaq.com/api/market-info'
NASDAQ_HALTS = 'https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts'
BINANCE_RWA = 'https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa'
EASTERN = ZoneInfo('America/New_York')
Status = Literal['OPEN', 'CLOSED', 'PRE_MARKET', 'AFTER_HOURS', 'HALTED', 'PAUSED',
                 'CORP_ACTION', 'LIMITED', 'MAINTENANCE', 'TRADING', 'NO_ACTIVE_HALT', 'RESUMED', 'UNKNOWN']


class StatusObservation(Model):
    status: Status = 'UNKNOWN'
    source: str
    http_status: int | None = None
    fetched_at: AwareDatetime
    published_at: AwareDatetime | None = None
    detail: str = ''
    raw: dict[str, Any] = Field(default_factory=dict)


class AssetMarketStatus(Model):
    asset: str
    ticker: str | None
    chain_id: int
    collateral_token_address: str | None
    as_of: AwareDatetime
    nasdaq_market: StatusObservation
    underlying_halt: StatusObservation
    binance_bstock: StatusObservation
    # A CEX symbol is supplementary evidence, never proof of token-transfer availability.
    binance_spot: StatusObservation | None = None
    simulated: Literal[False] = False
    scope: str = 'Live public market-status observations only; prices, eligibility and onchain transfer controls are separate'


def parse_market(body: dict, at: datetime) -> tuple[Status, dict]:
    data = body.get('data')
    if not isinstance(data, dict) or body.get('status', {}).get('rCode') != 200:
        raise ValueError('Invalid Nasdaq market-info envelope')
    day = datetime.fromisoformat(data['clndr_dt']).date()
    if day != at.astimezone(EASTERN).date():
        raise ValueError('Nasdaq market-info calendar date is stale or future-dated')
    label = str(data.get('marketIndicator', '')).strip().upper()
    status = {'MARKET OPEN': 'OPEN', 'MARKET CLOSED': 'CLOSED', 'PRE-MARKET': 'PRE_MARKET',
              'PRE MARKET': 'PRE_MARKET', 'AFTER HOURS': 'AFTER_HOURS', 'AFTER-HOURS': 'AFTER_HOURS',
              'MARKET HALTED': 'HALTED', 'MARKET SUSPENDED': 'HALTED'}.get(label, 'UNKNOWN')
    return status, data


def parse_halts(xml: str) -> tuple[list[dict[str, str]], datetime]:
    root = ET.fromstring(xml.lstrip('\ufeff'))
    if root.tag != 'rss' or root.find('channel') is None:
        raise ValueError('Not a Nasdaq RSS channel')
    channel = root.find('channel')
    published = parsedate_to_datetime(channel.findtext('pubDate', ''))
    if published.tzinfo is None:
        raise ValueError('Missing feed publication timezone')
    rows = [{child.tag.rsplit('}', 1)[-1]: (child.text or '').strip()
             for child in item if child.tag.rsplit('}', 1)[-1] != 'description'}
            for item in channel.findall('item')]
    # A malformed record must not accidentally clear an existing halt.
    if any(not r.get('IssueSymbol') or not r.get('HaltDate') or not r.get('HaltTime') for r in rows):
        raise ValueError('Malformed Nasdaq halt record')
    return rows, published


def event_time(day: str, clock: str) -> datetime:
    value = datetime.strptime(f'{day} {clock}'.split('.')[0], '%m/%d/%Y %H:%M:%S')
    return value.replace(tzinfo=EASTERN).astimezone(timezone.utc)


def parse_bstock(body: dict) -> tuple[Status, dict]:
    data = body.get('data')
    if body.get('success') is not True or body.get('code') != '000000' or not isinstance(data, dict):
        raise ValueError('Invalid Binance bStock response')
    code = str(data.get('reasonCode', '')).upper()
    status = {'TRADING': 'TRADING', 'MARKET_CLOSED': 'CLOSED', 'ASSET_PAUSED': 'PAUSED',
              'MARKET_PAUSED': 'PAUSED', 'ASSET_LIMITED': 'LIMITED',
              'MARKET_MAINTENANCE': 'MAINTENANCE'}.get(code, 'UNKNOWN')
    corporate = {'stock_split', 'reverse_split', 'cash_dividend', 'stock_dividend',
                 'merger', 'acquisition', 'spinoff', 'spin_off'}
    if status in {'PAUSED', 'LIMITED'} and str(data.get('reasonMsg', '')).lower() in corporate:
        status = 'CORP_ACTION'
    if str(data.get('marketStatus', '')).lower() in {'pause', 'paused', 'suspended', 'halted'}:
        status = 'PAUSED'
    if status == 'TRADING' and data.get('openState') is not True:
        status = 'UNKNOWN'
    return status, data


def fetch_nasdaq_market() -> httpx.Response:
    """Use the verified system HTTP client for Nasdaq's public website JSON.

    Fixed HTTPS URL; no shell, credentials, redirects, TLS override or browser
    impersonation. Bound the subprocess time and response size. Docker installs curl.
    """
    try:
        result = subprocess.run([
            'curl', '-q', '--http1.1', '--silent', '--show-error', '--proto', '=https',
            '--connect-timeout', '5', '--max-time', '10', '--max-filesize', '2000000',
            '--user-agent', 'DawnFinance/0.1', '--write-out', '\n%{http_code}', NASDAQ_MARKET,
        ], capture_output=True, timeout=12, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise httpx.TransportError('Nasdaq curl transport unavailable or timed out') from exc
    if result.returncode != 0:
        raise httpx.TransportError(f'Nasdaq curl transport failed (exit {result.returncode})')
    try:
        body, code = result.stdout.rsplit(b'\n', 1)
        if len(body) > 2000000:
            raise ValueError('Oversize Nasdaq response')
        return httpx.Response(int(code), content=body, request=httpx.Request('GET', NASDAQ_MARKET))
    except (ValueError, TypeError) as exc:
        raise httpx.TransportError('Invalid Nasdaq HTTP response') from exc


def status_failures(status: AssetMarketStatus, now: datetime | None = None) -> list[str]:
    """Valid data and a real upstream 200/201 are both required for availability."""
    at = now or datetime.now(timezone.utc)
    sources = [('nasdaq_market', status.nasdaq_market), ('underlying_halt', status.underlying_halt),
               ('binance_bstock', status.binance_bstock)]
    if status.binance_spot: sources.append(('binance_spot', status.binance_spot))
    return [f'{name}: HTTP {o.http_status}, status {o.status}' for name, o in sources
            if o.http_status not in {200, 201} or o.status == 'UNKNOWN' or
            not 0 <= (at - o.fetched_at).total_seconds() <= 300]


class LiveMarketStatusProvider:
    """Shared 60s cache (including failures); no Nasdaq RSS polling above once/minute.

    Halt state persists in the audit store and clears only after an explicit, effective
    resumption newer than the latched halt. Feed disappearance does not clear it.
    """
    def __init__(self, store: AuditStore, client: httpx.Client | None = None, clock=None,
                 market_fetch: Callable[[], httpx.Response] | None = None):
        self.store = store
        self.client = client or httpx.Client(timeout=10, headers={
            'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json, application/xml, text/xml',
            'Accept-Encoding': 'identity'}, follow_redirects=False)
        self.market_fetch = market_fetch or fetch_nasdaq_market
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self._cache = {}
        self._lock = RLock()

    def close(self):
        self.client.close()

    def _read(self, url: str, params: dict | None = None, *, xml=False):
        key = (url, tuple(sorted((params or {}).items())))
        with self._lock:
            now = self.clock()
            if key in self._cache and (now - self._cache[key][0]).total_seconds() < 60:
                return self._cache[key]
            http_status = None
            try:
                response = self.market_fetch() if url == NASDAQ_MARKET else self.client.get(url, params=params)
                http_status = response.status_code
                response.raise_for_status()
                if http_status not in {200, 201}:
                    raise ValueError(f'Unexpected HTTP {http_status}; expected 200/201')
                value = response.text if xml else response.json()
                error = ''
            except httpx.HTTPStatusError as exc:
                value, error = None, f'HTTP {exc.response.status_code}: source unavailable'
            except (httpx.HTTPError, ValueError) as exc:
                value, error = None, f'{type(exc).__name__}: source unavailable or invalid response'
            result = (now, value, error, http_status)
            self._cache[key] = result
            return result

    def market(self) -> StatusObservation:
        fetched, body, error, http_status = self._read(NASDAQ_MARKET)
        try:
            if error: raise ValueError(error)
            status, raw = parse_market(body, self.clock())
            return StatusObservation(status=status, source=NASDAQ_MARKET, fetched_at=fetched, http_status=http_status,
                                     detail=str(raw.get('marketIndicator', '')), raw=raw)
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            return StatusObservation(source=NASDAQ_MARKET, fetched_at=fetched, http_status=http_status, detail=str(exc))

    def halt(self, ticker: str | None) -> StatusObservation:
        if not ticker:
            return StatusObservation(source=NASDAQ_HALTS, fetched_at=self.clock(), detail='Ticker mapping missing')
        fetched, xml, error, http_status = self._read(NASDAQ_HALTS, xml=True)
        try:
            if error: raise ValueError(error)
            rows, published = parse_halts(xml)
            if not 0 <= (self.clock() - published).total_seconds() <= 300:
                raise ValueError('Nasdaq halt feed publication is stale or future-dated')
            mine = [r for r in rows if r['IssueSymbol'].upper() == ticker.upper()]
            latest = max(mine, key=lambda r: event_time(r['HaltDate'], r['HaltTime']), default=None)
            prior = self.store.history('underlying_halt', ticker.upper(), 1)
            latched = prior[0] if prior and prior[0]['active'] else None
            if latest:
                halted_at = event_time(latest['HaltDate'], latest['HaltTime'])
                if halted_at > self.clock(): raise ValueError('Future halt event')
                resumed_at = (event_time(latest['ResumptionDate'], latest['ResumptionTradeTime'])
                              if latest.get('ResumptionDate') and latest.get('ResumptionTradeTime') else None)
                resumed = resumed_at is not None and halted_at <= resumed_at <= self.clock()
                # An older resumed entry cannot clear a more recent remembered halt.
                if latched and halted_at < datetime.fromisoformat(latched['halted_at']):
                    return StatusObservation(status='HALTED', source=NASDAQ_HALTS, fetched_at=fetched, http_status=http_status,
                                             published_at=published, detail='Retained newer halt', raw=latched['record'])
                self.store.put('underlying_halt', ticker.upper(), self.clock().isoformat(),
                               {'active': not resumed, 'halted_at': halted_at.isoformat(), 'record': latest})
                return StatusObservation(status='RESUMED' if resumed else 'HALTED', source=NASDAQ_HALTS,
                                         fetched_at=fetched, http_status=http_status, published_at=published, raw=latest,
                                         detail='Trade resumption effective' if resumed else 'Halted/paused; no effective trade resumption')
            if latched:
                return StatusObservation(status='HALTED', source=NASDAQ_HALTS, fetched_at=fetched, http_status=http_status,
                                         published_at=published, detail='Halt retained until explicit resumption', raw=latched['record'])
            return StatusObservation(status='NO_ACTIVE_HALT', source=NASDAQ_HALTS, fetched_at=fetched, http_status=http_status,
                                     published_at=published, detail='No entry in current feed; not proof of unrestricted trading')
        except (ValueError, KeyError, TypeError, ET.ParseError) as exc:
            return StatusObservation(source=NASDAQ_HALTS, fetched_at=fetched, http_status=http_status, detail=str(exc))

    def bstock(self, chain_id: int, token: str | None) -> StatusObservation:
        url = BINANCE_RWA + '/asset/market/status/ai'
        if not token:
            return StatusObservation(source=url, fetched_at=self.clock(), detail='Collateral-token address mapping missing')
        fetched, body, error, http_status = self._read(url, {'chainId': chain_id, 'contractAddress': token})
        try:
            if error: raise ValueError(error)
            status, raw = parse_bstock(body)
            return StatusObservation(status=status, source=url, fetched_at=fetched, http_status=http_status,
                                     detail=str(raw.get('reasonCode', '')), raw=raw)
        except (ValueError, TypeError, AttributeError) as exc:
            return StatusObservation(source=url, fetched_at=fetched, http_status=http_status, detail=str(exc))

    def spot(self, symbol: str | None) -> StatusObservation | None:
        if not symbol: return None
        url = 'https://api.binance.com/api/v3/exchangeInfo'
        fetched, body, error, http_status = self._read(url, {'symbol': symbol})
        try:
            if error: raise ValueError(error)
            row = next(r for r in body['symbols'] if r['symbol'] == symbol)
            status = {'TRADING': 'TRADING', 'HALT': 'HALTED', 'BREAK': 'PAUSED',
                      'CANCEL_ONLY': 'LIMITED'}.get(row.get('status'), 'UNKNOWN')
            return StatusObservation(status=status, source=url, fetched_at=fetched, http_status=http_status, raw=row)
        except (ValueError, KeyError, TypeError, StopIteration) as exc:
            return StatusObservation(source=url, fetched_at=fetched, http_status=http_status, detail=error or 'Spot symbol unavailable')

    def get(self, target) -> AssetMarketStatus:
        market, halt = self.market(), self.halt(target.underlying_ticker)
        bstock = self.bstock(target.chain_id, target.collateral_token_address)
        spot = self.spot(target.binance_spot_symbol)
        return AssetMarketStatus(asset=target.collateral_asset, ticker=target.underlying_ticker,
                                 chain_id=target.chain_id, collateral_token_address=target.collateral_token_address,
                                 as_of=self.clock(), nasdaq_market=market, underlying_halt=halt,
                                 binance_bstock=bstock, binance_spot=spot)
