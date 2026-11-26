import { describe, expect, it, vi } from "vitest";
import { parseOverview } from "./contracts";
import { proxyRisk } from "./proxy";

const available = { asset: "BNB_STOCK_NVDA", aliases: ["NVDA", "NVDAB"], status: "available", as_of: "2026-11-27T00:00:00Z",
  simulated: true, health_score: 72, risk_score: 28, category: "MODERATE", confidence: .9, data_quality: [],
  description: "Price swings can reduce collateral value.", factors: [{ name: "volatility", score: 45, description: "Price swings." }] };
const overview = { generated_at: "2026-11-27T00:00:00Z", refresh_after_seconds: 5, assets: [available] };

describe("stock overview contract", () => {
  it("accepts available and unavailable coverage without inventing missing scores", () => {
    const parsed = parseOverview({ ...overview, assets: [available, { asset: "QQQ", aliases: ["QQQB"], status: "unavailable", description: "Provider unavailable." }] });
    expect(parsed.assets[0].status).toBe("available");
    expect(parsed.assets[1]).not.toHaveProperty("health_score");
  });
  it("rejects contradictory scores, malformed factors, duplicate assets and invalid timestamps", () => {
    for (const row of [{ ...available, health_score: 99 }, { ...available, factors: [{ name: "volatility", score: 101, description: "Risk" }] }, { ...available, as_of: "yesterday" }]) {
      expect(() => parseOverview({ ...overview, assets: [row] })).toThrow();
    }
    expect(() => parseOverview({ ...overview, assets: [available, available] })).toThrow();
  });
  it("proxies only the read-only overview operation to the fixed backend path", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json(overview));
    const request = new Request("http://localhost/api/risk/overview");
    const result = await proxyRisk(request, "overview", "all", "http://localhost:8000", upstream);
    expect(result.status).toBe(200);
    expect(String(upstream.mock.calls[0][0])).toBe("http://localhost:8000/risk/overview");
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect((await proxyRisk(request, "advisory", "all", "http://localhost:8000", upstream)).status).toBe(404);
  });
});
