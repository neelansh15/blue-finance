// Leveraged borrowing on the deployed pool (architecture-v3.md, section 6). Pure planning and call encoding.
//
// A leveraged long borrows USDT, buys more of the same stock and supplies it as collateral. Reducing withdraws
// collateral, sells it and repays. Every borrow and withdrawal is an ordinary pool call, so each one must fit
// the limit at that point in the sequence. Swaps are exact-output: the amount received is fixed when the plan
// is built, and the amount spent is capped at the quote plus slippage. What the swap does not spend stays in
// the wallet.
//
// All token amounts are 18-decimal bigint. Prices here are USDT per stock token (1e18).

import { encodeFunctionData, erc20Abi, maxUint256, type Address, type Hex } from "viem";
import { LEVERAGE } from "./leverage";
import {
  blockingStock, borrowGate, borrowLtv, isEligible, liveStock, position, stockCap, usdtDebt,
  type LiveState, type LiveStock, type Position,
} from "./live-position";
import { BLUE, poolContract } from "./mainnet";
import type { StockId } from "./pool";
import { routerContract, SWAP } from "./swap";

export const LIVE_LEVERAGE = {
  cap: LEVERAGE.cap,
  /** Swaps revert if they need more than the quote plus this. */
  slippageBps: BigInt(Math.round(LEVERAGE.slippage * 10_000)),
  /** A swap price further than this from the pool's oracle price is refused. */
  maxDeviationBps: 200n,
  /** Rounds for step-by-step execution. */
  maxRounds: LEVERAGE.maxRounds,
  /** MetaMask rejects a batch with more calls than this by default. */
  maxBatchCalls: 10,
  quoteSeconds: LEVERAGE.quoteSeconds,
  /** Seconds a signed swap stays valid. */
  deadlineSeconds: 180,
} as const;

const WAD = 10n ** 18n;
const BPS = 10_000n;
/** Share of a borrow or withdrawal limit that a plan uses, leaving room for price movement and interest. */
const HEADROOM = 9_950n;
/** Amounts under 0.1 USDT are not worth another round. */
const DUST = WAD / 10n;

const min = (...values: bigint[]) => values.reduce((a, b) => (b < a ? b : a));
const positive = (value: bigint) => (value > 0n ? value : 0n);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export type LiveStep =
  | { kind: "supply"; amount: bigint }
  | { kind: "enable" }
  | { kind: "borrow"; amount: bigint }
  | { kind: "buy"; amountOut: bigint; maxIn: bigint }
  | { kind: "withdraw"; amount: bigint; all?: boolean }
  | { kind: "sell"; amountOut: bigint; maxIn: bigint }
  /** `all` repays the whole debt; `amount` is then the allowance that covers it. */
  | { kind: "repay"; amount: bigint; all?: boolean; fromWallet?: boolean };

export type Direction = "increase" | "reduce" | "close" | "none";

/** USDT per stock token (1e18) from the swap pool. */
export type SwapPrices = { buy: bigint; sell: bigint };

export type LiveRequest = {
  stock: StockId;
  target: number;
  /** Stock to add from the wallet first. */
  add?: bigint;
  /** With a target of 1, also withdraw all collateral after repaying. */
  withdrawAll?: boolean;
  /** One batch has a call limit; step-by-step execution does not. */
  batch: boolean;
};

export type LivePlan = {
  stock: StockId;
  direction: Direction;
  steps: LiveStep[];
  rounds: number;
  /** False when limits stop the plan short of the target. */
  reachable: boolean;
  blocked: string | null;
  /** Wallet transactions, or calls in the batch, including approvals. */
  calls: number;
  current: number | null;
  resulting: number | null;
  after: Position;
};

/** The oracle price of the stock in USDT (1e18), or undefined when either price is unusable. */
export function oraclePrice(state: LiveState, stock: LiveStock): bigint | undefined {
  return stock.price && state.usdt.price ? stock.price * WAD / state.usdt.price : undefined;
}

