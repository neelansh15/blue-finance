import { describe, expect, it } from "vitest";
import {
  actionLimits, createBlueClient, initialPoolState, poolMetrics, positionMetrics, scheduledStatusAt, statusNotice,
  type PoolState,
} from "./client";

const et = (iso: string) => new Date(iso); // ISO with explicit offset

/** $1,000 of NVDAB collateral and $500 debt, matching the architecture example. */
function exampleState(): PoolState {
  const state = initialPoolState();
  return {
    ...state,
    stocks: { ...state.stocks, NVDAB: { ...state.stocks.NVDAB, price: 10_000, acceptedPrice: 10_000 } },
    account: { ...state.account, stock: "NVDAB", collateral: 100_000, debt: 50_000 },
  };
}

describe("pool model", () => {
  it("applies the borrowing discount to borrowing power only, never to health factor", () => {
    const state = exampleState();
    const open = positionMetrics({ ...state, schedule: "OPEN" });
    const weekend = positionMetrics({ ...state, schedule: "WEEKEND" });
    expect(open.borrowLimit).toBe(50_000);
    expect(weekend.borrowLimit).toBe(42_500);
    expect(open.healthFactor).toBe(1.25);
    expect(weekend.healthFactor).toBe(1.25);
    expect(positionMetrics({ ...state, schedule: "EXTENDED" }).borrowLtv).toBeCloseTo(0.48);
    expect(positionMetrics({ ...state, schedule: "CLOSED" }).borrowLtv).toBeCloseTo(0.45);
  });

  it("derives rates from utilisation", () => {
    const state = initialPoolState();
    const pool = poolMetrics(state);
    expect(pool.utilisation).toBeCloseTo(0.6);
    expect(pool.borrowApr).toBeCloseTo(0.05);
    expect(pool.supplyApr).toBeCloseTo(0.05 * 0.6 * 0.9);
    const high = poolMetrics({ ...state, borrowed: state.supplied * 0.9 });
    expect(high.borrowApr).toBeCloseTo(0.02 + 0.04 + 0.6 * 0.5);
  });

  it("follows the MarketCalendar schedule in US Eastern time", () => {
    expect(scheduledStatusAt(et("2026-11-23T10:00:00-05:00"))).toBe("OPEN");
    expect(scheduledStatusAt(et("2026-11-23T08:00:00-05:00"))).toBe("EXTENDED");
    expect(scheduledStatusAt(et("2026-11-23T02:00:00-05:00"))).toBe("CLOSED");
    expect(scheduledStatusAt(et("2026-11-24T21:00:00-05:00"))).toBe("CLOSED");
    expect(scheduledStatusAt(et("2026-11-20T21:00:00-05:00"))).toBe("WEEKEND"); // Friday evening
    expect(scheduledStatusAt(et("2026-11-21T12:00:00-05:00"))).toBe("WEEKEND"); // Saturday
    expect(scheduledStatusAt(et("2026-11-22T19:30:00-05:00"))).toBe("WEEKEND"); // Sunday before 8pm
    expect(scheduledStatusAt(et("2026-11-22T20:30:00-05:00"))).toBe("CLOSED"); // Sunday 8pm onward
    expect(scheduledStatusAt(et("2026-11-26T12:00:00-05:00"))).toBe("WEEKEND"); // Thanksgiving
    expect(scheduledStatusAt(et("2026-11-26T21:00:00-05:00"))).toBe("CLOSED");
    expect(scheduledStatusAt(et("2026-11-27T14:00:00-05:00"))).toBe("EXTENDED"); // early close at 13:00
    expect(scheduledStatusAt(et("2026-11-27T17:30:00-05:00"))).toBe("WEEKEND");
    expect(scheduledStatusAt(et("2027-01-17T21:00:00-05:00"))).toBe("WEEKEND"); // Sunday before MLK day
  });

  it("keeps one collateral stock per account", () => {
    const limits = actionLimits(initialPoolState(), "TSLAB");
    expect(limits.deposit.max).toBe(0);
    expect(limits.deposit.reason).toMatch(/One stock per account/);
    expect(limits.borrow.max).toBe(0);
  });

  it("caps borrowing by the stock borrow cap for the current status", () => {
    const state = initialPoolState();
    const rich = { ...state, supplied: 200_000_00, account: { ...state.account, collateral: 2_000 * 10_000 } };
    expect(actionLimits({ ...rich, schedule: "OPEN" }, "NVDAB").borrow.max).toBe(40_000_00 - 6_000_00);
    const weekend = actionLimits({ ...rich, schedule: "WEEKEND" }, "NVDAB").borrow;
    expect(weekend.max).toBe(10_000_00 - 6_000_00);
  });
});

