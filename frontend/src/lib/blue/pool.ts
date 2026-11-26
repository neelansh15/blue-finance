// Simulated Blue pool: one Aave V3 pool with one shared USDT reserve and five
// collateral-only bStock reserves. Mirrors protocol/src (BluePool, StockBorrowControls,
// StockPriceSource, MarketCalendar). Pure functions over plain data; no contract calls.
//
// Units: USDT amounts are integer cents. Collateral amounts are integer 1/10,000 of a
// raw token. Prices are cents per raw token (Atlas quotes per raw token).

export const TOKENS_PER_UNIT = 10_000;
export const CENTS_PER_USDT = 100;

export const STOCKS = [
  { id: "TSLAB", symbol: "TSLAB", name: "Tesla", referencePrice: 38_184 },
  { id: "NVDAB", symbol: "NVDAB", name: "NVIDIA", referencePrice: 15_065 },
  { id: "QQQB", symbol: "QQQB", name: "Invesco QQQ", referencePrice: 63_647 },
  { id: "SPCXB", symbol: "SPCXB", name: "SpaceX", referencePrice: 12_932 },
  { id: "GOOGLB", symbol: "GOOGLB", name: "Alphabet", referencePrice: 27_545 },
] as const;

export type Stock = (typeof STOCKS)[number];
export type StockId = Stock["id"];
export const STOCK_IDS: readonly StockId[] = STOCKS.map(stock => stock.id);
export const stockById = (id: StockId): Stock => STOCKS.find(stock => stock.id === id)!;
export const isStockId = (value: unknown): value is StockId => STOCK_IDS.some(id => id === value);

export const MARKET_STATUSES = ["OPEN", "EXTENDED", "CLOSED", "WEEKEND", "HALTED", "CORP_ACTION"] as const;
export type MarketStatus = (typeof MARKET_STATUSES)[number];
export const SCHEDULED_STATUSES = ["OPEN", "EXTENDED", "CLOSED", "WEEKEND"] as const;
export type ScheduledStatus = (typeof SCHEDULED_STATUSES)[number];
export const isScheduledStatus = (value: unknown): value is ScheduledStatus =>
  SCHEDULED_STATUSES.some(status => status === value);

export const STATUS_LABEL: Record<MarketStatus, string> = {
  OPEN: "Open",
  EXTENDED: "Extended",
  CLOSED: "Closed",
  WEEKEND: "Weekend",
  HALTED: "Halted",
  CORP_ACTION: "Corporate action",
};

/** Same parameters for every stock (script/BlueV3Deployment.sol). */
export const RISK = { baseLtv: 0.5, liquidationThreshold: 0.625, liquidationBonus: 0.05 } as const;

/** Borrowing discount per status. Applies to borrowing power and withdrawals with debt only. */
export const BORROWING_DISCOUNT: Record<ScheduledStatus, number> = {
  OPEN: 0,
  EXTENDED: 0.04,
  CLOSED: 0.1,
  WEEKEND: 0.15,
};

export const RATE_MODEL = { optimal: 0.8, base: 0.02, slope1: 0.04, slope2: 0.6, reserveFactor: 0.1 } as const;

export const LIMITS = {
  heartbeatMinutes: 10,
  recoveryMinutes: 30,
  borrowPriceMaxAgeMinutes: 120,
  valuationMaxAgeMinutes: 24 * 60,
  continuityBand: 0.2,
  /** Fixed absolute band: about 1/10 to 10x the November 2026 reference price. */
  priceBandFactor: 10,
  eligibilityMaxMinutes: 24 * 60,
} as const;

export type GateStatus = "LIVE" | "LAPSED" | "RECOVERING";

