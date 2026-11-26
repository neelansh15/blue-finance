import { CENTS_PER_USDT, TOKENS_PER_UNIT, type Market, type Position } from "../../../app/app/markets";
import { wadToNumber, type BlueSnapshot } from "../blue/math";
import type { RiskRequest, Scenario } from "./contracts";

export type RiskPosition = { symbol: string; quantity: number; debtUsd: number; uiPriceUsd: number; unsupported?: string };

export function lendingPosition(market: Market, position: Position): RiskPosition {
  return { symbol: market.id, quantity: position.collateral / TOKENS_PER_UNIT, debtUsd: position.debt / CENTS_PER_USDT,
    uiPriceUsd: market.price / CENTS_PER_USDT,
    ...(market.id !== "NVDAB" ? { unsupported: "The risk backend currently supports NVDAb only. This market is not assessed." } : {}) };
}

export function demoPosition(s: BlueSnapshot): RiskPosition {
  return { symbol: "NVDAB", quantity: wadToNumber(s.collateralRaw) * wadToNumber(s.uiMultiplier),
    debtUsd: s.debt, uiPriceUsd: s.feedPricePerUI,
    ...(s.symbol.toUpperCase() !== "NVDAB" ? { unsupported: "The risk backend currently supports NVDAb only." } :
      s.regime === "CORP_ACTION" || s.regime === "HALTED" || s.frozenPricePerRaw !== null
      ? { unsupported: "This position is halted or frozen. Split continuity and frozen prices require a dedicated backend adapter; no assessment is available." } : {}) };
}

export function requestForPosition(position: RiskPosition, scenario: Scenario): RiskRequest {
  if (position.unsupported || ![position.quantity, position.debtUsd].every(n => Number.isFinite(n) && n >= 0))
    throw new Error(position.unsupported || "Invalid demo position.");
  if (position.quantity === 0 && position.debtUsd > 0) throw new Error("Debt without collateral cannot be assessed by this simulator.");
  return { scenario, borrowers: position.quantity > 0 ? [{ borrower_id: "demo-position", collateral_quantity: position.quantity,
    debt_usd: position.debtUsd, liquidation_threshold: .625 }] : [] };
}
