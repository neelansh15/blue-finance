// App-facing view of the simulated Blue pool. The model lives in src/lib/blue/pool.ts.

export {
  ACTIONS, BORROWING_DISCOUNT, CENTS_PER_USDT, MARKET_STATUSES, RISK, SCHEDULED_STATUSES, STATUS_LABEL, STOCKS,
  TOKENS_PER_UNIT, actionLimits, executeAction, borrowLtv, collateralValue, isStockId, poolMetrics, positionMetrics, stockById,
  stockBorrowCap, stockStatus, statusNotice,
  type Action, type ActionLimit, type MarketStatus, type PoolState, type ScheduledStatus, type Stock, type StockId,
} from "../../src/lib/blue/pool";



/** Parses a decimal string into integer units (cents or token units). Returns 0 when invalid. */
export function parseAmount(value: string, scale: number) {
  if (!/^\d*(\.\d*)?$/.test(value) || (value.split(".")[1]?.length ?? 0) > Math.log10(scale)) return 0;
  const amount = Math.round(Number(value) * scale);
  return Number.isSafeInteger(amount) ? amount : 0;
}
