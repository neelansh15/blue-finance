// Position math and action limits for the deployed pool. Pure functions over `readLiveState` results.
//
// Token amounts are 18-decimal bigint. Prices and account values use the Aave oracle base (USD, 8 decimals).
// These previews guide the forms. The contracts enforce every rule, and each call is simulated before signing.

import { formatUnits, isAddressEqual, zeroAddress } from "viem";
import type { readLiveState } from "./live-state";
import { MARKET_STATUSES, STATUS_LABEL, type StockId } from "./pool";
import type { RiskPosition } from "../risk/adapter";

export type LiveState = Awaited<ReturnType<typeof readLiveState>>;
export type LiveStock = LiveState["stocks"][number];
export type LiveAction = "borrow" | "repay" | "deposit" | "withdraw" | "lend" | "redeem";
export type LiveLimit = { max: bigint; reason?: string };

const WAD = 10n ** 18n;
const BPS = 10_000n;
const RAY = 10 ** 27;

/** Limits configured at launch (script/BlueV3Deployment.sol), shown while the controls report none. */
const LAUNCH_LTV = [5_000n, 4_800n, 4_500n, 4_250n] as const;
const LAUNCH_CAPS = [400n, 300n, 200n, 100n].map(cap => cap * WAD);
/** Reference threshold used only if the reserve configuration cannot be read. */
const LAUNCH_THRESHOLD = 6_250n;

const min = (...values: bigint[]) => values.reduce((a, b) => (b < a ? b : a));
const positive = (value: bigint) => (value > 0n ? value : 0n);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export const liveStock = (state: LiveState, id: StockId) => state.stocks.find(stock => stock.id === id)!;

export function marketStatus(stock: LiveStock) {
  return stock.market === undefined ? undefined : MARKET_STATUSES[stock.market];
}

export function statusLabel(stock: LiveStock) {
  const status = marketStatus(stock);
  return status ? STATUS_LABEL[status] : "Unavailable";
}

/** The stock backing the account's debt, else its enabled collateral, else any supplied stock. */
export function accountStock(state: LiveState): LiveStock | undefined {
  return pinnedStock(state) ?? state.stocks.find(stock => stock.reserve[8] && stock.reserve[0] > 0n)
    ?? state.stocks.find(stock => stock.reserve[0] > 0n);
}

export function pinnedStock(state: LiveState): LiveStock | undefined {
  return state.debtStock === zeroAddress ? undefined
    : state.stocks.find(stock => isAddressEqual(stock.address, state.debtStock));
}

/** Another stock that stops `stock` from becoming the account's collateral. */
export function blockingStock(state: LiveState, stock: LiveStock): LiveStock | undefined {
  const pinned = pinnedStock(state);
  if (pinned) return pinned.id === stock.id ? undefined : pinned;
  return state.stocks.find(other => other.id !== stock.id && other.reserve[8] && other.reserve[0] > 0n);
}

export const usdtDebt = (state: LiveState) => state.usdt.reserve[2];

/** Borrow LTV in basis points for the current status. */
export function borrowLtv(stock: LiveStock): bigint {
  if (stock.limits) return stock.limits[0];
  if (stock.withdrawLtv !== undefined) return stock.withdrawLtv;
  return stock.market === undefined ? 0n : LAUNCH_LTV[stock.market] ?? 0n;
}

export function stockCap(stock: LiveStock): { cap: bigint; fromLaunch: boolean } {
  if (stock.limits) return { cap: stock.limits[1], fromLaunch: false };
  return { cap: stock.market === undefined ? 0n : LAUNCH_CAPS[stock.market] ?? 0n, fromLaunch: true };
}

export const threshold = (stock: LiveStock) => stock.liquidationThreshold || LAUNCH_THRESHOLD;

export const stockValue = (amount: bigint, stock: LiveStock) =>
  stock.price === undefined ? undefined : amount * stock.price / WAD;

export const usdtValue = (state: LiveState, amount: bigint) =>
  state.usdt.price === undefined ? undefined : amount * state.usdt.price / WAD;

/** Why the controls would refuse new borrowing against this stock now. */
export function borrowGate(state: LiveState, stock: LiveStock): string | undefined {
  if (state.usdt.paused || stock.paused) return "The reserve is paused.";
  if (stock.frozen) return `The ${stock.id} reserve is frozen.`;
  const status = marketStatus(stock);
  if (!status) return "The market status could not be read.";
  if (status === "HALTED" || status === "CORP_ACTION") return `${stock.id} is in ${STATUS_LABEL[status].toLowerCase()} status.`;
  if (stock.limits) return undefined;
  if (stock.sourceReady === false) return `The ${stock.id} price needs a keeper refresh.`;
  if (state.usdt.sourceReady === false) return "The USDT price needs a keeper refresh.";
  if (stock.withdrawLtv === undefined) return `A guardian hold is blocking ${stock.id}.`;
  return "The keeper heartbeat has lapsed or the 30-minute recovery window is still running.";
}

