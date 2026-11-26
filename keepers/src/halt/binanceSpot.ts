import { defaultFetch, errMsg, getJson } from "./http.js";
import { halted, ok, unknown, type AssetRef, type FetchLike, type HaltSource, type Signal } from "./types.js";

export const SPOT_EXCHANGE_INFO = "https://api.binance.com/api/v3/exchangeInfo";

export function mapSpotStatus(status: string | undefined): Signal {
  switch ((status ?? "").toUpperCase()) {
    case "TRADING":
      return ok("spot status TRADING");
    case "HALT":
    case "BREAK":
      return halted(`spot status ${status}`);
    default:
      return unknown(`spot status ${status ?? "missing"}`);
  }
}

export class BinanceSpotSource implements HaltSource {
  readonly name = "binance-spot";
  constructor(private readonly fetchFn: FetchLike = defaultFetch) {}

  async check(asset: AssetRef): Promise<Signal> {
    const sym = asset.spotSymbol ?? `${asset.symbol}USDT`;
    try {
      const body = (await getJson(this.fetchFn, `${SPOT_EXCHANGE_INFO}?symbol=${sym}`)) as {
        symbols?: { symbol: string; status: string }[];
        code?: number;
        msg?: string;
      };
      const s = body.symbols?.find((x) => x.symbol === sym);
      if (!s) return unknown(`no spot symbol ${sym} in response (code=${body.code} msg=${body.msg})`);
      const sig = mapSpotStatus(s.status);
      return { state: sig.state, detail: `${sym}: ${sig.detail}` };
    } catch (e) {
      return unknown(`spot fetch failed: ${errMsg(e)}`);
    }
  }
}
