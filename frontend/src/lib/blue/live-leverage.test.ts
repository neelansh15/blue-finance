import { decodeFunctionData, erc20Abi, maxUint256, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  approvalTotals, batchCalls, LIVE_LEVERAGE, planLive, recoveryStep, swapSize, type LivePlan, type LiveStep, type SwapPrices,
} from "./live-leverage";
import type { LiveState } from "./live-position";
import { BLUE, liveStocks, poolContract } from "./mainnet";
import { routerContract, SWAP } from "./swap";

const WAD = 10n ** 18n;
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const NOW = 1_800_000_000;
const NVDA = liveStocks.findIndex(stock => stock.id === "NVDAB");
/** NVDAB at 150 USD and USDT at 1 USD. */
const PRICE = 150n * 10n ** 8n;
const prices: SwapPrices = { buy: 15_040n * WAD / 100n, sell: 14_960n * WAD / 100n };

type Setup = {
  wallet?: bigint; supplied?: bigint; enabled?: boolean; debt?: bigint; usdt?: bigint; liquidity?: bigint;
  withdrawLtv?: bigint | undefined; eligible?: boolean; cap?: bigint;
};

/** The parts of the live read that planning uses. */
function live(setup: Setup = {}): LiveState {
  const { wallet = 0n, supplied = 0n, enabled = supplied > 0n, debt = 0n, usdt = 0n, liquidity = 10_000n * WAD,
    eligible = true, cap = 1_000_000n * WAD } = setup;
  const withdrawLtv = "withdrawLtv" in setup ? setup.withdrawLtv : 5_000n;
  const reserve = (balance: bigint, owed: bigint, used: boolean) => [balance, 0n, owed, 0n, 0n, 0n, 0n, 0, used];
  return {
    account: ACCOUNT,
    totalBorrowed: debt,
    caps: [0n, 0n],
    liquidity,
    debtStock: debt > 0n ? liveStocks[NVDA].address : zeroAddress,
    usdt: { wallet: usdt, reserve: reserve(0n, debt, false), price: 10n ** 8n, paused: false, sourceReady: true },
    stocks: liveStocks.map((stock, i) => ({
      ...stock,
      price: PRICE, market: 0, limits: [5_000n, cap], wallet: i === NVDA ? wallet : 0n,
      reserve: reserve(i === NVDA ? supplied : 0n, 0n, i === NVDA && enabled), debt: i === NVDA ? debt : 0n,
      eligibleUntil: eligible ? BigInt(NOW + 3_600) : 0n, sourceReady: true, withdrawLtv,
      liquidationThreshold: 6_250n, frozen: false, paused: false, multiplier: WAD,
    })),
  } as unknown as LiveState;
}

const kinds = (plan: LivePlan) => plan.steps.map(step => step.kind);

/** Replays a plan with the pool's rules, at the worst swap price the plan allows. */
function replay(state: LiveState, plan: LivePlan) {
  const stock = state.stocks[NVDA];
  const oracle = PRICE * WAD / 10n ** 8n;
  let wallet = { stock: stock.wallet, usdt: state.usdt.wallet };
  let collateral = stock.reserve[0];
  let debt = state.usdt.reserve[2];
  const value = () => collateral * oracle / WAD;
  for (const step of plan.steps) {
    switch (step.kind) {
      case "supply": wallet.stock -= step.amount; collateral += step.amount; break;
      case "enable": break;
      case "borrow":
        debt += step.amount; wallet.usdt += step.amount;
        expect(debt * 10_000n <= value() * 5_000n).toBe(true);
        break;
      case "buy": wallet.usdt -= step.maxIn; wallet.stock += step.amountOut; break;
      case "withdraw": {
        const amount = step.all ? collateral : step.amount;
        collateral -= amount; wallet.stock += amount;
        if (debt > 0n) expect(debt * 10_000n <= value() * stock.withdrawLtv!).toBe(true);
        break;
      }
      case "sell": wallet.stock -= step.maxIn; wallet.usdt += step.amountOut; break;
      case "repay": {
        const paid = step.all || step.amount > debt ? debt : step.amount;
        wallet.usdt -= paid; debt -= paid; break;
      }
    }
    expect(wallet.stock >= 0n).toBe(true);
    expect(wallet.usdt >= 0n).toBe(true);
  }
  return { collateral, debt, wallet };
}

