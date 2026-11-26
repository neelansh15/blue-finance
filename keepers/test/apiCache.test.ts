import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiCache } from "../src/apiCache.js";

afterEach(() => vi.useRealTimers());
describe("one-minute API cache", () => {
  it("coalesces concurrent calls, separates inputs, and refreshes exactly at 60 seconds", async () => {
    let now = 0;
    const cache = new ApiCache<string>(() => now);
    const load = vi.fn(async () => "value");
    expect(await Promise.all([cache.get("a", load), cache.get("a", load)])).toEqual(["value", "value"]);
    now = 59_999;
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.get("b", load);
    now = 60_000;
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("caches rejection without serving stale success and retries only after expiry", async () => {
    let now = 0;
    const cache = new ApiCache<string>(() => now);
    const load = vi.fn(async () => "ok");
    await cache.get("a", load);
    now = 60_000;
    load.mockRejectedValue(new Error("429"));
    await expect(cache.get("a", load)).rejects.toThrow("429");
    now = 119_999;
    await expect(cache.get("a", load)).rejects.toThrow("429");
    expect(load).toHaveBeenCalledTimes(2);
    now = 120_000;
    load.mockResolvedValue("recovered");
    expect(await cache.get("a", load)).toBe("recovered");
  });
  it("does not duplicate slow requests when the TTL elapses while pending", async () => {
    let now = 0;
    const cache = new ApiCache<string>(() => now);
    let finish!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const first = cache.get("a", load);
    await Promise.resolve();
    now = 60_001;
    const second = cache.get("a", load);
    expect(first).toBe(second);
    finish("done");
    await first;
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("bounds memory and refetches on clock rollback", async () => {
    let now = 100;
    const cache = new ApiCache<string>(() => now, 2);
    const load = vi.fn(async () => "ok");
    await cache.get("a", load); await cache.get("b", load); await cache.get("c", load);
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(4);
    now = 0;
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(5);
  });
});