/** Collateral value over equity. 1 with no debt, null without collateral, Infinity when equity is gone. */
export function leverageOf(value: bigint | undefined, debt: bigint | undefined): number | null {
  if (value === undefined || debt === undefined || value === 0n) return null;
  if (debt === 0n) return 1;
  return value > debt ? Number(value * 1_000_000n / (value - debt)) / 1_000_000 : Number.POSITIVE_INFINITY;
}

export function currentLeverage(state: LiveState, id: StockId): number | null {
  const held = position(state, liveStock(state, id));
  return leverageOf(held.collateralValue, held.debtValue);
}

/** Approvals the plan needs: one per token and spender, for the total spent. */
export function approvalTotals(steps: LiveStep[], stock: Address) {
  const totals = new Map<string, { token: Address; spender: Address; amount: bigint }>();
  const add = (token: Address, spender: Address, amount: bigint) => {
    const key = `${token}:${spender}`;
    const entry = totals.get(key) ?? { token, spender, amount: 0n };
    totals.set(key, { ...entry, amount: entry.amount + amount });
  };
  for (const step of steps) {
    if (step.kind === "supply") add(stock, BLUE.pool, step.amount);
    if (step.kind === "buy") add(BLUE.usdt, SWAP.router, step.maxIn);
    if (step.kind === "sell") add(stock, SWAP.router, step.maxIn);
    if (step.kind === "repay") add(BLUE.usdt, BLUE.pool, step.amount);
  }
  return [...totals.values()];
}

const callCount = (steps: LiveStep[], stock: Address) => steps.length + approvalTotals(steps, stock).length;

/**
 * Plans the steps to move the position on a stock to `target` leverage at the given swap prices.
 * A target of 1 repays all debt.
 */
