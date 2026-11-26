import { afterEach, expect, it, vi } from "vitest";
import { getJson, getText } from "../src/halt/http.js";
import { NasdaqHaltSource } from "../src/halt/nasdaq.js";
import { ASSET } from "./helpers.js";

afterEach(() => vi.useRealTimers());
it("shares Binance requests across callers, separates URLs and headers, and expires", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const f = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"status":"TRADING"}' }));
  await Promise.all([getJson(f, "https://binance.test/a"), getJson(f, "https://binance.test/a")]);
  expect(f).toHaveBeenCalledTimes(1);
  await getText(f, "https://binance.test/b");
  await getText(f, "https://binance.test/a", { Accept: "text/xml" });
  expect(f).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(59_999);
  await getJson(f, "https://binance.test/a");
  expect(f).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(1);
  await getJson(f, "https://binance.test/a");
  expect(f).toHaveBeenCalledTimes(4);
});
it("holds HTTP and network failures for one minute", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  for (const f of [vi.fn(async () => ({ ok: false, status: 429, text: async () => "" })),
    vi.fn(async () => { throw new Error("network"); })]) {
    await expect(getText(f, "https://binance.test")).rejects.toThrow();
    await expect(getText(f, "https://binance.test")).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await expect(getText(f, "https://binance.test")).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(2);
  }
});
it("Nasdaq keeps its single TTL rather than stacking two caches", async () => {
  const f = vi.fn(async () => ({ ok: true, status: 200, text: async () => '<rss><channel/></rss>' }));
  const source = new NasdaqHaltSource(f);
  await source.check(ASSET, 0); await source.check(ASSET, 59_999);
  expect(f).toHaveBeenCalledTimes(1);
  await source.check(ASSET, 60_000);
  expect(f).toHaveBeenCalledTimes(2);
});
it("multiplier monitoring shares RPC reads per token and refreshes after one minute", async () => {
  vi.useFakeTimers({ toFake: ["performance"] });
  const { viemMultiplierReader } = await import("../src/halt/multiplierWatcher.js");
  const client = {
    getBlockNumber: vi.fn(async () => 100n),
    readContract: vi.fn(async () => 10n ** 18n),
    getContractEvents: vi.fn(async () => []),
  };
  const reader = viemMultiplierReader(client as unknown as import("viem").PublicClient);
  await Promise.all([reader.getBlockNumber(), reader.getBlockNumber()]);
  await reader.uiMultiplier(ASSET.token); await reader.uiMultiplier(ASSET.token);
  await reader.getEvents(ASSET.token, 0n, 100n); await reader.getEvents(ASSET.token, 0n, 100n);
  expect(client.getBlockNumber).toHaveBeenCalledTimes(1);
  expect(client.readContract).toHaveBeenCalledTimes(1);
  expect(client.getContractEvents).toHaveBeenCalledTimes(1);
  await reader.uiMultiplier("0x0000000000000000000000000000000000000001");
  expect(client.readContract).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(60_000);
  await reader.getBlockNumber(); await reader.uiMultiplier(ASSET.token);
  expect(client.getBlockNumber).toHaveBeenCalledTimes(2);
  expect(client.readContract).toHaveBeenCalledTimes(3);
});
