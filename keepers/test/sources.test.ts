import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapBapiStatus, BinanceBapiSource, fetchBStockList } from "../src/halt/binanceBapi.js";
import { BinanceSpotSource, mapSpotStatus } from "../src/halt/binanceSpot.js";
import { PriceContinuity } from "../src/halt/continuity.js";
import { MultiplierWatcherSource, type MultiplierEvent, type MultiplierReader } from "../src/halt/multiplierWatcher.js";
import { NasdaqHaltSource, nasdaqSignalFor, parseNasdaqHalts } from "../src/halt/nasdaq.js";
import type { FetchLike } from "../src/halt/types.js";
import { ASSET } from "./helpers.js";

const fixture = readFileSync(new URL("./fixtures/nasdaq-halts.xml", import.meta.url), "utf8");
const resp = (body: string, status = 200) => async () => ({ ok: status < 300, status, text: async () => body });

describe("nasdaq", () => {
  it("parses feed with BOM and namespaces", () => {
    const items = parseNasdaqHalts("﻿" + fixture);
    expect(items.map((i) => i.symbol)).toEqual(["PFSA", "TSLA", "TSLA", "NVDA"]);
    expect(items[0]!.reasonCode).toBe("T1");
  });
  it("tolerates a single item, no items, and junk fields", () => {
    expect(parseNasdaqHalts(`<rss><channel><item><title>abc</title></item></channel></rss>`)[0]!.symbol).toBe("ABC");
    expect(parseNasdaqHalts(`<rss><channel></channel></rss>`)).toEqual([]);
  });
  it("rejects non-RSS (e.g. HTML error page)", () => {
    expect(() => parseNasdaqHalts("<html><body>Service Unavailable</body></html>")).toThrow();
  });
  it("latest entry wins: unresumed halt -> halted; resumed -> ok; absent -> ok", () => {
    const items = parseNasdaqHalts(fixture);
    expect(nasdaqSignalFor(items, "PFSA").state).toBe("halted");
    expect(nasdaqSignalFor(items, "TSLA").state).toBe("ok"); // 11/23 unresumed halt is older than 11/24 resumed halt
    expect(nasdaqSignalFor(items, "NVDA").state).toBe("halted");
    expect(nasdaqSignalFor(items, "AAPL").state).toBe("ok");
  });
  it("rate limits to once per minute, failure cached too, then unknown", async () => {
    let n = 0;
    const f: FetchLike = async () => {
      n++;
      return { ok: false, status: 503, text: async () => "" };
    };
    const s = new NasdaqHaltSource(f, 60_000);
    expect((await s.check(ASSET, 1000)).state).toBe("unknown");
    expect((await s.check(ASSET, 30_000)).state).toBe("unknown");
    expect(n).toBe(1);
    await s.check(ASSET, 61_001);
    expect(n).toBe(2);
  });
  it("concurrent checks share one fetch", async () => {
    let n = 0;
    const f: FetchLike = async () => {
      n++;
      return { ok: true, status: 200, text: async () => fixture };
    };
    const s = new NasdaqHaltSource(f);
    await Promise.all([s.check(ASSET, 0), s.check({ ...ASSET, ticker: "NVDA" }, 0)]);
    expect(n).toBe(1);
  });
  it("garbage body -> unknown", async () => {
    const s = new NasdaqHaltSource(resp("<html/>"));
    expect((await s.check(ASSET, 0)).state).toBe("unknown");
  });
});

