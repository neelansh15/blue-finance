import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ readContract: vi.fn() }));
vi.mock("viem", async importOriginal => ({ ...await importOriginal<typeof import("viem")>(), createPublicClient: () => rpc }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-11-27T00:00:00Z"));
  rpc.readContract.mockReset().mockImplementation(async ({ functionName }) => {
    if (functionName === "decimals") return 8;
    if (functionName === "uiMultiplier") return 10n ** 18n;
    return [1n, 100n * 10n ** 8n, 0n, BigInt(Math.floor(Date.now() / 1000)), 1n];
  });
});
afterEach(() => vi.useRealTimers());

describe("shared server Atlas cache", () => {
  it("shares RPC reads across visitors, isolates assets and keeps the feed timestamp", async () => {
    const { getAtlasPrice } = await import("./server");
    const first = await Promise.all([getAtlasPrice("NVDAB"), getAtlasPrice("NVDAB")]);
    expect(rpc.readContract).toHaveBeenCalledTimes(3);
    expect(first[0]).toEqual(first[1]);
    vi.advanceTimersByTime(59_999);
    expect(await getAtlasPrice("NVDAB")).toEqual(first[0]);
    expect(rpc.readContract).toHaveBeenCalledTimes(3);
    await getAtlasPrice("TSLAB");
    expect(rpc.readContract).toHaveBeenCalledTimes(6);
    vi.advanceTimersByTime(1);
    expect((await getAtlasPrice("NVDAB")).updatedAt).toBeGreaterThan(first[0].updatedAt);
    expect(rpc.readContract).toHaveBeenCalledTimes(9);
  });
  it("caches RPC failure and returns sanitized 503 without stale price", async () => {
    const { GET } = await import("../../../app/api/atlas/prices/[symbol]/route");
    const get = (symbol = "NVDAB") => GET(new Request("http://localhost"), { params: Promise.resolve({ symbol }) });
    expect((await get()).status).toBe(200);
    vi.advanceTimersByTime(60_000);
    rpc.readContract.mockRejectedValue(new Error("secret-provider-diagnostic"));
    const failed = await get();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("secret-provider");
    expect((await get()).status).toBe(503);
    expect(rpc.readContract).toHaveBeenCalledTimes(6);
    expect((await get("__proto__")).status).toBe(404);
    expect(rpc.readContract).toHaveBeenCalledTimes(6);
  });
  it("covers exactly the five listed bStocks in order and rejects others", async () => {
    const { BSTOCK_FEEDS } = await import("./prices");
    expect(Object.keys(BSTOCK_FEEDS)).toEqual(["TSLAB", "NVDAB", "QQQB", "SPCXB", "GOOGLB"]);
    const { GET, } = await import("../../../app/api/atlas/prices/[symbol]/route");
    for (const symbol of ["QQQB", "SPCXB", "GOOGLB"]) {
      const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ symbol }) });
      expect(response.status).toBe(200);
      expect((await response.json()).symbol).toBe(symbol);
    }
    const rejected = await GET(new Request("http://localhost"), { params: Promise.resolve({ symbol: "AAPLB" }) });
    expect(rejected.status).toBe(404);
  });
  it("invalid oracle rounds remain unavailable for the cache period", async () => {
    const { getAtlasPrice } = await import("./server");
    rpc.readContract.mockImplementation(async ({ functionName }) => functionName === "decimals" ? 8 :
      functionName === "uiMultiplier" ? 10n ** 18n : [2n, 100n, 0n, 0n, 1n]);
    await expect(getAtlasPrice("NVDAB")).rejects.toThrow("Invalid Atlas observation");
    await expect(getAtlasPrice("NVDAB")).rejects.toThrow();
    expect(rpc.readContract).toHaveBeenCalledTimes(3);
  });
});