export type StockState = {
  /** Live Atlas round, cents per raw token. */
  price: number;
  priceAgeMinutes: number;
  /** Token UI multiplier reported now. */
  multiplier: number;
  /** Last price accepted for new borrowing (continuity reference). */
  acceptedPrice: number;
  acceptedMultiplier: number;
  acceptedAgeMinutes: number;
  /** Temporary stricter status set by the keeper or admin. */
  override: "HALTED" | "CORP_ACTION" | null;
  /** Split ratio announced while CORP_ACTION is set and the multiplier has not changed yet. */
  pendingSplit: number | null;
  guardianHold: boolean;
  /** USDT debt attributed to this stock across all accounts (cents). */
  debt: number;
};

export type Account = {
  /** Collateral stock (Aave isolation: one per account). */
  stock: StockId | null;
  collateral: number;
  debt: number;
  /** bluUSDT balance (cents). */
  supplied: number;
  /** Wallet USDT (cents). */
  usdt: number;
  /** Wallet stock balances (token units). */
  wallet: Record<StockId, number>;
  /** Signed eligibility for the account and its stock (at most one day). */
  eligibilityMinutesLeft: number;
};

export type PoolState = {
  schedule: ScheduledStatus;
  scheduleSource: "clock" | "demo";
  keeper: GateStatus;
  usdtPriceFresh: boolean;
  /** Total USDT supplied to the reserve (cents). */
  supplied: number;
  /** Total USDT borrowed from the reserve (cents). */
  borrowed: number;
  /** Debt written off by liquidations that ran out of collateral (cents). */
  deficit: number;
  supplyCap: number;
  borrowCap: number;
  /** Per-stock debt cap by status, scaled up from the prototype 400/300/200/100 USDT. */
  stockBorrowCaps: Record<ScheduledStatus, number>;
  stocks: Record<StockId, StockState>;
  account: Account;
};

const usdt = (amount: number) => amount * CENTS_PER_USDT;
const tokens = (amount: number) => amount * TOKENS_PER_UNIT;

function startingStock(id: StockId, debt: number): StockState {
  const price = stockById(id).referencePrice;
  return {
    price, priceAgeMinutes: 1, multiplier: 1,
    acceptedPrice: price, acceptedMultiplier: 1, acceptedAgeMinutes: 1,
    override: null, pendingSplit: null, guardianHold: false, debt,
  };
}

export function initialPoolState(): PoolState {
  return {
    schedule: "OPEN",
    scheduleSource: "clock",
    keeper: "LIVE",
    usdtPriceFresh: true,
    supplied: usdt(40_000),
    borrowed: usdt(24_000),
    deficit: 0,
    supplyCap: usdt(100_000),
    borrowCap: usdt(80_000),
    stockBorrowCaps: { OPEN: usdt(40_000), EXTENDED: usdt(30_000), CLOSED: usdt(20_000), WEEKEND: usdt(10_000) },
    stocks: {
      TSLAB: startingStock("TSLAB", usdt(8_000)),
      NVDAB: startingStock("NVDAB", usdt(6_000)),
      QQQB: startingStock("QQQB", usdt(5_000)),
      SPCXB: startingStock("SPCXB", usdt(3_000)),
      GOOGLB: startingStock("GOOGLB", usdt(2_000)),
    },
    account: {
      stock: "NVDAB",
      collateral: tokens(20),
      debt: usdt(900),
      supplied: usdt(500),
      usdt: usdt(5_000),
      wallet: { TSLAB: tokens(10), NVDAB: tokens(20), QQQB: tokens(5), SPCXB: tokens(20), GOOGLB: tokens(10) },
      eligibilityMinutesLeft: 12 * 60,
    },
  };
}

// ---------------------------------------------------------------- status and schedule

const STATUS_RANK: Record<MarketStatus, number> = { OPEN: 0, EXTENDED: 1, CLOSED: 2, WEEKEND: 3, HALTED: 4, CORP_ACTION: 5 };

export function stockStatus(state: PoolState, id: StockId): MarketStatus {
  const override = state.stocks[id].override;
  return override && STATUS_RANK[override] > STATUS_RANK[state.schedule] ? override : state.schedule;
}