describe("bapi mapping", () => {
  it.each([
    [{ reasonCode: "TRADING", openState: true }, "ok"],
    [{ reasonCode: "MARKET_CLOSED" }, "ok"],
    [{ reasonCode: "ASSET_PAUSED", reasonMsg: "stock_split" }, "corp_action"],
    [{ reasonCode: "ASSET_PAUSED", reasonMsg: "cash_dividend" }, "corp_action"],
    [{ reasonCode: "MARKET_PAUSED", reasonMsg: "merger" }, "corp_action"],
    [{ reasonCode: "MARKET_PAUSED", reasonMsg: "stock_dividend" }, "corp_action"],
    [{ reasonCode: "ASSET_PAUSED", reasonMsg: "maintenance" }, "halted"],
    [{ reasonCode: "ASSET_PAUSED", reasonMsg: null }, "halted"],
    [{ reasonCode: "MARKET_PAUSED", reasonMsg: "earnings" }, "halted"],
    [{ reasonCode: "ASSET_LIMITED" }, "corp_action"],
    [{ reasonCode: "MARKET_MAINTENANCE" }, "halted"],
    [{ reasonCode: "UNSUPPORTED" }, "unknown"],
    [{ reasonCode: "SOMETHING_NEW" }, "unknown"],
    [{}, "unknown"],
    [{ reasonCode: "TRADING", marketStatus: "pause" }, "halted"],
  ])("%j -> %s", (d, exp) => expect(mapBapiStatus(d).state).toBe(exp));

  it("sends required headers and token address, parses the live envelope", async () => {
    let seen: { url: string; headers?: Record<string, string> } | undefined;
    const f: FetchLike = async (url, init) => {
      seen = { url, headers: init?.headers };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: "000000", data: { openState: true, marketStatus: null, reasonCode: "TRADING", reasonMsg: null }, success: true }),
      };
    };
    const sig = await new BinanceBapiSource(f).check(ASSET);
    expect(sig.state).toBe("ok");
    expect(seen!.url).toContain(`chainId=56&contractAddress=${ASSET.token}`);
    expect(seen!.headers).toMatchObject({ "Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)" });
  });
  it("http error, bad json, error envelope -> unknown", async () => {
    expect((await new BinanceBapiSource(resp("", 500)).check(ASSET)).state).toBe("unknown");
    expect((await new BinanceBapiSource(resp("not json")).check(ASSET)).state).toBe("unknown");
    expect((await new BinanceBapiSource(resp(JSON.stringify({ code: "100001", success: false }))).check(ASSET)).state).toBe("unknown");
  });
  it("bStock list", async () => {
    const l = await fetchBStockList(resp(JSON.stringify({ code: "000000", data: [{ chainId: "56", contractAddress: "0xabc", symbol: "X", ticker: "X", multiplier: "1" }] })));
    expect(l).toHaveLength(1);
  });
});

describe("spot", () => {
  it.each([["TRADING", "ok"], ["HALT", "halted"], ["BREAK", "halted"], ["PRE_TRADING", "unknown"], [undefined, "unknown"]] as const)(
    "%s -> %s",
    (s, exp) => expect(mapSpotStatus(s).state).toBe(exp),
  );
  it("uses spotSymbol, handles invalid-symbol error body", async () => {
    let url = "";
    const f: FetchLike = async (u) => {
      url = u;
      return { ok: true, status: 200, text: async () => JSON.stringify({ symbols: [{ symbol: "TSLABUSDT", status: "HALT" }] }) };
    };
    expect((await new BinanceSpotSource(f).check(ASSET)).state).toBe("halted");
    expect(url).toContain("symbol=TSLABUSDT");
    expect((await new BinanceSpotSource(resp(JSON.stringify({ code: -1121, msg: "Invalid symbol." }), 400)).check(ASSET)).state).toBe("unknown");
    expect((await new BinanceSpotSource(resp(JSON.stringify({ code: -1121, msg: "Invalid symbol." }))).check(ASSET)).state).toBe("unknown");
  });
});

class FakeChain implements MultiplierReader {
  head = 100_000n;
  events: MultiplierEvent[] = [];
  m = 10n ** 18n;
  fail = false;
  ranges: [bigint, bigint][] = [];
  async getBlockNumber() {
    if (this.fail) throw new Error("rpc");
    return this.head;
  }
  async getEvents(_t: `0x${string}`, from: bigint, to: bigint) {
    this.ranges.push([from, to]);
    return this.events.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
  }
  async uiMultiplier() {
    return this.m;
  }
}

