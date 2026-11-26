// Live smoke test (not vitest): hits real Binance bapi, Binance Spot and Nasdaq RSS once, prints parsed signals.
// Prints 5 focus tokens by default; pass --all for every listed bStock.
import { BAPI_BASE, BinanceBapiSource, fetchBStockList } from "../src/halt/binanceBapi.js";
import { BinanceSpotSource } from "../src/halt/binanceSpot.js";
import { defaultFetch } from "../src/halt/http.js";
import { NasdaqHaltSource } from "../src/halt/nasdaq.js";
import type { AssetRef } from "../src/halt/types.js";
import { sessionRegime } from "../src/session.js";

const now = Date.now();
console.log(`now: ${new Date(now).toISOString()}  local-calendar regime: ${sessionRegime(now)}`);

const nasdaq = new NasdaqHaltSource();
const items = await nasdaq.items(now);
console.log(`\n[nasdaq] ${items ? `${items.length} items parsed` : "FETCH/PARSE FAILED"}`);
if (items) for (const i of items.slice(0, 5)) console.log(`  ${i.symbol} ${i.haltDate} ${i.haltTime} ${i.reasonCode} resumed=${i.resumptionTradeTime || "-"}`);

let list;
try {
  list = await fetchBStockList(defaultFetch);
} catch (e) {
  console.log("[bapi] list failed:", String(e));
  process.exit(1);
}
console.log(`\n[bapi] bStock list: ${list.length} tokens (${BAPI_BASE.slice(-30)}/stock/detail/list/ai?type=3)`);
const bapi = new BinanceBapiSource();
const spot = new BinanceSpotSource();
const focus = new Set(["TSLAB", "NVDAB", "SNDKB", "MSFTB", "SPCXB"]);
const shown = process.argv.includes("--all") ? list : list.filter((l) => focus.has(l.symbol));
for (const l of shown) {
  const asset: AssetRef = { symbol: l.symbol, ticker: l.ticker, token: l.contractAddress as `0x${string}`, spotSymbol: l.cs };
  const [n, b, s] = await Promise.all([nasdaq.check(asset, now), bapi.check(asset), spot.check(asset)]);
  console.log(`${l.symbol.padEnd(6)} ${l.contractAddress} mult=${l.multiplier}`);
  console.log(`   nasdaq(${l.ticker}): ${n.state}  ${n.detail}`);
  console.log(`   bapi:   ${b.state}  ${b.detail}`);
  console.log(`   spot:   ${s.state}  ${s.detail}`);
}