/** Borrow LTV for a status: base LTV less the borrowing discount. Zero while halted or in a corporate action. */
export function borrowLtv(status: MarketStatus): number {
  return isScheduledStatus(status) ? RISK.baseLtv * (1 - BORROWING_DISCOUNT[status]) : 0;
}

export function stockBorrowCap(state: PoolState, id: StockId): number {
  const status = stockStatus(state, id);
  return isScheduledStatus(status) ? state.stockBorrowCaps[status] : 0;
}

/** Sample exchange calendar (US Eastern). Keyed YYYY-MM-DD. */
export const SAMPLE_CALENDAR = {
  holidays: new Set([
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03",
    "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05",
    "2027-09-06", "2027-11-25", "2027-12-24",
  ]),
  earlyCloses: new Set(["2026-11-27", "2026-12-24", "2027-11-26"]),
};
export type Calendar = typeof SAMPLE_CALENDAR;

const ymd = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

/** Day number (days since epoch), weekday (0 = Sunday) and minutes past midnight in US Eastern time. */
export function easternTime(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(part => [part.type, part.value]));
  const day = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86_400_000;
  return { day, weekday: new Date(day * 86_400_000).getUTCDay(), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Scheduled status, following MarketCalendar.sol. */
export function scheduledStatusAt(date: Date, calendar: Calendar = SAMPLE_CALENDAR): ScheduledStatus {
  const { day, weekday, minutes } = easternTime(date);
  const holiday = (d: number) => calendar.holidays.has(ymd(d));
  const overnightAfter = (d: number, dow: number): ScheduledStatus => dow === 5 || holiday(d + 1) ? "WEEKEND" : "CLOSED";

  if (weekday === 6) return "WEEKEND";
  if (weekday === 0) return minutes < 20 * 60 ? "WEEKEND" : holiday(day + 1) ? "WEEKEND" : "CLOSED";
  if (holiday(day)) return minutes < 20 * 60 ? "WEEKEND" : overnightAfter(day, weekday);

  const early = calendar.earlyCloses.has(ymd(day));
  const closeAt = early ? 13 * 60 : 16 * 60;
  const postEnd = early ? 17 * 60 : 20 * 60;
  if (minutes < 4 * 60) return "CLOSED";
  if (minutes < 9 * 60 + 30) return "EXTENDED";
  if (minutes < closeAt) return "OPEN";
  if (minutes < postEnd) return "EXTENDED";
  return overnightAfter(day, weekday);
}

// ---------------------------------------------------------------- pool rates

export function poolMetrics(state: PoolState) {
  const utilisation = state.supplied > 0 ? Math.min(1, state.borrowed / state.supplied) : 0;
  const { optimal, base, slope1, slope2, reserveFactor } = RATE_MODEL;
  const borrowApr = utilisation <= optimal
    ? base + slope1 * utilisation / optimal
    : base + slope1 + slope2 * (utilisation - optimal) / (1 - optimal);
  return {
    utilisation,
    borrowApr,
    supplyApr: borrowApr * utilisation * (1 - reserveFactor),
    liquidity: Math.max(0, state.supplied - state.borrowed - state.deficit),
  };
}

// ---------------------------------------------------------------- prices

export type PriceCheck = { usable: true } | { usable: false; reason: string };

/** Valuation price for health factor, liquidation and withdrawals with debt. */
export function valuationCheck(state: PoolState, id: StockId): PriceCheck {
  const s = state.stocks[id];
  const reference = stockById(id).referencePrice;
  if (stockStatus(state, id) === "CORP_ACTION") return { usable: false, reason: "a corporate action is in progress" };
  if (s.multiplier !== s.acceptedMultiplier) {
    return { usable: false, reason: "the token multiplier changed and an admin must accept a price that reflects it" };
  }
  if (s.priceAgeMinutes > LIMITS.valuationMaxAgeMinutes) return { usable: false, reason: "the price is more than 24 hours old" };
  if (s.price * LIMITS.priceBandFactor < reference || s.price > reference * LIMITS.priceBandFactor) {
    return { usable: false, reason: "the price is outside the allowed band" };
  }
  return { usable: true };
}

/** Whether the live price has moved more than the continuity band since the last accepted price. */
export const needsPriceReview = (s: StockState) => Math.abs(s.price / s.acceptedPrice - 1) > LIMITS.continuityBand;

// ---------------------------------------------------------------- positions

export function collateralValue(price: number, collateral: number) {
  return collateral * price / TOKENS_PER_UNIT;
}

export type PositionMetrics = {
  stock: StockId | null;
  status: MarketStatus | null;
  value: number;
  borrowLtv: number;
  borrowLimit: number;
  /** Extra USDT the borrow LTV allows (ignores caps, liquidity and gates). */
  headroom: number;
  healthFactor: number | null;
  liquidationPrice: number | null;
  liquidatable: boolean;
  valuation: PriceCheck;
};

export function positionMetrics(state: PoolState, account: Account = state.account): PositionMetrics {
  const id = account.stock;
  if (!id) {
    return { stock: null, status: null, value: 0, borrowLtv: 0, borrowLimit: 0, headroom: 0, healthFactor: null,
      liquidationPrice: null, liquidatable: false, valuation: { usable: true } };
  }
  const status = stockStatus(state, id);
  const value = collateralValue(state.stocks[id].price, account.collateral);
  const ltv = borrowLtv(status);
  const borrowLimit = Math.floor(value * ltv);
  const valuation = valuationCheck(state, id);
  // Without a usable price the pool cannot compute health (and liquidation pauses): NaN marks that.
  const healthFactor = account.debt > 0
    ? (valuation.usable ? value * RISK.liquidationThreshold / account.debt : Number.NaN)
    : null;
  return {
    stock: id,
    status,
    value,
    borrowLtv: ltv,
    borrowLimit,
    headroom: Math.max(0, borrowLimit - account.debt),
    healthFactor,
    liquidationPrice: account.debt > 0 && account.collateral > 0
      ? account.debt * TOKENS_PER_UNIT / (account.collateral * RISK.liquidationThreshold) : null,
    liquidatable: healthFactor !== null && healthFactor < 1 && valuation.usable,
    valuation,
  };
}

// ---------------------------------------------------------------- actions

export const ACTIONS = {
  deposit: { label: "Supply collateral", collateral: true },
  withdraw: { label: "Withdraw collateral", collateral: true },
  borrow: { label: "Borrow USDT", collateral: false },
  repay: { label: "Repay USDT", collateral: false },
  lend: { label: "Supply USDT", collateral: false },
  redeem: { label: "Withdraw USDT", collateral: false },
} as const;
export type Action = keyof typeof ACTIONS;
export type ActionLimit = { max: number; reason?: string };

/** Why new borrowing against a stock is paused, in plain words, or null. Ignores amounts. */
export function borrowGate(state: PoolState, id: StockId): string | null {
  const s = state.stocks[id];
  const status = stockStatus(state, id);
  const valuation = valuationCheck(state, id);
  if (status === "CORP_ACTION") return `${id} has a corporate action in progress, so new loans against it are paused.`;
  if (status === "HALTED") return `${id} is halted, so new loans against it are paused.`;
  if (s.guardianHold) return `The guardian has put ${id} on hold, so new loans against it are paused.`;
  if (!valuation.usable) return `New loans against ${id} are paused because ${valuation.reason}.`;
  if (state.keeper === "LAPSED") return "Monitoring has lapsed: the keeper has not reported in the last 10 minutes.";
  if (state.keeper === "RECOVERING") return "Monitoring is recovering: borrowing resumes after 30 minutes of healthy keeper reports.";
  if (needsPriceReview(s)) return `${id} moved more than 20% since the last accepted price. Borrowing resumes after an admin reviews and accepts it.`;
  if (s.acceptedAgeMinutes > LIMITS.borrowPriceMaxAgeMinutes) return `The ${id} price is more than 2 hours old for new borrowing.`;
  if (!state.usdtPriceFresh) return "The USDT price is stale, so new borrowing is paused.";
  if (state.account.eligibilityMinutesLeft <= 0) return "Your borrowing eligibility has expired. Request a new signed approval (valid for up to one day).";
  return null;
}

/** Why a withdrawal with debt is blocked regardless of amount, or null. */
function withdrawWithDebtGate(state: PoolState, id: StockId): string | null {
  const status = stockStatus(state, id);
  if (status === "HALTED") return `${id} is halted. Withdrawing while you have a loan resumes when trading does.`;
  if (status === "CORP_ACTION") return `${id} has a corporate action in progress. Withdrawing while you have a loan resumes after it clears.`;
  if (state.stocks[id].guardianHold) return `${id} is on a guardian hold. Withdrawing while you have a loan resumes when it is released.`;
  const valuation = valuationCheck(state, id);
  if (!valuation.usable) return `Withdrawing while you have a loan waits for a usable ${id} price: ${valuation.reason}.`;
  return null;
}

const fmtTokens = (units: number) => (units / TOKENS_PER_UNIT).toLocaleString("en-US", { maximumFractionDigits: 4 });

/** For each action, the largest allowed amount and, when nothing is allowed, why. */
export function actionLimits(state: PoolState, id: StockId): Record<Action, ActionLimit> {
  const account = state.account;
  const pool = poolMetrics(state);
  const holdsOther = account.stock !== null && account.stock !== id;
  const metrics = positionMetrics(state);
  const result = {} as Record<Action, ActionLimit>;
  const limit = (max: number, reason: string): ActionLimit => (max > 0 ? { max } : { max: 0, reason });

  result.deposit = holdsOther
    ? { max: 0, reason: account.debt > 0
      ? `Your account uses ${account.stock} as collateral. One stock per account: repay your loan and withdraw ${account.stock} before switching.`
      : `Your account uses ${account.stock} as collateral. One stock per account: withdraw your ${account.stock} first.` }
    : limit(account.wallet[id], `No ${id} in your demo wallet.`);

  if (holdsOther || account.collateral === 0) {
    result.withdraw = { max: 0, reason: `You have no ${id} collateral.` };
  } else if (account.debt === 0) {
    result.withdraw = { max: account.collateral };
  } else {
    const gate = withdrawWithDebtGate(state, id);
    if (gate) result.withdraw = { max: 0, reason: gate };
    else {
      const perUnit = state.stocks[id].price * metrics.borrowLtv / TOKENS_PER_UNIT;
      const keep = perUnit > 0 ? Math.ceil(account.debt / perUnit) : account.collateral;
      result.withdraw = limit(account.collateral - keep,
        `Your loan uses the full ${pct(metrics.borrowLtv)} borrow limit for ${STATUS_LABEL[metrics.status!].toLowerCase()} hours. Repay some USDT to withdraw.`);
    }
  }

  if (holdsOther) {
    result.borrow = { max: 0, reason: `Your account borrows against ${account.stock}. One collateral stock per account.` };
  } else if (account.collateral === 0) {
    result.borrow = { max: 0, reason: `Supply ${id} as collateral to borrow.` };
  } else {
    const gate = borrowGate(state, id);
    if (gate) result.borrow = { max: 0, reason: gate };
    else {
      const capRoom = stockBorrowCap(state, id) - state.stocks[id].debt;
      const poolCapRoom = state.borrowCap - state.borrowed;
      const options: [number, string][] = [
        [metrics.headroom, `Borrowing limit reached at the ${pct(metrics.borrowLtv)} borrow LTV for ${STATUS_LABEL[metrics.status!].toLowerCase()} hours. Add collateral or repay.`],
        [capRoom, `The ${id} stock borrow cap for ${STATUS_LABEL[metrics.status!].toLowerCase()} hours is used up.`],
        [poolCapRoom, "The pool-wide USDT borrow cap is used up."],
        [pool.liquidity, "The pool has no USDT available to lend right now."],
      ];
      const [max, reason] = options.reduce((low, next) => (next[0] < low[0] ? next : low));
      result.borrow = limit(Math.floor(max), reason);
    }
  }

  result.repay = holdsOther && account.debt > 0
    ? { max: 0, reason: `Your loan is against ${account.stock}. Open ${account.stock} to repay it.` }
    : account.debt === 0 || holdsOther
    ? { max: 0, reason: "You have no loan to repay." }
    : limit(Math.min(account.debt, account.usdt), "No USDT in your demo wallet.");

  result.lend = limit(Math.min(account.usdt, state.supplyCap - state.supplied),
    account.usdt === 0 ? "No USDT in your demo wallet." : "The pool's USDT supply cap is reached.");

  result.redeem = account.supplied === 0
    ? { max: 0, reason: "You have no bluUSDT to withdraw." }
    : limit(Math.min(account.supplied, pool.liquidity), "All pool USDT is lent out. Withdrawals resume as borrowers repay.");

  return result;
}

export type ActionResult = { ok: boolean; message: string; state: PoolState };

/** Applies an action if it is within its limit. Amount in cents or token units. */
export function executeAction(state: PoolState, action: Action, id: StockId, amount: number): ActionResult {
  const allowed = actionLimits(state, id)[action];
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, message: "Enter a positive amount.", state };
  if (amount > allowed.max) return { ok: false, message: allowed.reason ?? "Amount exceeds the limit.", state };

  const account = { ...state.account, wallet: { ...state.account.wallet } };
  const stocks = { ...state.stocks, [id]: { ...state.stocks[id] } };
  const next: PoolState = { ...state, account, stocks };
  const display = ACTIONS[action].collateral ? `${fmtTokens(amount)} ${id}` : `${(amount / CENTS_PER_USDT).toFixed(2)} USDT`;

  switch (action) {
    case "deposit":
      account.wallet[id] -= amount; account.collateral += amount; account.stock = id; break;
    case "withdraw":
      account.wallet[id] += amount; account.collateral -= amount;
      if (account.collateral === 0 && account.debt === 0) account.stock = null;
      break;
    case "borrow":
      account.debt += amount; account.usdt += amount; stocks[id].debt += amount; next.borrowed += amount; break;
    case "repay":
      account.debt -= amount; account.usdt -= amount; stocks[id].debt -= amount; next.borrowed -= amount;
      if (account.collateral === 0 && account.debt === 0) account.stock = null;
      break;
    case "lend":
      account.usdt -= amount; account.supplied += amount; next.supplied += amount; break;
    case "redeem":
      account.usdt += amount; account.supplied -= amount; next.supplied -= amount; break;
  }
  return { ok: true, message: `Simulated: ${ACTIONS[action].label.toLowerCase()}, ${display}.`, state: next };
}

