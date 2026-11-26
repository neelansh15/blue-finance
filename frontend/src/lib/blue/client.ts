import { BLUE_PARAMS } from "./params";
import {
  derivePosition, liquidationOutcome, numberToWad, validateBorrow, wadToNumber,
  type BlueSnapshot, type Regime,
} from "./math";

export * from "./math";

type ActionResult = { ok: boolean; message: string };

export type DemoControls = {
  setRegime(regime: Regime): void;
  announceSplit(ratio: number): void;
  applyScheduledMultiplier(): void;
  feedPrintsPostSplit(): void;
  tryClearCorpAction(): ActionResult;
  setMultiplier(multiplier: bigint): void;
  movePrice(change: number): void;
  setFeedPrice(price: number): void;
  runLiquidationBot(): ActionResult;
  reset(): void;
};

export type BlueClient = {
  mode: "mock";
  demo: DemoControls;
  getSnapshot(): Promise<BlueSnapshot>;
  subscribe(listener: () => void): () => void;
  borrow(amount: number): Promise<ActionResult>;
};

function startingSnapshot(): BlueSnapshot {
  return {
    symbol: "NVDAb",
    loanSymbol: "USDT",
    params: structuredClone(BLUE_PARAMS),
    regime: "OPEN",
    feedPricePerUI: 200,
    collateralRaw: numberToWad(10),
    uiMultiplier: numberToWad(1),
    debt: 700,
    pendingMultiplier: null,
    frozenPricePerRaw: null,
  };
}

export function createBlueClient(): BlueClient {
  let snapshot = startingSnapshot();
  let resumeRegime: Regime = "OPEN";
  const listeners = new Set<() => void>();
  const specialRegime = (regime: Regime) => regime === "HALTED" || regime === "CORP_ACTION";

  function update(changes: Partial<BlueSnapshot>) {
    snapshot = { ...snapshot, ...changes };
    listeners.forEach((listener) => listener());
  }

  function enterRegime(regime: Regime, pendingMultiplier: BlueSnapshot["pendingMultiplier"] = null) {
    if (!specialRegime(snapshot.regime)) resumeRegime = snapshot.regime;
    update({
      regime,
      pendingMultiplier,
      frozenPricePerRaw: specialRegime(regime) ? derivePosition(snapshot).oracle.pricePerRaw : null,
    });
  }

  function setFeedPrice(price: number) {
    if (Number.isFinite(price) && price > 0) update({ feedPricePerUI: price });
  }

  return {
    mode: "mock",
    getSnapshot: async () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async borrow(amount) {
      const check = validateBorrow(snapshot, amount);
      if (!check.ok) return { ok: false, message: check.reason ?? "Borrow unavailable." };
      update({ debt: check.newDebt });
      return { ok: true, message: `Simulated borrowing ${amount.toFixed(2)} ${snapshot.loanSymbol}.` };
    },
    demo: {
      setRegime(regime) {
        if (regime !== snapshot.regime) enterRegime(regime);
      },
      announceSplit(ratio) {
        if (specialRegime(snapshot.regime) || !Number.isSafeInteger(ratio) || ratio < 2) return;
        enterRegime("CORP_ACTION", { newMultiplier: snapshot.uiMultiplier * BigInt(ratio) });
      },
      applyScheduledMultiplier() {
        const pending = snapshot.pendingMultiplier;
        if (pending) update({ uiMultiplier: pending.newMultiplier, pendingMultiplier: null });
      },
      feedPrintsPostSplit() {
        if (snapshot.regime !== "CORP_ACTION" || snapshot.pendingMultiplier || snapshot.frozenPricePerRaw === null) return;
        setFeedPrice(snapshot.frozenPricePerRaw / wadToNumber(snapshot.uiMultiplier));
      },
      tryClearCorpAction() {
        const { regime, frozenPricePerRaw, pendingMultiplier } = snapshot;
        if (regime !== "CORP_ACTION" || frozenPricePerRaw === null || pendingMultiplier) {
          return { ok: false, message: "Apply the scheduled multiplier first." };
        }
        const candidate = snapshot.feedPricePerUI * wadToNumber(snapshot.uiMultiplier);
        if (Math.abs(candidate / frozenPricePerRaw - 1) > snapshot.params.continuityBand) {
          return { ok: false, message: "The feed and multiplier fail the continuity check." };
        }
        enterRegime(resumeRegime);
        return { ok: true, message: "Continuity check passed. Borrowing resumed." };
      },
      setMultiplier(multiplier) {
        if (multiplier <= 0n || multiplier === snapshot.uiMultiplier) return;
        if (snapshot.regime !== "CORP_ACTION") enterRegime("CORP_ACTION");
        update({ uiMultiplier: multiplier, pendingMultiplier: null });
      },
      movePrice(change) {
        setFeedPrice(snapshot.feedPricePerUI * (1 + change));
      },
      setFeedPrice,
      runLiquidationBot() {
        const outcome = liquidationOutcome(snapshot);
        if (!outcome.liquidatable) return { ok: false, message: "Health factor has not fallen below 1." };
        update({ collateralRaw: snapshot.collateralRaw - outcome.seized, debt: snapshot.debt - outcome.repaid });
        return { ok: true, message: `Simulated liquidation. Debt repaid: ${outcome.repaid.toFixed(2)} ${snapshot.loanSymbol}.` };
      },
      reset() {
        resumeRegime = "OPEN";
        update(startingSnapshot());
      },
    },
  };
}
