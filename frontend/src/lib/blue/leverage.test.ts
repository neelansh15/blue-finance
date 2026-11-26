import { describe, expect, it } from "vitest";
import { createBlueClient } from "./client";
import {
  LEVERAGE, currentLeverage, executeAtomically, executeStep, maxLeverage, planLeverage,
} from "./leverage";
import { actionLimits, initialPoolState, positionMetrics, type PoolState } from "./pool";

/** NVDAB at $100: $1,000 of collateral and no debt, during regular hours. */
function fresh(schedule: PoolState["schedule"] = "OPEN"): PoolState {
  const state = initialPoolState();
  return {
    ...state,
    schedule,
    scheduleSource: "demo",
    stocks: { ...state.stocks, NVDAB: { ...state.stocks.NVDAB, price: 10_000, acceptedPrice: 10_000 } },
    account: { ...state.account, stock: "NVDAB", collateral: 100_000, debt: 0, usdt: 0 },
  };
}

describe("leveraged borrowing", () => {
  it("reaches the target with fees, keeping every borrow within the limit at that point", () => {
    const state = fresh();
    const plan = planLeverage(state, "NVDAB", 1.5);
    expect(plan.direction).toBe("increase");
    expect(plan.reachable).toBe(true);
    expect(plan.blocked).toBeNull();
    expect(currentLeverage(plan.after)).toBeCloseTo(1.5, 2);
    // Replaying step by step never exceeds the borrow limit.
    let s = state;
    for (const step of plan.steps) {
      if (step.kind === "borrow") expect(step.cents).toBeLessThanOrEqual(actionLimits(s, "NVDAB").borrow.max);
      const result = executeStep(s, "NVDAB", step);
      expect(result.ok).toBe(true);
      s = result.state;
    }
    expect(positionMetrics(s).healthFactor).toBeGreaterThan(1.8);
  });

  it("caps leverage by the borrow LTV for the market status and the number of rounds", () => {
    const open = maxLeverage(fresh("OPEN"), "NVDAB");
    const weekend = maxLeverage(fresh("WEEKEND"), "NVDAB");
    expect(open).toBeGreaterThan(1.9);
    expect(open).toBeLessThanOrEqual(LEVERAGE.cap);
    expect(weekend).toBeGreaterThan(1.65);
    expect(weekend).toBeLessThan(1.74); // 1 / (1 - 42.5%) = 1.739
    const plan = planLeverage(fresh("WEEKEND"), "NVDAB", 1.9);
    expect(plan.reachable).toBe(false);
    expect(plan.rounds).toBe(LEVERAGE.maxRounds);
  });

  it("is blocked for a halted stock and for a second stock", () => {
    const client = createBlueClient(fresh());
    client.demo.halt("NVDAB");
    const halted = planLeverage(client.getState(), "NVDAB", 1.5);
    expect(halted.reachable).toBe(false);
    expect(halted.blocked).toMatch(/halt/i);
    expect(planLeverage(fresh(), "TSLAB", 1.5).blocked).toMatch(/One stock per account/);
  });

  it("reduces and closes by withdrawing, selling and repaying", () => {
    const levered = planLeverage(fresh(), "NVDAB", 1.8).after;
    const reduce = planLeverage(levered, "NVDAB", 1.3);
    expect(reduce.direction).toBe("reduce");
    expect(reduce.reachable).toBe(true);
    expect(currentLeverage(reduce.after)).toBeCloseTo(1.3, 1);
    const close = planLeverage(levered, "NVDAB", 1, 0, true);
    expect(close.direction).toBe("close");
    expect(close.after.account.debt).toBe(0);
    expect(close.after.account.collateral).toBe(0);
    expect(close.after.account.stock).toBeNull();
  });

  it("repays from the wallet first when no collateral can be withdrawn", () => {
    // $1,000 of collateral and $500 of debt sits exactly at the 50% borrow limit.
    const state = fresh();
    const atLimit = { ...state, account: { ...state.account, debt: 50_000, usdt: 10_000 } };
    expect(actionLimits(atLimit, "NVDAB").withdraw.max).toBe(0);
    const plan = planLeverage(atLimit, "NVDAB", 1.2);
    expect(plan.steps[0]).toMatchObject({ kind: "repay", fromWallet: true });
    expect(plan.reachable).toBe(true);
  });

  it("one-click leaves the position unchanged when a swap fails", () => {
    const state = fresh();
    const plan = planLeverage(state, "NVDAB", 1.5);
    const result = executeAtomically(state, plan, true);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(executeAtomically(state, plan).ok).toBe(true);
  });

  it("guided steps keep the borrow when a later swap fails, and the USDT can repay it", () => {
    const state = fresh();
    const plan = planLeverage(state, "NVDAB", 1.5);
    const borrowed = executeStep(state, "NVDAB", plan.steps[0]);
    expect(borrowed.ok).toBe(true);
    const swap = executeStep(borrowed.state, "NVDAB", plan.steps[1], true);
    expect(swap.ok).toBe(false);
    expect(swap.state.account.debt).toBeGreaterThan(0);
    const repaid = executeStep(swap.state, "NVDAB", { kind: "repay", cents: swap.state.account.debt });
    expect(repaid.ok).toBe(true);
    expect(repaid.state.account.debt).toBe(0);
  });

  it("reverts a swap when the price moves beyond the slippage bound", () => {
    const state = fresh();
    const plan = planLeverage(state, "NVDAB", 1.5);
    const borrowed = executeStep(state, "NVDAB", plan.steps[0]).state;
    const moved = { ...borrowed, stocks: { ...borrowed.stocks, NVDAB: { ...borrowed.stocks.NVDAB, price: 10_200 } } };
    const swap = executeStep(moved, "NVDAB", plan.steps[1]);
    expect(swap.ok).toBe(false);
    expect(swap.message).toMatch(/slippage/);
  });
});