export const isEligible = (stock: LiveStock, now = Math.floor(Date.now() / 1000)) =>
  (stock.eligibleUntil ?? 0n) > BigInt(now);

export type Position = {
  stock: LiveStock;
  /** Enabled collateral amount in the stock. */
  collateral: bigint;
  collateralValue: bigint | undefined;
  debt: bigint;
  debtValue: bigint | undefined;
  /** 1e18 scaled. Null without debt, undefined when a price is unusable. */
  healthFactor: bigint | null | undefined;
  borrowLimit: bigint | undefined;
  liquidationPrice: bigint | null | undefined;
};

/**
 * The account measured against `stock`, optionally after changing collateral or debt.
 * Only the enabled collateral stock counts, because each account has one.
 */
export function position(
  state: LiveState, stock: LiveStock,
  change: { collateral?: bigint; debt?: bigint; enable?: boolean } = {},
): Position {
  const counts = stock.reserve[8] || !!change.enable;
  const collateral = positive((counts ? stock.reserve[0] : 0n) + (change.collateral ?? 0n));
  const backing = pinnedStock(state);
  const debt = !backing || backing.id === stock.id ? positive(usdtDebt(state) + (change.debt ?? 0n)) : 0n;
  const collateralValue = stockValue(collateral, stock);
  const debtValue = debt === 0n ? 0n : usdtValue(state, debt);
  const lt = threshold(stock);
  return {
    stock,
    collateral,
    collateralValue,
    debt,
    debtValue,
    healthFactor: debt === 0n ? null
      : collateralValue === undefined || !debtValue ? undefined : collateralValue * lt * WAD / (BPS * debtValue),
    borrowLimit: collateralValue === undefined ? undefined : collateralValue * borrowLtv(stock) / BPS,
    liquidationPrice: debt === 0n || collateral === 0n ? null
      : debtValue === undefined ? undefined : ceilDiv(debtValue * BPS * WAD, lt * collateral),
  };
}

/** USDT still borrowable against the stock, before eligibility and keeper gates. `extra` is collateral to be added. */
export function borrowRoom(state: LiveState, stock: LiveStock, extra = 0n): LiveLimit {
  if (!state.usdt.price) return { max: 0n, reason: "The USDT price is unavailable." };
  // The stock counts as collateral here: the flows that call this enable it before borrowing.
  const after = position(state, stock, { collateral: extra, enable: true });
  if (after.borrowLimit === undefined || after.debtValue === undefined) return { max: 0n, reason: `The ${stock.id} price is unavailable.` };
  if (state.liquidity === 0n) return { max: 0n, reason: "The USDT reserve needs liquidity." };
  const byCollateral = positive(after.borrowLimit - after.debtValue) * WAD / state.usdt.price;
  const byStockCap = positive(stockCap(stock).cap - (stock.debt ?? 0n));
  const byReserveCap = positive(state.caps[0] * WAD - state.totalBorrowed);
  // Leave 0.1% headroom for interest and price movement before the transaction confirms.
  const max = min(state.liquidity, byCollateral, byStockCap, byReserveCap) * 9_990n / BPS;
  if (max > 0n) return { max };
  return {
    max: 0n,
    reason: byCollateral === 0n ? "No borrowing room at the current collateral value and LTV."
      : byStockCap === 0n ? `The ${stock.id} debt cap is full.` : "The USDT borrow cap is full.",
  };
}