/** Aave-style liquidation at the live valuation price: 50% close factor (100% below 0.95), 5% bonus. */
export function liquidate(state: PoolState): ActionResult {
  const account = state.account;
  const id = account.stock;
  const metrics = positionMetrics(state);
  if (!id || metrics.healthFactor === null) return { ok: false, message: "There is no loan to liquidate.", state };
  if (!metrics.valuation.usable) return { ok: false, message: `Liquidation waits for a usable ${id} price: ${metrics.valuation.reason}.`, state };
  if (metrics.healthFactor >= 1) return { ok: false, message: "Health factor is at or above 1. Nothing to liquidate.", state };

  const price = state.stocks[id].price;
  const closeFactor = metrics.healthFactor < 0.95 ? 1 : 0.5;
  let repaid = Math.floor(account.debt * closeFactor);
  let seized = Math.ceil(repaid * (1 + RISK.liquidationBonus) * TOKENS_PER_UNIT / price);
  if (seized >= account.collateral) {
    seized = account.collateral;
    repaid = Math.min(account.debt, Math.floor(collateralValue(price, seized) / (1 + RISK.liquidationBonus)));
  }
  const debtAfter = account.debt - repaid;
  const deficit = account.collateral - seized === 0 ? debtAfter : 0;
  const written = repaid + deficit;
  const next: PoolState = {
    ...state,
    borrowed: state.borrowed - written,
    deficit: state.deficit + deficit,
    stocks: { ...state.stocks, [id]: { ...state.stocks[id], debt: state.stocks[id].debt - written } },
    account: {
      ...account,
      collateral: account.collateral - seized,
      debt: debtAfter - deficit,
      stock: account.collateral - seized === 0 ? null : id,
    },
  };
  return {
    ok: true,
    message: `Simulated liquidation at ${(price / CENTS_PER_USDT).toFixed(2)} USDT per ${id}: repaid ${(repaid / CENTS_PER_USDT).toFixed(2)} USDT, seized ${fmtTokens(seized)} ${id}`
      + (deficit > 0 ? `, ${(deficit / CENTS_PER_USDT).toFixed(2)} USDT recorded as a pool deficit.` : "."),
    state: next,
  };
}

