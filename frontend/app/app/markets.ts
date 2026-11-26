import { ILLUSTRATIVE_HAIRCUT, type Regime } from "../components/regimes";

export const TOKENS_PER_UNIT = 10_000;
export const CENTS_PER_USDT = 100;

export const MARKETS = [
  { id: "NVDAB", symbol: "NVDAb", name: "NVIDIA", price: 20_000, maxLtv: 0.50, liquidationLtv: 0.625, liquidity: 120_000_000, borrowApr: 5.2, supplyApr: 3.1, balance: 40 * TOKENS_PER_UNIT },
  { id: "QQQB", symbol: "QQQb", name: "Invesco QQQ", price: 51_000, maxLtv: 0.57, liquidationLtv: 0.70, liquidity: 85_000_000, borrowApr: 4.4, supplyApr: 2.6, balance: 20 * TOKENS_PER_UNIT },
  { id: "SPCXB", symbol: "SPCXb", name: "SpaceX", price: 13_000, maxLtv: 0.44, liquidationLtv: 0.55, liquidity: 42_000_000, borrowApr: 7.1, supplyApr: 4.2, balance: 60 * TOKENS_PER_UNIT },
] as const;

export type Market = (typeof MARKETS)[number];
export type MarketId = Market["id"];
export type Position = { collateral: number; debt: number; supplied: number };
export type Positions = Record<MarketId, Position>;

export const STARTING_POSITIONS: Positions = {
  NVDAB: { collateral: 10 * TOKENS_PER_UNIT, debt: 35_000, supplied: 0 },
  QQQB: { collateral: 0, debt: 0, supplied: 50_000 },
  SPCXB: { collateral: 0, debt: 0, supplied: 0 },
};

export const ACTIONS = {
  deposit: { label: "Supply collateral", collateral: true },
  borrow: { label: "Borrow USDT", collateral: false },
  repay: { label: "Repay USDT", collateral: false },
  withdraw: { label: "Withdraw collateral", collateral: true },
  lend: { label: "Supply USDT", collateral: false },
  redeem: { label: "Withdraw USDT", collateral: false },
} as const;

export type Action = keyof typeof ACTIONS;

export function liquidity(market: Market, position: Position) {
  return market.liquidity + position.supplied - position.debt;
}

export function collateralValue(market: Market, position: Position) {
  return position.collateral * market.price / TOKENS_PER_UNIT;
}

export function marketMetrics(market: Market, position: Position, regime: Regime) {
  const adjusted = collateralValue(market, position) * (1 - ILLUSTRATIVE_HAIRCUT[regime]);
  const limit = Math.floor(adjusted * market.maxLtv);
  return {
    available: Math.max(0, Math.min(limit - position.debt, liquidity(market, position))),
    health: position.debt > 0 ? adjusted * market.liquidationLtv / position.debt : null,
  };
}

export function walletUsdt(positions: Positions) {
  return Object.values(positions).reduce(
    (balance, position) => balance + position.debt - position.supplied, 515_000,
  );
}

export function actionMaximum(action: Action, market: Market, position: Position, regime: Regime, wallet: number) {
  switch (action) {
    case "deposit": return market.balance - position.collateral;
    case "borrow": return marketMetrics(market, position, regime).available;
    case "repay": return Math.min(position.debt, wallet);
    case "withdraw": {
      const limitPerUnit = market.price * (1 - ILLUSTRATIVE_HAIRCUT[regime]) * market.maxLtv / TOKENS_PER_UNIT;
      return Math.max(0, position.collateral - Math.ceil(position.debt / limitPerUnit));
    }
    case "lend": return wallet;
    case "redeem": return Math.min(position.supplied, liquidity(market, position));
  }
}

export function applyAction(position: Position, action: Action, amount: number): Position {
  switch (action) {
    case "deposit": return { ...position, collateral: position.collateral + amount };
    case "withdraw": return { ...position, collateral: position.collateral - amount };
    case "borrow": return { ...position, debt: position.debt + amount };
    case "repay": return { ...position, debt: position.debt - amount };
    case "lend": return { ...position, supplied: position.supplied + amount };
    case "redeem": return { ...position, supplied: position.supplied - amount };
  }
}

export function parseAmount(value: string, scale: number) {
  if (!/^\d*(\.\d*)?$/.test(value) || (value.split(".")[1]?.length ?? 0) > Math.log10(scale)) return 0;
  const amount = Math.round(Number(value) * scale);
  return Number.isSafeInteger(amount) ? amount : 0;
}

export function accountTotals(positions: Positions) {
  return MARKETS.reduce((total, market) => ({
    collateral: total.collateral + collateralValue(market, positions[market.id]),
    debt: total.debt + positions[market.id].debt,
    supplied: total.supplied + positions[market.id].supplied,
  }), { collateral: 0, debt: 0, supplied: 0 });
}