export function actionLimit(state: LiveState, id: StockId, action: LiveAction): LiveLimit {
  const stock = liveStock(state, id);
  if (!state.account) return { max: 0n, reason: "Connect your wallet to see your limits." };
  const debt = usdtDebt(state);
  switch (action) {
    case "lend": {
      if (state.usdt.paused) return { max: 0n, reason: "The USDT reserve is paused." };
      const room = positive(state.caps[1] * WAD - state.totalSupplied);
      const max = min(state.usdt.wallet, room < state.usdt.wallet ? room * 9_999n / BPS : room);
      return { max, reason: room === 0n ? "The USDT supply cap is full." : state.usdt.wallet === 0n ? "Your wallet holds no USDT." : undefined };
    }
    case "redeem": {
      if (state.usdt.paused) return { max: 0n, reason: "The USDT reserve is paused." };
      const supplied = state.usdt.reserve[0];
      const max = min(supplied, state.liquidity);
      return { max, reason: supplied === 0n ? "You have no supplied USDT." : max === 0n ? "All USDT is currently borrowed."
        : max < supplied ? "Available liquidity limits this withdrawal." : undefined };
    }
    case "deposit": {
      if (stock.paused || stock.frozen) return { max: 0n, reason: `The ${id} reserve is not accepting supply.` };
      const other = blockingStock(state, stock);
      if (other) return { max: 0n, reason: `Your account uses ${other.id} as collateral. One stock per account.` };
      return { max: stock.wallet, reason: stock.wallet === 0n ? `Your wallet holds no ${id}.` : undefined };
    }
    case "withdraw": {
      const supplied = stock.reserve[0];
      if (supplied === 0n) return { max: 0n, reason: `You have no supplied ${id}.` };
      if (stock.paused) return { max: 0n, reason: `The ${id} reserve is paused.` };
      if (debt === 0n || (pinnedStock(state)?.id !== id && !stock.reserve[8])) return { max: supplied };
      if (stock.withdrawLtv === undefined) return { max: 0n, reason: "A halt, corporate action or guardian hold blocks withdrawals while you have debt." };
      const value = stockValue(supplied, stock);
      const debtValue = usdtValue(state, debt);
      if (!stock.price || value === undefined || debtValue === undefined || stock.withdrawLtv === 0n) {
        return { max: 0n, reason: "A usable price is required to withdraw while you have debt." };
      }
      const excess = positive(value - ceilDiv(debtValue * BPS, stock.withdrawLtv));
      const max = min(supplied, excess * WAD / stock.price * 9_990n / BPS);
      return { max, reason: max === 0n ? "Your debt needs all of this collateral. Repay first." : undefined };
    }
    case "borrow": {
      const other = blockingStock(state, stock);
      if (other) return { max: 0n, reason: `Your account uses ${other.id} as collateral. One stock per account.` };
      if (stock.reserve[0] === 0n) return { max: 0n, reason: `Supply ${id} as collateral to borrow.` };
      if (!stock.reserve[8]) return { max: 0n, reason: `Enable ${id} as collateral to borrow.` };
      const gate = borrowGate(state, stock);
      if (gate) return { max: 0n, reason: gate };
      if (!isEligible(stock)) return { max: 0n, reason: `This wallet needs eligibility for ${id}.` };
      return borrowRoom(state, stock);
    }
    case "repay": {
      if (state.usdt.paused) return { max: 0n, reason: "The USDT reserve is paused." };
      const max = min(state.usdt.wallet, debt);
      return { max, reason: debt === 0n ? "You have no USDT debt." : max === 0n ? "Your wallet holds no USDT." : undefined };
    }
  }
}

/** The connected position against `stock`, in displayed units for the advisory backend (NVDAB only). */
export function liveRiskPosition(state: LiveState, id: StockId): RiskPosition {
  const stock = liveStock(state, id);
  const held = position(state, stock);
  const multiplier = Number(formatUnits(stock.multiplier ?? WAD, 18));
  const quantity = Number(formatUnits(held.collateral, 18)) * multiplier;
  const base = {
    symbol: id,
    quantity,
    debtUsd: held.collateral > 0n && held.debtValue !== undefined ? Number(formatUnits(held.debtValue, 8)) : 0,
    uiPriceUsd: stock.price === undefined ? 0 : Number(formatUnits(stock.price, 8)) / multiplier,
  };
  if (id !== "NVDAB") return { ...base, unsupported: "Stock health coverage is shown in the Risk page table. Position stress testing is currently configured for NVDAB only." };
  const status = marketStatus(stock);
  if (status === "HALTED" || status === "CORP_ACTION" || stock.price === undefined) {
    return { ...base, unsupported: "NVDAB is halted, in a corporate action, or has no usable price. No assessment is available until pricing resumes." };
  }
  return base;
}

const compact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** An 18-decimal token amount. */
export function formatAmount(value: bigint | undefined) {
  if (value === undefined) return "Unavailable";
  if (value > 0n && value < 10n ** 12n) return "<0.000001";
  return compact.format(Number(formatUnits(value, 18)));
}

/** A USD value in the 8-decimal oracle base. */
export const formatUsd = (value: bigint | undefined) =>
  value === undefined ? "Unavailable" : dollars.format(Number(formatUnits(value, 8)));

export const formatHealth = (value: bigint | null | undefined) =>
  value === null ? "No debt" : value === undefined ? "Unavailable" : `${Number(formatUnits(value, 18)).toFixed(2)}×`;

export const formatBps = (value: bigint | undefined) =>
  value === undefined ? "Unavailable" : `${(Number(value) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

export const formatRate = (ray: bigint) => `${(Number(ray) / RAY * 100).toFixed(2)}%`;

export const utilisation = (state: LiveState) =>
  state.totalSupplied === 0n ? "0.0%" : `${(Number(state.totalBorrowed * 10_000n / state.totalSupplied) / 100).toFixed(1)}%`;