// ---------------------------------------------------------------- notices

export type Notice = { tone: "risk" | "caution"; title: string; body: string };

/** "What you can do" banner for a stock, modelled on Zona's closure notice. Null when nothing is restricted. */
export function statusNotice(state: PoolState, id: StockId): Notice | null {
  const s = state.stocks[id];
  const status = stockStatus(state, id);
  const valuation = valuationCheck(state, id);
  if (status === "CORP_ACTION") {
    return { tone: "caution", title: `${id} has a corporate action in progress${s.pendingSplit ? `: ${s.pendingSplit}-for-1 split announced` : ""}.`,
      body: "You can repay or add collateral. New loans, withdrawing while you have a loan, and liquidation are paused until an admin accepts a price that reflects the new multiplier and the status clears." };
  }
  if (status === "HALTED") {
    return { tone: "risk", title: `${id} is halted.`,
      body: `You can repay or add collateral. Withdrawing while you have a loan resumes when trading does. Loans against other stocks are unaffected.` };
  }
  if (s.guardianHold) {
    return { tone: "risk", title: `${id} is on a guardian hold.`,
      body: "You can repay or add collateral. New loans and withdrawing while you have a loan resume when governance releases the hold." };
  }
  if (!valuation.usable) {
    return { tone: "risk", title: `${id} has no usable price.`,
      body: `Because ${valuation.reason}, new loans, withdrawing while you have a loan, and liquidation are paused. You can repay or add collateral.` };
  }
  if (state.keeper !== "LIVE") {
    return { tone: "caution", title: state.keeper === "LAPSED" ? "Monitoring has lapsed." : "Monitoring is recovering.",
      body: (state.keeper === "LAPSED" ? "The keeper has not reported in the last 10 minutes. " : "The keeper is reporting again. ")
        + "New borrowing resumes after 30 minutes of healthy reports. You can repay, add collateral, and withdraw as long as your loan stays within the current borrow limit." };
  }
  if (needsPriceReview(s)) {
    return { tone: "caution", title: `${id} moved more than 20% since the last accepted price.`,
      body: "New borrowing waits for an admin to review and accept the price. Health factor and liquidation already use the live price. You can repay, add collateral, or withdraw within the current borrow limit." };
  }
  if (s.acceptedAgeMinutes > LIMITS.borrowPriceMaxAgeMinutes) {
    return { tone: "caution", title: `The ${id} price is too old for new borrowing.`,
      body: "Borrowing resumes when the keeper accepts a fresh price. You can repay, add collateral, or withdraw within the current borrow limit." };
  }
  if (!state.usdtPriceFresh) {
    return { tone: "caution", title: "The USDT price is stale.",
      body: "New borrowing resumes when Chainlink USDT/USD updates. Repaying, adding collateral and withdrawing within the limit continue." };
  }
  return null;
}

export const pct = (value: number, digits?: number) =>
  `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: digits ?? 1 })}%`;
