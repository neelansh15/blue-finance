import { erc20Abi, parseAbi, parseUnits, type Address } from "viem";
import demoDeployment from "./demo-deployment.json";
import { STOCKS } from "./pool";

export const BSC_RPC_URL = process.env.NEXT_PUBLIC_BSC_RPC_URL?.trim() || "https://bsc-rpc.publicnode.com";

/** The live pool, with the real bStocks and USDT. Do not change these when working on the demo. */
const REAL = {
  pool: "0xDAC47642621B0C3E4191Fe68281EddAC355f12bC",
  provider: "0x1AfE5e07f6c6f092494DA8423708c412939B6906",
  dataProvider: "0xa7db8d9e04c466126d58379fcfab2ae0f26a7643",
  controls: "0x9F80DEe6652798855133358a382264986C2A5d4D",
  calendar: "0x33CcEcEDA8f2f47BdE9f234FF025977aeB292B17",
  oracle: "0x727D5D5001717e7F5fAC98c5b134B27487192e4d",
  usdt: "0x55d398326f99059fF775485246999027B3197955",
  usdtSource: "0xe3329b970Acf9545496786B77aa73639E3F4b489",
  /** Token, then price source. */
  stocks: {
    TSLAB: ["0x5b1910eAaD6450E50f816082Aa078C41F10C292f", "0x2162Ba3A993BC8442CEE02340693D1818bbB6826"],
    NVDAB: ["0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", "0xE28c1AFf5549CBAD6e7Dfb09C7446CC8EDA6Cb3D"],
    QQQB: ["0x205812CdBed920aFf76C6580abD681a46D11efc7", "0xC0a4c6fb4dF398c64B48b19898e5BE1375a83c67"],
    SPCXB: ["0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1", "0x57569eEDA113AF59BFcEfd549610AF6692fD0772"],
    GOOGLB: ["0x3F53De71c126BdaBAe20f9cD64848d317f6C3238", "0x289Ae6026ae1a9E02fC4dC964861e72473E5f28e"],
  },
} as const;

type Deployment = Record<Exclude<keyof typeof REAL, "stocks">, Address> & {
  stocks: Record<keyof typeof REAL.stocks, readonly Address[]>;
};

// protocol/script/deploy-demo.sh writes this file. It holds null until the demo pool exists.
const demo = demoDeployment as unknown as Deployment | null;

/** The app uses the demo pool (our own test tokens, same price feeds) unless NEXT_PUBLIC_BLUE_DEPLOYMENT=real. */
export const IS_DEMO = demo !== null && process.env.NEXT_PUBLIC_BLUE_DEPLOYMENT?.trim() !== "real";

export const BLUE: Deployment = IS_DEMO ? demo! : REAL;

export const liveStocks = STOCKS.map(stock => ({
  ...stock,
  address: BLUE.stocks[stock.id][0],
  source: BLUE.stocks[stock.id][1],
}));

export const poolContract = {
  address: BLUE.pool,
  abi: parseAbi([
    "function getVirtualUnderlyingBalance(address asset) view returns (uint128)",
    "function getReservesList() view returns (address[])",
    "function getUserAccountData(address account) view returns (uint256 collateral, uint256 debt, uint256 available, uint256 threshold, uint256 ltv, uint256 healthFactor)",
    "function stockDebt(address stock) view returns (uint256)",
    "function debtStock(address account) view returns (address)",
    "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
    "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
    "function borrow(address asset, uint256 amount, uint256 rateMode, uint16 referralCode, address onBehalfOf)",
    "function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)",
    "function setUserUseReserveAsCollateral(address asset, bool enabled)",
    "error OneStockRequired()",
    "error StockDebtCapExceeded()",
    "error NewRiskBlocked(address stock)",
    "error Ineligible(address account, address stock)",
    "error AboveStockLtv()",
    "error UnsupportedDebtAsset()",
    "error SupplyCapExceeded()",
    "error BorrowCapExceeded()",
    "error DebtCeilingExceeded()",
    "error HealthFactorLowerThanLiquidationThreshold()",
    "error CollateralCannotCoverNewBorrow()",
    "error NotEnoughAvailableUserBalance()",
    "error ReservePaused()",
    "error ReserveFrozen()",
  ]),
} as const;

export const controlsContract = {
  address: BLUE.controls,
  abi: parseAbi([
    "function keeper() view returns (address)",
    "function signer() view returns (address)",
    "function nonces(address account) view returns (uint256)",
    "function eligibleUntil(address account, address stock) view returns (uint256)",
    "function eligibilityDigest(address account, address stock, uint256 nonce, uint256 expiry) view returns (bytes32)",
    "function riskLimits(address stock) view returns (uint256 ltv, uint256 cap)",
    "function withdrawLimit(address stock) view returns (uint256 ltv)",
    "function report(address stock, bool healthy)",
    "function registerEligibility(address stock, uint256 expiry, bytes signature)",
    "error NewRiskBlocked(address stock)",
    "error InvalidEligibility()",
  ]),
} as const;

export const calendarContract = {
  address: BLUE.calendar,
  abi: parseAbi(["function status(address stock) view returns (uint8)"]),
} as const;

export const oracleContract = {
  address: BLUE.oracle,
  abi: parseAbi(["function getAssetPrice(address asset) view returns (uint256)"]),
} as const;

export const dataProviderContract = {
  address: BLUE.dataProvider,
  abi: parseAbi([
    "function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
    "function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)",
    "function getPaused(address asset) view returns (bool isPaused)",
    "function getReserveCaps(address asset) view returns (uint256 borrowCap, uint256 supplyCap)",
    "function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)",
  ]),
} as const;

export const priceSourceAbi = parseAbi([
  "function refresh()",
  "function usableForBorrow() view returns (bool)",
  "error UnusablePrice()",
  "error DiscontinuousPrice()",
]);

export const stockTokenAbi = parseAbi(["function uiMultiplier() view returns (uint256)"]);

/** Custom errors the stock tokens revert with. */
export const tokenErrorAbi = parseAbi([
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
]);

export const tokenContract = (address: Address) => ({ address, abi: erc20Abi });

export const eligibilityDomain = {
  name: "Blue Stock Borrow Controls",
  version: "1",
  chainId: 56,
  verifyingContract: BLUE.controls,
} as const;

export const eligibilityTypes = {
  Eligibility: [
    { name: "account", type: "address" },
    { name: "pool", type: "address" },
    { name: "stock", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export function parseTokenAmount(value: string): bigint | undefined {
  if (!/^\d+(\.\d{1,18})?$/.test(value) || value.length > 80) return undefined;
  const amount = parseUnits(value, 18);
  return amount > 0n && amount < 2n ** 256n ? amount : undefined;
}