export function planLive(state: LiveState, request: LiveRequest, prices: SwapPrices, now = Math.floor(Date.now() / 1000)): LivePlan {
  const { stock: id, withdrawAll = false, batch } = request;
  const stock = liveStock(state, id);
  const add = request.add ?? 0n;
  const target = BigInt(Math.round(Math.min(Math.max(request.target, 1), LIVE_LEVERAGE.cap) * 10_000));
  const start = position(state, stock);
  const current = leverageOf(start.collateralValue, start.debtValue);
  const steps: LiveStep[] = [];

  // The running position, in stock tokens and USDT debt tokens.
  let collateral = (stock.reserve[8] ? stock.reserve[0] : 0n);
  let debt = start.debt;
  let wallet = state.usdt.wallet;
  let enabled = stock.reserve[8];

  const finish = (direction: Direction, rounds: number, reachable: boolean, blocked: string | null): LivePlan => {
    const after = position(state, stock, {
      collateral: collateral - (enabled ? stock.reserve[0] : 0n),
      debt: debt - usdtDebt(state),
      enable: enabled,
    });
    return {
      stock: id, direction, steps, rounds, reachable, blocked, current, after,
      calls: callCount(steps, stock.address),
      resulting: leverageOf(after.collateralValue, after.debtValue),
    };
  };
  const refuse = (reason: string) => finish("none", 0, false, reason);
  /** Whether the steps for one more round still fit the batch. */
  const fits = (more: LiveStep[]) => !batch || callCount([...steps, ...more], stock.address) <= LIVE_LEVERAGE.maxBatchCalls;

  if (!state.account) return refuse("Connect your wallet to plan a position.");
  const other = blockingStock(state, stock);
  if (other) return refuse(`Your account uses ${other.id} as collateral. One stock per account.`);
  const oracle = oraclePrice(state, stock);
  if (!oracle) return refuse(`No usable ${id} price.`);
  if (add > stock.wallet) return refuse(`Your wallet does not hold that much ${id}.`);

  // Supplying (and enabling) comes first, so the collateral backs every later limit.
  const held = stock.reserve[0];
  if (add > 0n) {
    if (stock.paused || stock.frozen) return refuse(`The ${id} reserve is not accepting supply.`);
    steps.push({ kind: "supply", amount: add });
    collateral = held + add;
  }
  const needsEnable = !stock.reserve[8] && held + add > 0n;
  if (needsEnable && (add > 0n || request.target > 1)) {
    steps.push({ kind: "enable" });
    enabled = true;
    collateral = held + add;
  }
  if (collateral === 0n) return refuse(`Add ${id} collateral to open a position.`);

  const value = () => collateral * oracle / WAD;
  const startValue = value();
  const startLeverage = leverageOf(startValue, debt)!;
  const wanted = Number(target) / 10_000;
  const slip = BPS + LIVE_LEVERAGE.slippageBps;

  if (wanted > startLeverage + 0.005) {
    const gate = borrowGate(state, stock) ?? (isEligible(stock, now) ? undefined : `This wallet needs eligibility for ${id}.`);
    if (gate) return finish("increase", 0, false, gate);
    if (prices.buy * BPS > oracle * (BPS + LIVE_LEVERAGE.maxDeviationBps)) {
      return finish("increase", 0, false, `The swap price for ${id} is more than 2% above the oracle price.`);
    }
    const cost = ceilDiv(prices.buy * slip, BPS);
    /** Collateral value gained per USDT borrowed (1e18). */
    const gain = oracle * WAD / cost;
    // (value + gain·X) / (value + gain·X - debt - X) = target
    const denominator = target * WAD - (target - BPS) * gain;
    let remaining = positive((target - BPS) * startValue - target * debt) * WAD / denominator;
    let liquidity = state.liquidity;
    let capRoom = positive(stockCap(stock).cap - (stock.debt ?? 0n));
    let reserveRoom = state.caps[0] === 0n ? maxUint256 : positive(state.caps[0] * WAD - state.totalBorrowed);
    let rounds = 0;
    let blocked: string | null = null;
    while (remaining >= DUST && rounds < LIVE_LEVERAGE.maxRounds) {
      const ltvRoom = positive(value() * borrowLtv(stock) / BPS - debt) * HEADROOM / BPS;
      const amount = min(remaining, ltvRoom, liquidity * HEADROOM / BPS, capRoom * HEADROOM / BPS, reserveRoom * HEADROOM / BPS);
      if (amount < DUST) {
        const full = (room: bigint) => room * HEADROOM / BPS < DUST;
        blocked = full(liquidity) ? "The USDT reserve needs liquidity."
          : full(capRoom) ? `The ${id} debt cap is full.`
          : full(reserveRoom) ? "The USDT borrow cap is full."
          : "No borrowing room left at this market status.";
        break;
      }
      const amountOut = amount * WAD / cost;
      const round: LiveStep[] = [
        { kind: "borrow", amount },
        { kind: "buy", amountOut, maxIn: amount },
        { kind: "supply", amount: amountOut },
      ];
      if (!fits(round)) break;
      steps.push(...round);
      collateral += amountOut;
      debt += amount;
      liquidity -= amount;
      capRoom -= amount;
      reserveRoom -= amount;
      remaining -= amount;
      rounds += 1;
    }
    return finish("increase", rounds, remaining < DUST, blocked);
  }

  const closing = target === BPS;
  if (wanted < startLeverage - 0.005 || (closing && (debt > 0n || withdrawAll))) {
    if (state.usdt.paused || stock.paused) return finish("reduce", 0, false, "The reserve is paused.");
    const direction: Direction = closing ? "close" : "reduce";
    const withdrawLtv = stock.withdrawLtv;
    if (debt > 0n && (prices.sell * BPS < oracle * (BPS - LIVE_LEVERAGE.maxDeviationBps))) {
      return finish(direction, 0, false, `The swap price for ${id} is more than 2% below the oracle price.`);
    }
    /** Collateral value given up per USDT repaid (1e18). */
    const loss = oracle * slip * WAD / (prices.sell * BPS);
    // (value - loss·X) / (value - loss·X - debt + X) = target
    const denominator = target * WAD + BPS * loss - target * loss;
    let remaining = closing ? debt
      : positive(BPS * startValue - target * startValue + target * debt) * WAD / denominator;
    let rounds = 0;
    let blocked: string | null = null;
    let usedWallet = false;
    /** USDT that repays the whole debt even after interest accrues for a while. */
    const payoff = () => debt + debt / 1_000n + 1n;
    while (debt > 0n && remaining >= (closing ? 1n : DUST) && rounds < LIVE_LEVERAGE.maxRounds) {
      const floor = withdrawLtv ? ceilDiv(debt * BPS, withdrawLtv) : undefined;
      const room = floor === undefined ? 0n : positive(value() - floor) * HEADROOM / BPS;
      const need = closing ? payoff() : min(remaining, debt);
      const needIn = ceilDiv(need * WAD * slip, prices.sell * BPS);
      const roomIn = min(room * WAD / oracle, collateral);
      const maxIn = min(needIn, roomIn);
      const amountOut = maxIn === needIn ? need : maxIn * prices.sell * BPS / (WAD * slip);
      if (amountOut < DUST && amountOut < need) {
        // No withdrawal room: repay from the wallet first if it holds USDT, as Zona's planner does.
        if (!usedWallet && wallet > 0n) {
          usedWallet = true;
          const all = wallet >= payoff() && (closing || remaining >= debt);
          const amount = all ? payoff() : min(wallet, debt);
          const step: LiveStep = { kind: "repay", amount, all, fromWallet: true };
          if (!fits([step])) break;
          steps.push(step);
          const paid = all ? debt : amount;
          wallet -= paid;
          remaining -= closing ? paid : min(remaining, paid);
          debt -= paid;
          continue;
        }
        blocked = withdrawLtv === undefined
          ? "A halt, corporate action or guardian hold blocks withdrawals while you have debt. Repay from your wallet."
          : "No collateral can be withdrawn within the borrow limit. Repay from your wallet to continue.";
        break;
      }
      const all = amountOut >= (closing ? payoff() : debt);
      const round: LiveStep[] = [
        { kind: "withdraw", amount: maxIn },
        { kind: "sell", amountOut, maxIn },
        { kind: "repay", amount: all ? payoff() : amountOut, all },
      ];
      // A full repayment needs the sale to cover the interest buffer.
      if (all && amountOut < payoff()) round[2] = { kind: "repay", amount: debt, all: false };
      if (!fits(round)) break;
      steps.push(...round);
      const paid = all ? debt : min(amountOut, debt);
      collateral -= maxIn;
      debt -= paid;
      wallet += amountOut - paid;
      remaining -= closing ? paid : min(remaining, paid);
      rounds += 1;
    }
    let complete = closing ? debt === 0n : remaining < DUST;
    if (closing && withdrawAll && debt === 0n && collateral > 0n) {
      const step: LiveStep = { kind: "withdraw", amount: collateral, all: true };
      if (fits([step])) {
        steps.push(step);
        collateral = 0n;
      } else complete = false;
    }
    return finish(direction, rounds, complete && !blocked, blocked);
  }

  return finish("none", 0, true, null);
}

