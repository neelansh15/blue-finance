// Leveraged borrowing on the simulated pool (architecture-v3.md, section 6).
//
// A leveraged long borrows USDT, swaps it for more of the same stock and supplies that stock as collateral.
// Every borrow is an ordinary pool borrow, so it must fit the borrow limit at that point in the sequence.
// Several rounds reach higher leverage. Reducing withdraws collateral within the limit, sells it and repays.
// Amounts follow pool.ts: USDT in cents, stock in token units, prices in cents per token.

import {
  TOKENS_PER_UNIT, actionLimits, executeAction, positionMetrics, valuationCheck,
  type ActionResult, type PoolState, type StockId,
} from "./pool";

export const LEVERAGE = {
  /** Product-wide cap shown on the card. */
  cap: 2,
  /** Borrow-swap-supply rounds an ordinary batch may contain. */
  maxRounds: 5,
  /** DEX fee on each swap. */
  swapFee: 0.003,
  /** Default slippage bound: the swap reverts below this share of the quote. */
  slippage: 0.005,
  /** A quote older than this is refreshed before one-click execution. */
  quoteSeconds: 30,
  /** Leftover below 1 USDT counts as done. */
  dust: 100,
} as const;

export type LeverageStep =
  | { kind: "deposit"; tokens: number }
  | { kind: "borrow"; cents: number }
  | { kind: "buy"; cents: number; expectedTokens: number; minTokens: number }
  | { kind: "withdraw"; tokens: number }
  | { kind: "sell"; tokens: number; expectedCents: number; minCents: number }
  | { kind: "repay"; cents: number; fromWallet?: boolean };

export type Direction = "increase" | "reduce" | "close" | "none";

export type LeveragePlan = {
  stock: StockId;
  direction: Direction;
  target: number;
  current: number | null;
  steps: LeverageStep[];
  rounds: number;
  /** False when limits stop the plan short of the target. */
  reachable: boolean;
  blocked: string | null;
  quotePrice: number;
  quotedAt: number;
  /** Expected state once every step runs at the quoted price. */
  after: PoolState;
};

/** Collateral value over equity. 1 with no debt, null without collateral, Infinity when equity is gone. */
export function currentLeverage(state: PoolState): number | null {
  const { value } = positionMetrics(state);
  const debt = state.account.debt;
  if (!state.account.stock || value <= 0) return null;
  if (debt === 0) return 1;
  return value > debt ? value / (value - debt) : Number.POSITIVE_INFINITY;
}

const expectedBuy = (cents: number, price: number) => Math.floor(cents * (1 - LEVERAGE.swapFee) * TOKENS_PER_UNIT / price);
const expectedSell = (tokens: number, price: number) => Math.floor(tokens * price / TOKENS_PER_UNIT * (1 - LEVERAGE.swapFee));

/** Runs one step against the live state. `failSwap` simulates a reverted swap. */
export function executeStep(state: PoolState, stock: StockId, step: LeverageStep, failSwap = false): ActionResult {
  const account = state.account;
  const price = state.stocks[stock].price;
  switch (step.kind) {
    case "deposit":
      return executeAction(state, "deposit", stock, Math.min(step.tokens, account.wallet[stock]));
    case "borrow":
      return executeAction(state, "borrow", stock, step.cents);
    case "withdraw":
      return executeAction(state, "withdraw", stock, step.tokens);
    case "repay": {
      const cents = Math.min(step.cents, account.usdt, account.debt);
      if (cents <= 0) return { ok: false, message: "Nothing to repay.", state };
      return executeAction(state, "repay", stock, cents);
    }
    case "buy": {
      if (account.usdt < step.cents) return { ok: false, message: "Not enough USDT for the swap.", state };
      const out = expectedBuy(step.cents, price);
      if (failSwap || out < step.minTokens) {
        return { ok: false, message: failSwap ? "The swap reverted (simulated failure)." : "The swap reverted: the price moved beyond the slippage bound.", state };
      }
      return {
        ok: true,
        message: `Simulated: swapped ${(step.cents / 100).toFixed(2)} USDT for ${(out / TOKENS_PER_UNIT).toFixed(4)} ${stock}.`,
        state: { ...state, account: { ...account, usdt: account.usdt - step.cents, wallet: { ...account.wallet, [stock]: account.wallet[stock] + out } } },
      };
    }
    case "sell": {
      if (account.wallet[stock] < step.tokens) return { ok: false, message: `Not enough ${stock} for the swap.`, state };
      const out = expectedSell(step.tokens, price);
      if (failSwap || out < step.minCents) {
        return { ok: false, message: failSwap ? "The swap reverted (simulated failure)." : "The swap reverted: the price moved beyond the slippage bound.", state };
      }
      return {
        ok: true,
        message: `Simulated: swapped ${(step.tokens / TOKENS_PER_UNIT).toFixed(4)} ${stock} for ${(out / 100).toFixed(2)} USDT.`,
        state: { ...state, account: { ...account, usdt: account.usdt + out, wallet: { ...account.wallet, [stock]: account.wallet[stock] - step.tokens } } },
      };
    }
  }
}

