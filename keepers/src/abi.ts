// All contract ABI fragments live here. Source of truth: protocol/src/*.sol (synced Nov 26 2026).
import { parseAbi } from "viem";

/** Regime enum, order matters (matches the Solidity enum). */
export const Regime = {
  OPEN: 0,
  EXTENDED: 1,
  CLOSED: 2,
  WEEKEND: 3,
  HALTED: 4,
  CORP_ACTION: 5,
} as const;
export type RegimeName = keyof typeof Regime;
export type RegimeId = (typeof Regime)[RegimeName];

export const REGIME_NAMES: RegimeName[] = ["OPEN", "EXTENDED", "CLOSED", "WEEKEND", "HALTED", "CORP_ACTION"];

/** Conservativeness rank: OPEN < EXTENDED < CLOSED < WEEKEND < CORP_ACTION < HALTED. */
const RANK: Record<RegimeName, number> = {
  OPEN: 0,
  EXTENDED: 1,
  CLOSED: 2,
  WEEKEND: 3,
  CORP_ACTION: 4,
  HALTED: 5,
};
export const conservativeness = (r: RegimeName): number => RANK[r];
export const moreConservative = (a: RegimeName, b: RegimeName): RegimeName => (RANK[a] >= RANK[b] ? a : b);
export const regimeName = (id: number): RegimeName => {
  const n = REGIME_NAMES[id];
  if (!n) throw new Error(`unknown regime id ${id}`);
  return n;
};

export const regimeRegistryAbi = parseAbi([
  "function regime(address asset) view returns (uint8)",
  "function calendarRegime() view returns (uint8)",
  "function calendarRegimeAt(uint256 ts) view returns (uint8)",
  "function overrideOf(address asset) view returns (uint8 state, uint64 expiry)",
  "function MAX_OVERRIDE() view returns (uint64)",
  "function keeperCanClear() view returns (bool)",
  "function isKeeper(address) view returns (bool)",
  "function admin() view returns (address)",
  "function pendingAdmin() view returns (address)",
  // KEEPER or ADMIN. r != OPEN, 0 < duration <= MAX_OVERRIDE; while one is active the new one must be
  // at least as conservative and must not expire earlier. asset = address(0) is a global override.
  "function setOverride(address asset, uint8 r, uint64 duration)",
  // ADMIN always; KEEPER only when keeperCanClear is true.
  "function clearOverride(address asset)",
  "function setKeeperCanClear(bool enabled)",
  "event OverrideSet(address indexed asset, uint8 r, uint64 expiry, address by)",
  "event OverrideCleared(address indexed asset, address by)",
]);

export const dawnOracleAbi = parseAbi([
  "function price() view returns (uint256)",
  "function priceForRegime(uint8 r) view returns (uint256)",
  "function lastGoodPrice() view returns (uint256)",
  "function lastGoodAt() view returns (uint64)",
  "function lastMultiplier() view returns (uint256)",
  "function frozenSince() view returns (uint64)",
  "function frozenRegime() view returns (uint8)",
  "function isFrozen() view returns (bool)",
  "function haircutBps(uint8 r) view returns (uint16)",
  "function liveRawPrice() view returns (bool ok, uint256 rawPrice, uint256 observedAt)",
  // Permissionless heartbeat: records price, freezes or unfreezes. Returns lastGoodPrice (pre-haircut).
  "function update() returns (uint256)",
  "event Frozen(uint64 at)",
  "event Unfrozen(uint256 price)",
  "event PriceRecorded(uint256 rawPrice, uint64 observedAt, uint256 multiplier)",
]);

// 3-arg event, matching the real bStock SecuritiesToken and MockBStock.
export const bStockAbi = parseAbi([
  "function uiMultiplier() view returns (uint256)",
  "function balanceOfUI(address) view returns (uint256)",
  "event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAt)",
]);

export const atlasFeedAbi = parseAbi([
  "function latestAnswer() view returns (int256)",
  "function latestTimestamp() view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

// MockBStock (owner only). setUIMultiplier requires block.timestamp <= effectiveAt <= now + 365d.
export const mockBStockAbi = parseAbi([
  "function setUIMultiplier(uint256 newMultiplier, uint256 effectiveAt)",
  "function setUIMultiplierNow(uint256 newMultiplier)",
  "function uiMultiplier() view returns (uint256)",
  "function pendingMultiplier() view returns (uint256 multiplier, uint256 effectiveAt)",
  "function hasPendingMultiplier() view returns (bool)",
  "function mint(address to, uint256 amount)",
]);

// MockAtlasFeed (owner only).
export const mockAtlasFeedAbi = parseAbi([
  "function setAnswer(int256 answer)",
  "function setAnswerAt(int256 answer, uint256 timestamp)",
  "function setReverting(bool on)",
  "function latestAnswer() view returns (int256)",
]);

// Morpho Blue singleton (subset). Borrow event and liquidate are from morpho-blue IMorpho / Events.
export const MORPHO_BLUE_BSC = "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a" as const;

export const morphoAbi = parseAbi([
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function liquidate((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, address borrower, uint256 seizedAssets, uint256 repaidShares, bytes data) returns (uint256, uint256)",
  "event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)",
]);

// protocol/src/LiquidatorCallback.sol (owner-only entry point; Morpho calls back into onMorphoLiquidate).
export const liquidatorCallbackAbi = parseAbi([
  "function liquidate((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) params, address borrower, uint256 seizedAssets, uint256 repaidShares, address swapper, bytes swapData) returns (uint256 seized, uint256 repaid)",
  "function owner() view returns (address)",
]);

export const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
