import {
  CENTS_PER_USDT, RISK, TOKENS_PER_UNIT, stockStatus, valuationCheck, type PoolState, type StockId,
} from "../blue/pool";
import type { RiskRequest, Scenario } from "./contracts";

export type RiskPosition = { symbol: string; quantity: number; debtUsd: number; uiPriceUsd: number; unsupported?: string };

/** The demo account's position against `stock`, in displayed units for the advisory backend (NVDAB only). */
export function lendingPosition(state: PoolState, stock: StockId): RiskPosition {
  const s = state.stocks[stock];
  const account = state.account;
  const held = account.stock === stock;
  const status = stockStatus(state, stock);
  const base = {
    symbol: stock,
    quantity: held ? account.collateral / TOKENS_PER_UNIT * s.multiplier : 0,
    debtUsd: held ? account.debt / CENTS_PER_USDT : 0,
    uiPriceUsd: s.price / CENTS_PER_USDT / s.multiplier,
  };
  if (stock !== "NVDAB") return { ...base, unsupported: "The risk backend currently supports NVDAB only. This stock is not assessed." };
  if (status === "HALTED" || status === "CORP_ACTION" || !valuationCheck(state, stock).usable) {
    return { ...base, unsupported: "NVDAB is halted, in a corporate action, or has no usable price. No assessment is available until pricing resumes." };
  }
  return base;
}

/** Position for the account's collateral stock (NVDAB when the account has none). */
export function demoPosition(state: PoolState): RiskPosition {
  return lendingPosition(state, state.account.stock ?? "NVDAB");
}

export function requestForPosition(position: RiskPosition, scenario: Scenario): RiskRequest {
  if (position.unsupported || ![position.quantity, position.debtUsd].every(n => Number.isFinite(n) && n >= 0))
    throw new Error(position.unsupported || "Invalid demo position.");
  if (position.quantity === 0 && position.debtUsd > 0) throw new Error("Debt without collateral cannot be assessed by this simulator.");
  return { scenario, borrowers: position.quantity > 0 ? [{ borrower_id: "demo-position", collateral_quantity: position.quantity,
    debt_usd: position.debtUsd, liquidation_threshold: RISK.liquidationThreshold }] : [] };
}