/**
 * The step that tidies up after a step-by-step run stops: repay USDT left in the wallet by a borrow or sale,
 * or supply stock left there by a swap or withdrawal. `done` counts the confirmed steps.
 */
export function recoveryStep(steps: LiveStep[], done: number): LiveStep | null {
  const last = steps[done - 1];
  if (!last || done >= steps.length) return null;
  switch (last.kind) {
    case "borrow": return { kind: "repay", amount: last.amount };
    case "sell": return { kind: "repay", amount: last.amountOut };
    case "buy": return { kind: "supply", amount: last.amountOut };
    case "withdraw": return { kind: "supply", amount: last.amount };
    default: return null;
  }
}

/** The swap output a plan asks for, used to size the quote. */
export function swapSize(plan: LivePlan): { side: "buy" | "sell"; amount: bigint } | null {
  let buy = 0n;
  let sell = 0n;
  for (const step of plan.steps) {
    if (step.kind === "buy") buy += step.amountOut;
    if (step.kind === "sell") sell += step.amountOut;
  }
  return buy > 0n ? { side: "buy", amount: buy } : sell > 0n ? { side: "sell", amount: sell } : null;
}

export type Call = { to: Address; data: Hex; label: string };

export function approveCall(token: Address, symbol: string, spender: Address, amount: bigint): Call {
  return {
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
    label: `${symbol} approval`,
  };
}