describe("multiplier watcher", () => {
  const T0 = 1_800_000_000_000;
  it("ok when no events", async () => {
    const w = new MultiplierWatcherSource(new FakeChain());
    expect((await w.check(ASSET, T0)).state).toBe("ok");
  });
  it("event with future effectiveAt -> corp_action until effectiveAt + hold", async () => {
    const ch = new FakeChain();
    const w = new MultiplierWatcherSource(ch, { holdAfterEffectiveMs: 3600_000 });
    await w.check(ASSET, T0);
    ch.head += 10n;
    ch.events.push({ oldMultiplier: 10n ** 18n, newMultiplier: 8n * 10n ** 18n, effectiveAt: BigInt(T0 / 1000 + 86_400), blockNumber: ch.head - 3n });
    expect((await w.check(ASSET, T0)).state).toBe("corp_action");
    expect((await w.check(ASSET, T0 + 86_400_000 + 3_599_000)).state).toBe("corp_action");
    expect((await w.check(ASSET, T0 + 86_400_000 + 3_601_000)).state).toBe("ok");
  });
  it("does not re-read old blocks (cursor) and chunks first scan", async () => {
    const ch = new FakeChain();
    const w = new MultiplierWatcherSource(ch, { lookbackBlocks: 12_000n, chunkBlocks: 5_000n });
    await w.check(ASSET, T0);
    expect(ch.ranges).toEqual([[88_000n, 92_999n], [93_000n, 97_999n], [98_000n, 100_000n]]);
    ch.ranges = [];
    ch.head = 100_005n;
    await w.check(ASSET, T0);
    expect(ch.ranges).toEqual([[100_001n, 100_005n]]);
  });
  it("detects effective multiplier change even with no log", async () => {
    const ch = new FakeChain();
    const w = new MultiplierWatcherSource(ch);
    await w.check(ASSET, T0);
    ch.m = 8n * 10n ** 18n;
    expect((await w.check(ASSET, T0 + 1000)).state).toBe("corp_action");
  });
  it("rpc failure -> unknown", async () => {
    const ch = new FakeChain();
    ch.fail = true;
    expect((await new MultiplierWatcherSource(ch).check(ASSET, T0)).state).toBe("unknown");
  });
});

describe("price continuity", () => {
  const mk = (p: { price: number; timestampMs: number }) => {
    const cur = { ...p };
    const pc = new PriceContinuity({ read: async () => ({ ...cur }) }, 500, 15 * 60_000);
    return { pc, cur };
  };
  const ctx = { latchedSinceMs: 1000, nowMs: 100_000 };
  it("fails with no reference", async () => {
    expect((await mk({ price: 100, timestampMs: 50_000 }).pc.check(ASSET, ctx)).ok).toBe(false);
  });
  it("passes within band with a fresh print after the latch", async () => {
    const { pc, cur } = mk({ price: 100, timestampMs: 500 });
    await pc.observe(ASSET);
    cur.price = 103;
    cur.timestampMs = 90_000;
    expect((await pc.check(ASSET, ctx)).ok).toBe(true);
  });
  it("fails outside band (e.g. naive split: price/8, multiplier not applied)", async () => {
    const { pc, cur } = mk({ price: 800, timestampMs: 500 });
    await pc.observe(ASSET);
    cur.price = 100;
    cur.timestampMs = 90_000;
    const r = await pc.check(ASSET, ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("deviation");
  });
  it("fails on a print older than the latch, or stale", async () => {
    const { pc, cur } = mk({ price: 100, timestampMs: 500 });
    await pc.observe(ASSET);
    expect((await pc.check(ASSET, ctx)).detail).toContain("since the latch");
    cur.timestampMs = 2000;
    expect((await pc.check(ASSET, { latchedSinceMs: 1000, nowMs: 2000 + 16 * 60_000 })).detail).toContain("stale");
  });
  it("rebase accepts new level", async () => {
    const { pc, cur } = mk({ price: 100, timestampMs: 500 });
    await pc.observe(ASSET);
    cur.price = 50;
    cur.timestampMs = 90_000;
    expect((await pc.check(ASSET, ctx)).ok).toBe(false);
    await pc.rebase(ASSET);
    expect((await pc.check(ASSET, ctx)).ok).toBe(true);
  });
});