describe("Blue demo client", () => {
  it("borrows within the limit and tightens the limit over the weekend", () => {
    const client = createBlueClient();
    let updates = 0;
    const unsubscribe = client.subscribe(() => { updates += 1; });
    const max = actionLimits(client.getState(), "NVDAB").borrow.max;
    expect(client.act("borrow", "NVDAB", max + 1).ok).toBe(false);
    expect(client.act("borrow", "NVDAB", 10_000).ok).toBe(true);
    expect(client.getState().account.debt).toBe(100_000);
    const before = positionMetrics(client.getState());
    client.demo.setSchedule("WEEKEND");
    const after = positionMetrics(client.getState());
    expect(after.borrowLimit).toBeLessThan(before.borrowLimit);
    expect(after.healthFactor).toBe(before.healthFactor);
    unsubscribe();
    expect(updates).toBe(2);
  });

  it("halt blocks borrowing and withdrawals with debt, while repay and adding collateral work", () => {
    const client = createBlueClient();
    client.demo.halt("NVDAB");
    const limits = actionLimits(client.getState(), "NVDAB");
    expect(limits.borrow.max).toBe(0);
    expect(limits.withdraw.max).toBe(0);
    expect(limits.withdraw.reason).toMatch(/resumes when trading does/);
    expect(statusNotice(client.getState(), "NVDAB")?.title).toBe("NVDAB is halted.");
    expect(client.act("repay", "NVDAB", 10_000).ok).toBe(true);
    expect(client.act("deposit", "NVDAB", 10_000).ok).toBe(true);
    // Other stocks keep borrowing.
    expect(actionLimits(client.getState(), "TSLAB").borrow.reason).not.toMatch(/halted/);
    expect(client.demo.clearStatus("NVDAB").ok).toBe(true);
    expect(actionLimits(client.getState(), "NVDAB").borrow.max).toBeGreaterThan(0);
  });

  it("keeper lapse blocks borrowing but allows withdrawals within the limit until recovery completes", () => {
    const client = createBlueClient();
    client.demo.keeperLapse();
    let limits = actionLimits(client.getState(), "NVDAB");
    expect(limits.borrow.max).toBe(0);
    expect(limits.borrow.reason).toMatch(/Monitoring has lapsed/);
    expect(limits.withdraw.max).toBeGreaterThan(0);
    expect(client.act("withdraw", "NVDAB", limits.withdraw.max + 1).ok).toBe(false);
    client.demo.keeperReport();
    expect(actionLimits(client.getState(), "NVDAB").borrow.reason).toMatch(/30 minutes/);
    client.demo.finishRecovery();
    limits = actionLimits(client.getState(), "NVDAB");
    expect(limits.borrow.max).toBeGreaterThan(0);
  });

  it("announced split blocks borrowing, withdrawals in debt and liquidation; repay works; clears after acceptance", () => {
    const client = createBlueClient();
    client.demo.announceSplit("NVDAB", 2);
    const state = client.getState();
    expect(actionLimits(state, "NVDAB").borrow.max).toBe(0);
    expect(actionLimits(state, "NVDAB").withdraw.max).toBe(0);
    expect(positionMetrics(state).valuation.usable).toBe(false);
    client.demo.movePrice("NVDAB", -0.6);
    expect(positionMetrics(client.getState()).healthFactor).toBeNaN(); // Health is paused without a usable price.
    expect(client.demo.runLiquidation().ok).toBe(false);
    expect(client.act("repay", "NVDAB", 10_000).ok).toBe(true);
    client.demo.movePrice("NVDAB", 1.5);
    client.demo.changeMultiplier("NVDAB", 2);
    expect(client.demo.clearStatus("NVDAB").ok).toBe(false);
    expect(client.demo.acceptPrice("NVDAB").ok).toBe(true);
    expect(client.demo.clearStatus("NVDAB").ok).toBe(true);
    expect(actionLimits(client.getState(), "NVDAB").borrow.max).toBeGreaterThan(0);
  });

  it("an unannounced multiplier change stops pricing until the admin accepts a new price", () => {
    const client = createBlueClient();
    client.demo.changeMultiplier("NVDAB", 2);
    const limits = actionLimits(client.getState(), "NVDAB");
    expect(limits.borrow.reason).toMatch(/multiplier/);
    expect(limits.withdraw.max).toBe(0);
    expect(limits.repay.max).toBeGreaterThan(0);
    client.demo.acceptPrice("NVDAB");
    expect(actionLimits(client.getState(), "NVDAB").borrow.max).toBeGreaterThan(0);
  });

  it("a genuine crash lowers health and liquidation proceeds at the live price; borrowing waits for review", () => {
    const client = createBlueClient();
    expect(client.demo.runLiquidation().ok).toBe(false);
    client.demo.movePrice("NVDAB", -0.75);
    const state = client.getState();
    expect(positionMetrics(state).liquidatable).toBe(true);
    expect(actionLimits(state, "NVDAB").borrow.reason).toMatch(/more than 20%/);
    const debt = state.account.debt;
    expect(client.demo.runLiquidation().ok).toBe(true);
    expect(client.getState().account.debt).toBeLessThan(debt);
    expect(client.getState().borrowed).toBeLessThan(state.borrowed);
  });

  it("moves within 20% are accepted automatically; larger moves wait for the admin", () => {
    const client = createBlueClient();
    client.demo.movePrice("TSLAB", -0.1);
    expect(client.getState().stocks.TSLAB.acceptedPrice).toBe(client.getState().stocks.TSLAB.price);
    client.demo.movePrice("TSLAB", 0.3);
    expect(client.getState().stocks.TSLAB.acceptedPrice).not.toBe(client.getState().stocks.TSLAB.price);
    expect(client.demo.acceptPrice("TSLAB").ok).toBe(true);
  });

  it("Earn: supply and withdraw USDT for bluUSDT against shared liquidity", () => {
    const client = createBlueClient();
    const before = client.getState();
    expect(client.act("lend", "NVDAB", 100_000).ok).toBe(true);
    expect(client.getState().account.supplied).toBe(before.account.supplied + 100_000);
    expect(client.getState().supplied).toBe(before.supplied + 100_000);
    expect(poolMetrics(client.getState()).supplyApr).toBeLessThan(poolMetrics(before).supplyApr);
    expect(client.act("redeem", "NVDAB", 150_000).ok).toBe(true);
    expect(client.act("redeem", "NVDAB", 1).ok).toBe(false);
  });

  it("borrowing needs eligibility and a fresh USDT price", () => {
    const client = createBlueClient();
    client.demo.setEligibility(false);
    expect(actionLimits(client.getState(), "NVDAB").borrow.reason).toMatch(/eligibility/);
    client.demo.setEligibility(true);
    client.demo.setUsdtPriceFresh(false);
    expect(actionLimits(client.getState(), "NVDAB").borrow.reason).toMatch(/USDT price/);
    client.demo.setUsdtPriceFresh(true);
    client.demo.stalePrice("NVDAB");
    const limits = actionLimits(client.getState(), "NVDAB");
    expect(limits.borrow.reason).toMatch(/2 hours/);
    expect(limits.withdraw.max).toBeGreaterThan(0);
  });
});