/** The contract call for one step. Approvals are separate. */
export function stepCall(step: LiveStep, stock: { id: StockId; address: Address }, account: Address, deadline: bigint): Call {
  const pool = (data: Hex, label: string): Call => ({ to: BLUE.pool, data, label });
  const abi = poolContract.abi;
  switch (step.kind) {
    case "supply":
      return pool(encodeFunctionData({ abi, functionName: "supply", args: [stock.address, step.amount, account, 0] }), `Supply ${stock.id}`);
    case "enable":
      return pool(encodeFunctionData({ abi, functionName: "setUserUseReserveAsCollateral", args: [stock.address, true] }), `Enable ${stock.id} collateral`);
    case "borrow":
      return pool(encodeFunctionData({ abi, functionName: "borrow", args: [BLUE.usdt, step.amount, 2n, 0, account] }), "Borrow USDT");
    case "withdraw":
      return pool(encodeFunctionData({ abi, functionName: "withdraw", args: [stock.address, step.all ? maxUint256 : step.amount, account] }), `Withdraw ${stock.id}`);
    case "repay":
      return pool(encodeFunctionData({ abi, functionName: "repay", args: [BLUE.usdt, step.all ? maxUint256 : step.amount, 2n, account] }), "Repay USDT");
    case "buy":
    case "sell": {
      const buying = step.kind === "buy";
      return {
        to: SWAP.router,
        data: encodeFunctionData({
          abi: routerContract.abi,
          functionName: "exactOutputSingle",
          args: [{
            tokenIn: buying ? BLUE.usdt : stock.address,
            tokenOut: buying ? stock.address : BLUE.usdt,
            fee: SWAP.fees[stock.id],
            recipient: account,
            deadline,
            amountOut: step.amountOut,
            amountInMaximum: step.maxIn,
            sqrtPriceLimitX96: 0n,
          }],
        }),
        label: buying ? `Swap USDT for ${stock.id}` : `Swap ${stock.id} for USDT`,
      };
    }
  }
}

/** What a step spends through an allowance, if anything. */
export function stepSpend(step: LiveStep, stock: { id: StockId; address: Address }) {
  const [approval] = approvalTotals([step], stock.address);
  return approval && { ...approval, symbol: approval.token === BLUE.usdt ? "USDT" : stock.id };
}

/**
 * The whole plan as one batch: an approval for each token and spender whose allowance is short, then the steps.
 * `allowances` holds current allowances keyed `token:spender`.
 */
export function batchCalls(
  plan: LivePlan, stock: { id: StockId; address: Address }, account: Address, deadline: bigint,
  allowances: ReadonlyMap<string, bigint> = new Map(),
): Call[] {
  const approvals = approvalTotals(plan.steps, stock.address)
    .filter(({ token, spender, amount }) => (allowances.get(`${token}:${spender}`) ?? 0n) < amount)
    .map(({ token, spender, amount }) => approveCall(token, token === BLUE.usdt ? "USDT" : stock.id, spender, amount));
  return [...approvals, ...plan.steps.map(step => stepCall(step, stock, account, deadline))];
}
