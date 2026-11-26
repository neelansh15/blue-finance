import { describe, expect, it } from "vitest";
import { MARKETS, STARTING_POSITIONS } from "../../../app/app/markets";
import { createBlueClient, numberToWad } from "../blue/client";
import { demoPosition, lendingPosition, requestForPosition } from "./adapter";
import { isExpired, parseAdvisory, parseMarketStatus, parseRiskRequest, statusFresh } from "./contracts";

describe("advisory account adapter", () => {
  it("converts cents and scaled tokens, and never substitutes synthetic borrowers", () => {
    const position = lendingPosition(MARKETS[0], STARTING_POSITIONS.NVDAB);
    expect(position).toMatchObject({ quantity: 10, debtUsd: 350, uiPriceUsd: 200 });
    const body = requestForPosition(position, "friday");
    expect(body.borrowers).toEqual([{ borrower_id: "demo-position", collateral_quantity: 10, debt_usd: 350, liquidation_threshold: .625 }]);
    expect(parseRiskRequest(body)).toEqual(body);
    expect(requestForPosition({ ...position, quantity: 0, debtUsd: 0 }, "baseline").borrowers).toEqual([]);
  });

  it("normalizes uiMultiplier and blocks unsupported frozen or halted positions", async () => {
    const client = createBlueClient();
    const snapshot = await client.getSnapshot();
    expect(demoPosition({ ...snapshot, uiMultiplier: numberToWad(2) }).quantity).toBe(20);
    client.demo.announceSplit(2);
    expect(() => requestForPosition(demoPosition({ ...snapshot, regime: "HALTED" }), "baseline")).toThrow(/halted/);
    const split = await client.getSnapshot();
    expect(() => requestForPosition(demoPosition(split), "baseline")).toThrow(/frozen/);
  });

  it("rejects unsupported markets, invalid balances and unbounded browser payloads", () => {
    expect(() => requestForPosition(lendingPosition(MARKETS[1], STARTING_POSITIONS.QQQB), "baseline")).toThrow(/NVDAb only/);
    const p = lendingPosition(MARKETS[0], STARTING_POSITIONS.NVDAB);
    expect(() => requestForPosition({ ...p, quantity: NaN }, "baseline")).toThrow();
    expect(() => requestForPosition({ ...p, quantity: 0 }, "baseline")).toThrow(/without collateral/);
    expect(() => parseRiskRequest({ scenario: "__proto__", borrowers: [] })).toThrow();
    expect(() => parseRiskRequest({ ...requestForPosition(p, "baseline"), snapshot: {} })).toThrow();
    expect(() => parseRiskRequest({ scenario: "friday", borrowers: [{ collateral_quantity: 1e100 }] })).toThrow();
    expect(() => parseAdvisory({ recommendation: { recommended_parameters: { ltv: .9 } } })).toThrow();
  });

  it("expires replays and never treats stale or future status as fresh", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(isExpired("2026-11-20T12:00:00Z", now)).toBe(true);
    expect(isExpired("2026-11-26T12:15:00Z", now)).toBe(false);
    expect(statusFresh("2026-11-26T11:59:00Z", now)).toBe(true);
    expect(statusFresh("2026-11-26T11:54:00Z", now)).toBe(false);
    expect(statusFresh("2026-11-26T12:01:00Z", now)).toBe(false);
  });

  it("requires real successful source HTTP responses before displaying live status", () => {
    const observation = { status: "TRADING", http_status: 200, fetched_at: "2026-11-26T12:00:00Z", detail: "" };
    const status = { asset: "BNB_STOCK_NVDA", simulated: false, nasdaq_market: { ...observation, status: "CLOSED" },
      underlying_halt: { ...observation, status: "NO_ACTIVE_HALT" }, binance_bstock: observation };
    expect(parseMarketStatus([status])[0].observations).toHaveLength(3);
    expect(() => parseMarketStatus([{ ...status, binance_bstock: { ...observation, http_status: 503 } }])).toThrow();
    expect(() => parseMarketStatus([{ ...status, binance_bstock: { ...observation, status: "UNKNOWN" } }])).toThrow();
    expect(() => parseMarketStatus([{ ...status, simulated: true }])).toThrow();
    expect(() => parseMarketStatus([])).toThrow();
  });
});