function buyStep(cents: number, price: number): LeverageStep {
  const expectedTokens = expectedBuy(cents, price);
  return { kind: "buy", cents, expectedTokens, minTokens: Math.floor(expectedTokens * (1 - LEVERAGE.slippage)) };
}

function sellStep(tokens: number, price: number): LeverageStep {
  const expectedCents = expectedSell(tokens, price);
  return { kind: "sell", tokens, expectedCents, minCents: Math.floor(expectedCents * (1 - LEVERAGE.slippage)) };
}

/** Appends a step after running it on the scratch state. Returns the failure reason, if any. */
function push(plan: { steps: LeverageStep[]; state: PoolState }, stock: StockId, step: LeverageStep): string | null {
  const result = executeStep(plan.state, stock, step);
  if (!result.ok) return result.message;
  plan.steps.push(step);
  plan.state = result.state;
  return null;
}

/** Highest leverage the rounds can reach for this stock now, capped by the product cap. */
export function maxLeverage(state: PoolState, stock: StockId, addTokens = 0): number {
  const plan = planLeverage(state, stock, LEVERAGE.cap, addTokens);
  const reached = currentLeverage(plan.after) ?? 1;
  return Math.min(LEVERAGE.cap, Math.max(1, Math.floor(reached * 100) / 100));
}

/**
 * Plans the steps to move the position on `stock` to `target` leverage, optionally adding wallet collateral
 * first. Target 1 repays all debt; `withdrawAll` then also withdraws the collateral (close).
 */
