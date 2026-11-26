// Simulated Blue client: holds one PoolState, applies user actions through the pool
// rules and exposes demo controls for the keeper, admin and price scenarios.
// Mock only: no contract calls, no wallet transactions.

import {
  executeAction, initialPoolState, liquidate, needsPriceReview, scheduledStatusAt,
  type Action, type PoolState, type ScheduledStatus, type StockId, type StockState,
} from "./pool";

export * from "./pool";

export type ClientResult = { ok: boolean; message: string };

export type DemoControls = {
  /** Force a scheduled status for every stock, or null to follow the US Eastern clock. */
  setSchedule(status: ScheduledStatus | null): void;
  /** Recompute the scheduled status from the clock (no effect while a demo status is set). */
  syncClock(now?: Date): void;
  halt(stock: StockId): void;
  /** Admin clears a HALTED or CORP_ACTION override early. */
  clearStatus(stock: StockId): ClientResult;
  setGuardianHold(stock: StockId, hold: boolean): void;
  /** Keeper misses its heartbeat. */
  keeperLapse(): void;
  /** Keeper reports again; borrowing waits for the recovery window. */
  keeperReport(): void;
  /** The 30-minute recovery window of healthy reports passes. */
  finishRecovery(): void;
  /** Keeper sets CORP_ACTION ahead of a split. */
  announceSplit(stock: StockId, ratio: number): void;
  /** The token multiplier changes (with or without a prior announcement). */
  changeMultiplier(stock: StockId, ratio: number): void;
  /** Admin accepts the live price as the new reference (after review or a multiplier change). */
  acceptPrice(stock: StockId): ClientResult;
  /** Move the live Atlas price. Moves within 20% are accepted by the keeper automatically. */
  movePrice(stock: StockId, change: number): void;
  /** The accepted price ages past the 2-hour borrowing limit. */
  stalePrice(stock: StockId): void;
  setUsdtPriceFresh(fresh: boolean): void;
  setEligibility(valid: boolean): void;
  runLiquidation(): ClientResult;
  reset(): void;
};

export type BlueClient = {
  mode: "mock";
  getState(): PoolState;
  subscribe(listener: () => void): () => void;
  act(action: Action, stock: StockId, amount: number): ClientResult;
  demo: DemoControls;
};

export function createBlueClient(initial: PoolState = initialPoolState()): BlueClient {
  let state = initial;
  const listeners = new Set<() => void>();

  function set(next: PoolState) {
    if (next === state) return;
    state = next;
    listeners.forEach(listener => listener());
  }

  function patchStock(stock: StockId, changes: Partial<StockState>) {
    set({ ...state, stocks: { ...state.stocks, [stock]: { ...state.stocks[stock], ...changes } } });
  }

  const demo: DemoControls = {
    setSchedule(status) {
      if (status) set({ ...state, schedule: status, scheduleSource: "demo" });
      else set({ ...state, schedule: scheduledStatusAt(new Date()), scheduleSource: "clock" });
    },
    syncClock(now = new Date()) {
      if (state.scheduleSource !== "clock") return;
      const schedule = scheduledStatusAt(now);
      if (schedule !== state.schedule) set({ ...state, schedule });
    },
    halt(stock) {
      if (state.stocks[stock].override !== "CORP_ACTION") patchStock(stock, { override: "HALTED" });
    },
    clearStatus(stock) {
      const s = state.stocks[stock];
      if (!s.override) return { ok: false, message: `${stock} has no temporary status to clear.` };
      if (s.override === "CORP_ACTION" && (s.pendingSplit || s.multiplier !== s.acceptedMultiplier)) {
        return { ok: false, message: "Apply the split and accept a price that reflects the new multiplier first." };
      }
      patchStock(stock, { override: null });
      return { ok: true, message: `Admin cleared the ${stock} status. The schedule applies again.` };
    },
    setGuardianHold(stock, hold) {
      patchStock(stock, { guardianHold: hold });
    },
    keeperLapse() {
      set({ ...state, keeper: "LAPSED" });
    },
    keeperReport() {
      if (state.keeper === "LAPSED") set({ ...state, keeper: "RECOVERING" });
    },
    finishRecovery() {
      if (state.keeper === "RECOVERING") set({ ...state, keeper: "LIVE" });
    },
    announceSplit(stock, ratio) {
      if (!Number.isSafeInteger(ratio) || ratio < 2) return;
      patchStock(stock, { override: "CORP_ACTION", pendingSplit: ratio });
    },
    changeMultiplier(stock, ratio) {
      if (!(ratio > 0) || ratio === 1) return;
      const s = state.stocks[stock];
      patchStock(stock, { multiplier: s.multiplier * ratio, pendingSplit: null });
    },
    acceptPrice(stock) {
      const s = state.stocks[stock];
      if (s.price === s.acceptedPrice && s.multiplier === s.acceptedMultiplier && s.acceptedAgeMinutes <= 1) {
        return { ok: false, message: `The ${stock} price is already accepted.` };
      }
      patchStock(stock, { acceptedPrice: s.price, acceptedMultiplier: s.multiplier, acceptedAgeMinutes: 0, priceAgeMinutes: 0 });
      return { ok: true, message: `Admin accepted ${(s.price / 100).toFixed(2)} USDT per ${stock} as the new reference.` };
    },
    movePrice(stock, change) {
      const s = state.stocks[stock];
      const price = Math.max(1, Math.round(s.price * (1 + change)));
      const moved = { ...s, price, priceAgeMinutes: 0 };
      // The keeper accepts rounds inside the continuity band; larger moves wait for the admin.
      const autoAccept = !needsPriceReview(moved) && s.multiplier === s.acceptedMultiplier && s.override !== "CORP_ACTION";
      patchStock(stock, autoAccept ? { ...moved, acceptedPrice: price, acceptedAgeMinutes: 0 } : moved);
    },
    stalePrice(stock) {
      patchStock(stock, { acceptedAgeMinutes: 180 });
    },
    setUsdtPriceFresh(fresh) {
      set({ ...state, usdtPriceFresh: fresh });
    },
    setEligibility(valid) {
      set({ ...state, account: { ...state.account, eligibilityMinutesLeft: valid ? 24 * 60 : 0 } });
    },
    runLiquidation() {
      const result = liquidate(state);
      set(result.state);
      return { ok: result.ok, message: result.message };
    },
    reset() {
      const fresh = initialPoolState();
      set({ ...fresh, schedule: scheduledStatusAt(new Date()) });
    },
  };

  return {
    mode: "mock",
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    act(action, stock, amount) {
      const result = executeAction(state, action, stock, amount);
      set(result.state);
      return { ok: result.ok, message: result.message };
    },
    demo,
  };
}
