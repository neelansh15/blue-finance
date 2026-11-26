// Binance bapi RWA endpoints (public, undocumented /ai paths, no SLA).
import { defaultFetch, errMsg, getJson } from "./http.js";
import { corpAction, halted, ok, unknown, type AssetRef, type FetchLike, type HaltSource, type Signal } from "./types.js";

export const BAPI_BASE = "https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa";
export const BAPI_HEADERS = { "Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)" };

/** reasonMsg values that mean a corporate action rather than a plain halt. */
export const CORP_ACTION_MSGS = new Set([
  "stock_split", "reverse_split", "cash_dividend", "stock_dividend", "merger", "acquisition", "spinoff", "spin_off",
]);

export interface BapiAssetStatus {
  openState?: boolean | null;
  marketStatus?: string | null;
  reasonCode?: string | null;
  reasonMsg?: string | null;
  nextOpenTime?: number | null;
  nextCloseTime?: number | null;
}

/** Pure mapping from bapi data to a signal. */
export function mapBapiStatus(d: BapiAssetStatus): Signal {
  const code = (d.reasonCode ?? "").toUpperCase();
  const msg = (d.reasonMsg ?? "").toLowerCase();
  const tag = `reasonCode=${d.reasonCode ?? "null"} reasonMsg=${d.reasonMsg ?? "null"} marketStatus=${d.marketStatus ?? "null"}`;
  switch (code) {
    case "TRADING":
      // Defensive: an explicit "pause" market status contradicts TRADING; be conservative.
      if ((d.marketStatus ?? "").toLowerCase() === "pause") return halted(`marketStatus=pause despite TRADING (${tag})`);
      return ok(tag);
    case "MARKET_CLOSED":
      return ok(`${tag} (session clock is computed locally)`);
    case "ASSET_PAUSED":
    case "MARKET_PAUSED":
      return CORP_ACTION_MSGS.has(msg) ? corpAction(tag) : halted(tag);
    case "ASSET_LIMITED":
      return corpAction(tag);
    case "MARKET_MAINTENANCE":
      return halted(tag);
    case "UNSUPPORTED":
      return unknown(`asset unsupported by bapi (${tag})`);
    default:
      return unknown(`unrecognised reasonCode (${tag})`);
  }
}

interface Envelope<T> {
  code?: string;
  success?: boolean;
  data?: T;
  message?: string | null;
}

export async function fetchBapiAssetStatus(f: FetchLike, token: string, chainId = 56): Promise<BapiAssetStatus> {
  const url = `${BAPI_BASE}/asset/market/status/ai?chainId=${chainId}&contractAddress=${token}`;
  const body = (await getJson(f, url, BAPI_HEADERS)) as Envelope<BapiAssetStatus>;
  if (!body || body.success === false || (body.code && body.code !== "000000") || !body.data) {
    throw new Error(`bapi error code=${body?.code} message=${body?.message}`);
  }
  return body.data;
}

export class BinanceBapiSource implements HaltSource {
  readonly name = "binance-bapi";
  constructor(private readonly fetchFn: FetchLike = defaultFetch, private readonly chainId = 56) {}

  async check(asset: AssetRef): Promise<Signal> {
    try {
      return mapBapiStatus(await fetchBapiAssetStatus(this.fetchFn, asset.statusToken ?? asset.token, this.chainId));
    } catch (e) {
      return unknown(`bapi fetch failed: ${errMsg(e)}`);
    }
  }
}

export interface BStockListing {
  chainId: string;
  contractAddress: string;
  symbol: string;
  ticker: string;
  multiplier: string;
  cs?: string;
}

/** bStock list (type=3) -> addresses, tickers, current multiplier, spot symbol (`cs`). */
export async function fetchBStockList(f: FetchLike = defaultFetch): Promise<BStockListing[]> {
  const body = (await getJson(f, `${BAPI_BASE}/stock/detail/list/ai?type=3`, BAPI_HEADERS)) as Envelope<BStockListing[]>;
  if (!body || !Array.isArray(body.data)) throw new Error(`bapi list error code=${body?.code}`);
  return body.data;
}