describe("live leverage planning", () => {
  it("opens a position: supply, enable, then rounds of borrow, buy, supply", () => {
    const state = live({ wallet: 2n * WAD });
    const plan = planLive(state, { stock: "NVDAB", target: 1.5, add: 2n * WAD, batch: true }, prices, NOW);
    expect(plan.blocked).toBeNull();
    expect(plan.reachable).toBe(true);
    expect(kinds(plan).slice(0, 5)).toEqual(["supply", "enable", "borrow", "buy", "supply"]);
    expect(plan.resulting).toBeCloseTo(1.5, 2);
    const end = replay(state, plan);
    expect(end.collateral).toBe(plan.after.collateral);
    expect(end.debt).toBe(plan.after.debt);
  });

  it("caps each swap at the quote plus slippage and borrows exactly that", () => {
    const plan = planLive(live({ supplied: 2n * WAD }), { stock: "NVDAB", target: 1.4, batch: true }, prices, NOW);
    for (let i = 0; i < plan.steps.length; i += 1) {
      const step = plan.steps[i];
      if (step.kind !== "buy") continue;
      expect(plan.steps[i - 1]).toEqual({ kind: "borrow", amount: step.maxIn });
      const worst = step.amountOut * prices.buy / WAD * 10_050n / 10_000n;
      expect(step.maxIn >= worst - 1n && step.maxIn <= worst + 1_000n).toBe(true);
    }
  });

  it("keeps a batch within the wallet's call limit and reaches further step by step", () => {
    const state = live({ wallet: 2n * WAD });
    const request = { stock: "NVDAB" as const, target: 2, add: 2n * WAD };
    const batch = planLive(state, { ...request, batch: true }, prices, NOW);
    const guided = planLive(state, { ...request, batch: false }, prices, NOW);
    expect(batchCalls(batch, state.stocks[NVDA], ACCOUNT, 1n).length).toBeLessThanOrEqual(LIVE_LEVERAGE.maxBatchCalls);
    expect(batch.rounds).toBe(2);
    expect(batch.reachable).toBe(false);
    expect(guided.rounds).toBe(LIVE_LEVERAGE.maxRounds);
    expect(guided.resulting!).toBeGreaterThan(batch.resulting!);
    replay(state, batch);
    replay(state, guided);
  });

  it("limits borrowing to the pool's liquidity and the stock cap", () => {
    const short = planLive(live({ supplied: 2n * WAD, liquidity: 10n * WAD }), { stock: "NVDAB", target: 1.8, batch: true }, prices, NOW);
    expect(short.after.debt).toBeLessThanOrEqual(10n * WAD);
    expect(short.blocked).toBe("The USDT reserve needs liquidity.");
    const capped = planLive(live({ supplied: 2n * WAD, cap: 20n * WAD }), { stock: "NVDAB", target: 1.8, batch: true }, prices, NOW);
    expect(capped.after.debt).toBeLessThanOrEqual(20n * WAD);
    expect(capped.blocked).toMatch(/debt cap/);
  });

  it("refuses to increase without eligibility or when the swap price strays from the oracle", () => {
    const request = { stock: "NVDAB" as const, target: 1.5, batch: true };
    expect(planLive(live({ supplied: WAD, eligible: false }), request, prices, NOW).blocked).toMatch(/eligibility/);
    const dear = { buy: 154n * WAD, sell: prices.sell };
    const plan = planLive(live({ supplied: WAD }), request, dear, NOW);
    expect(plan.blocked).toMatch(/more than 2% above/);
    expect(plan.steps).toHaveLength(0);
  });

  it("reduces by withdrawing, selling and repaying within the withdrawal limit", () => {
    const state = live({ supplied: 4n * WAD, debt: 250n * WAD });
    const plan = planLive(state, { stock: "NVDAB", target: 1.3, batch: true }, prices, NOW);
    expect(plan.blocked).toBeNull();
    expect(kinds(plan).slice(0, 3)).toEqual(["withdraw", "sell", "repay"]);
    expect(plan.resulting).toBeCloseTo(1.3, 1);
    replay(state, plan);
  });

  it("closes the position and returns the collateral", () => {
    const state = live({ supplied: 4n * WAD, debt: 200n * WAD });
    const plan = planLive(state, { stock: "NVDAB", target: 1, withdrawAll: true, batch: true }, prices, NOW);
    expect(plan.reachable).toBe(true);
    expect(plan.calls).toBeLessThanOrEqual(LIVE_LEVERAGE.maxBatchCalls);
    expect(plan.steps.at(-1)).toMatchObject({ kind: "withdraw", all: true });
    const end = replay(state, plan);
    expect(end.debt).toBe(0n);
    expect(end.collateral).toBe(0n);
    // The sale covers a little interest beyond the debt shown now.
    const repay = plan.steps.find(step => step.kind === "repay" && step.all);
    expect(repay && repay.kind === "repay" && repay.amount > 0n).toBe(true);
  });

  it("repays from the wallet first when no collateral can be withdrawn", () => {
    const state = live({ supplied: 2n * WAD, debt: 150n * WAD, usdt: 40n * WAD });
    const plan = planLive(state, { stock: "NVDAB", target: 1, batch: true }, prices, NOW);
    expect(plan.steps[0]).toMatchObject({ kind: "repay", fromWallet: true, amount: 40n * WAD });
    expect(plan.reachable).toBe(true);
    expect(replay(state, plan).debt).toBe(0n);
  });

  it("explains a blocked withdrawal during a halt", () => {
    const plan = planLive(live({ supplied: 2n * WAD, debt: 100n * WAD, withdrawLtv: undefined }),
      { stock: "NVDAB", target: 1, batch: true }, prices, NOW);
    expect(plan.steps).toHaveLength(0);
    expect(plan.blocked).toMatch(/halt/);
  });

  it("offers the matching tidy-up after a stopped step-by-step run", () => {
    const steps: LiveStep[] = [
      { kind: "borrow", amount: 5n }, { kind: "buy", amountOut: 3n, maxIn: 5n }, { kind: "supply", amount: 3n },
      { kind: "withdraw", amount: 2n }, { kind: "sell", amountOut: 4n, maxIn: 2n }, { kind: "repay", amount: 4n },
    ];
    expect(recoveryStep(steps, 0)).toBeNull();
    expect(recoveryStep(steps, 1)).toEqual({ kind: "repay", amount: 5n });
    expect(recoveryStep(steps, 2)).toEqual({ kind: "supply", amount: 3n });
    expect(recoveryStep(steps, 3)).toBeNull();
    expect(recoveryStep(steps, 4)).toEqual({ kind: "supply", amount: 2n });
    expect(recoveryStep(steps, 5)).toEqual({ kind: "repay", amount: 4n });
    expect(recoveryStep(steps, 6)).toBeNull();
  });

  it("sizes the quote from the planned swaps", () => {
    const plan = planLive(live({ supplied: 2n * WAD }), { stock: "NVDAB", target: 1.4, batch: true }, prices, NOW);
    const bought = plan.steps.reduce((sum, step) => sum + (step.kind === "buy" ? step.amountOut : 0n), 0n);
    expect(swapSize(plan)).toEqual({ side: "buy", amount: bought });
  });

  it("encodes the batch: approvals first, then pool and router calls", () => {
    const state = live({ wallet: WAD });
    const stock = state.stocks[NVDA];
    const plan = planLive(state, { stock: "NVDAB", target: 1.4, add: WAD, batch: true }, prices, NOW);
    const calls = batchCalls(plan, stock, ACCOUNT, 1234n);
    const totals = approvalTotals(plan.steps, stock.address);
    expect(totals.map(item => item.spender)).toEqual([BLUE.pool, SWAP.router]);
    expect(calls.slice(0, 2).map(call => decodeFunctionData({ abi: erc20Abi, data: call.data }).args))
      .toEqual(totals.map(item => [item.spender, item.amount]));
    const swap = calls.find(call => call.to === SWAP.router)!;
    const [params] = decodeFunctionData({ abi: routerContract.abi, data: swap.data }).args;
    expect(params).toMatchObject({ tokenIn: BLUE.usdt, tokenOut: stock.address, fee: 2500, recipient: ACCOUNT, deadline: 1234n });
    // A sufficient allowance drops its approval.
    const allowed = new Map([[`${stock.address}:${BLUE.pool}`, maxUint256]]);
    expect(batchCalls(plan, stock, ACCOUNT, 1234n, allowed)).toHaveLength(calls.length - 1);
    const borrow = calls.find(call => call.label === "Borrow USDT")!;
    expect(decodeFunctionData({ abi: poolContract.abi, data: borrow.data }).functionName).toBe("borrow");
  });
});