export function planLeverage(
  state: PoolState, stock: StockId, target: number, addTokens = 0, withdrawAll = false, quotedAt = Date.now(),
): LeveragePlan {
  const price = state.stocks[stock].price;
  const base = { stock, target, current: currentLeverage(state), quotePrice: price, quotedAt };
  const done = (direction: Direction, plan: { steps: LeverageStep[]; state: PoolState }, reachable: boolean,
    blocked: string | null, rounds: number): LeveragePlan =>
    ({ ...base, direction, steps: plan.steps, after: plan.state, reachable, blocked, rounds });
  const scratch = { steps: [] as LeverageStep[], state };

  if (state.account.stock && state.account.stock !== stock) {
    return done("none", scratch, false, `Your account uses ${state.account.stock} as collateral. One stock per account.`, 0);
  }
  const valuation = valuationCheck(state, stock);
  if (!valuation.usable) return done("none", scratch, false, `No usable ${stock} price: ${valuation.reason}.`, 0);

  if (addTokens > 0) {
    const reason = push(scratch, stock, { kind: "deposit", tokens: addTokens });
    if (reason) return done("none", scratch, false, reason, 0);
  }
  const start = currentLeverage(scratch.state);
  if (start === null) return done("none", scratch, false, `Add ${stock} collateral to open a position.`, 0);

  const value = positionMetrics(scratch.state).value;
  const debt = scratch.state.account.debt;
  const fee = LEVERAGE.swapFee;

  if (target > start + 0.005) {
    // Borrow B so that (value + B(1 - fee)) / (value + B(1 - fee) - debt - B) = target.
    let remaining = Math.ceil(((target - 1) * value - target * debt) / (1 + fee * (target - 1)));
    let rounds = 0;
    let blocked: string | null = null;
    while (remaining >= LEVERAGE.dust && rounds < LEVERAGE.maxRounds) {
      const room = actionLimits(scratch.state, stock).borrow;
      const cents = Math.min(remaining, room.max);
      if (cents < LEVERAGE.dust) { blocked = room.reason ?? "No borrowing room left at this market status."; break; }
      const reason = push(scratch, stock, { kind: "borrow", cents })
        ?? push(scratch, stock, buyStep(cents, price));
      if (reason) { blocked = reason; break; }
      const bought = (scratch.steps.at(-1) as Extract<LeverageStep, { kind: "buy" }>).expectedTokens;
      const supplied = push(scratch, stock, { kind: "deposit", tokens: bought });
      if (supplied) { blocked = supplied; break; }
      remaining -= cents;
      rounds += 1;
    }
    return done("increase", scratch, remaining < LEVERAGE.dust, blocked, rounds);
  }

  if (target < start - 0.005 || (withdrawAll && target <= 1)) {
    const closing = target <= 1;
    // Sell s (in cents of collateral) so that (value - s) / (value - s - debt + s(1 - fee)) = target.
    let remaining = closing ? debt : Math.max(0, Math.ceil((target * debt - (target - 1) * value) / (1 - fee * target)));
    let rounds = 0;
    let blocked: string | null = null;
    let usedWallet = false;
    while (scratch.state.account.debt > 0 && remaining >= LEVERAGE.dust && rounds < LEVERAGE.maxRounds) {
      const room = actionLimits(scratch.state, stock).withdraw;
      const need = closing
        ? Math.ceil(scratch.state.account.debt / (1 - fee) * TOKENS_PER_UNIT / price) + 1
        : Math.ceil(remaining * TOKENS_PER_UNIT / price);
      const tokens = Math.min(need, room.max);
      if (tokens <= 0) {
        // No withdrawal room: repay from the wallet first if it holds USDT, as Zona's planner does.
        const wallet = scratch.state.account.usdt;
        if (!usedWallet && wallet > 0) {
          usedWallet = true;
          const cents = Math.min(wallet, scratch.state.account.debt);
          const reason = push(scratch, stock, { kind: "repay", cents, fromWallet: true });
          if (reason) { blocked = reason; break; }
          remaining -= closing ? 0 : Math.ceil(cents / (1 - fee));
          continue;
        }
        blocked = room.reason ?? "No collateral can be withdrawn within the borrow limit. Repay from your wallet to continue.";
        break;
      }
      const sale = sellStep(tokens, price) as Extract<LeverageStep, { kind: "sell" }>;
      const reason = push(scratch, stock, { kind: "withdraw", tokens })
        ?? push(scratch, stock, sale)
        ?? push(scratch, stock, { kind: "repay", cents: Math.min(sale.expectedCents, scratch.state.account.debt) });
      if (reason) { blocked = reason; break; }
      remaining -= closing ? sale.expectedCents : Math.floor(tokens * price / TOKENS_PER_UNIT);
      rounds += 1;
    }
    if (closing && withdrawAll && scratch.state.account.debt === 0 && scratch.state.account.collateral > 0) {
      const reason = push(scratch, stock, { kind: "withdraw", tokens: scratch.state.account.collateral });
      if (reason) blocked = reason;
    }
    const reachable = closing ? scratch.state.account.debt === 0 : remaining < LEVERAGE.dust;
    return done(closing ? "close" : "reduce", scratch, reachable && !blocked, blocked, rounds);
  }

  return done("none", scratch, true, null, 0);
}

/** One-click execution: every step runs, or the position is left unchanged. */
export function executeAtomically(state: PoolState, plan: LeveragePlan, failSwap = false):
  { ok: boolean; message: string; state: PoolState } {
  let next = state;
  for (const [index, step] of plan.steps.entries()) {
    const result = executeStep(next, plan.stock, step, failSwap && (step.kind === "buy" || step.kind === "sell"));
    if (!result.ok) {
      return { ok: false, message: `Step ${index + 1} failed, so the whole batch reverted and your position is unchanged. ${result.message}`, state };
    }
    next = result.state;
  }
  return { ok: true, message: "Simulated batch executed.", state: next };
}

export function describeStep(step: LeverageStep, stock: StockId): string {
  const usd = (cents: number) => `${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
  const qty = (tokens: number) => `${(tokens / TOKENS_PER_UNIT).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${stock}`;
  switch (step.kind) {
    case "deposit": return `Supply ${qty(step.tokens)} as collateral`;
    case "borrow": return `Borrow ${usd(step.cents)}`;
    case "buy": return `Swap ${usd(step.cents)} for about ${qty(step.expectedTokens)} (at least ${qty(step.minTokens)})`;
    case "withdraw": return `Withdraw ${qty(step.tokens)}`;
    case "sell": return `Swap ${qty(step.tokens)} for about ${usd(step.expectedCents)} (at least ${usd(step.minCents)})`;
    case "repay": return step.fromWallet ? `Repay ${usd(step.cents)} from your wallet` : `Repay up to ${usd(step.cents)}`;
  }
}
