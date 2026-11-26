import { describe, expect, it, vi } from "vitest";
import { proxyRisk } from "./proxy";

const origin = "http://127.0.0.1:8000";
const request = (body = { scenario: "friday", borrowers: [] }) => new Request("http://localhost/api/risk/advisory/NVDAB", {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: "private=do-not-forward", Authorization: "secret" }, body: JSON.stringify(body),
});

describe("same-origin risk proxy", () => {
  it("maps NVDAB to NVDA and forwards only the validated body without browser credentials", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ simulated: true }));
    const response = await proxyRisk(request(), "advisory", "NVDAB", origin, upstream);
    expect(response.status).toBe(200);
    const [url, options] = upstream.mock.calls[0];
    expect(String(url)).toBe(`${origin}/risk/advisory/NVDA`);
    expect(options?.headers).toEqual({ "Content-Type": "application/json", Accept: "application/json" });
    expect(JSON.parse(options?.body as string)).toEqual({ scenario: "friday", borrowers: [] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects unsupported assets, operations, invalid bodies and missing configuration without upstream calls", async () => {
    const upstream = vi.fn<typeof fetch>();
    expect((await proxyRisk(request(), "advisory", "QQQB", origin, upstream)).status).toBe(404);
    expect((await proxyRisk(request(), "route", "NVDAB", origin, upstream)).status).toBe(405);
    expect((await proxyRisk(request(), "advisory", "NVDAB", "", upstream)).status).toBe(503);
    expect((await proxyRisk(request(), "advisory", "NVDAB", "https://secret:password@example.com", upstream)).status).toBe(503);
    expect((await proxyRisk(request({ scenario: "bad", borrowers: [] }), "advisory", "NVDAB", origin, upstream)).status).toBe(400);
    const big = new Request("http://localhost", { method: "POST", body: "x".repeat(16385) });
    expect((await proxyRisk(big, "advisory", "NVDAB", origin, upstream)).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("preserves unavailable live status as failure and handles timeouts and HTML upstream errors", async () => {
    const get = () => new Request("http://localhost/api/risk/market-status/NVDAB");
    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ detail: "Source unavailable", observations: [] }, { status: 503 }));
    expect((await proxyRisk(get(), "market-status", "NVDA", origin, unavailable)).status).toBe(503);
    const timeout = vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout"));
    expect((await proxyRisk(request(), "advisory", "NVDAB", origin, timeout)).status).toBe(503);
    const html = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Private upstream error</html>", { status: 500 }));
    const response = await proxyRisk(request(), "advisory", "NVDAB", origin, html);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Private upstream");
  });
});
