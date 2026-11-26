import { erc20Abi, getAddress, parseAbi, parseUnits, type Address } from "viem";
import deployment from "./bsc-mainnet.json";
import { STOCKS } from "./pool";

export const BSC_RPC_URL = process.env.NEXT_PUBLIC_BSC_RPC_URL?.trim() || "https://bsc-rpc.publicnode.com";

const { chainId, stocks, ...addresses } = deployment;
export const BLUE = Object.fromEntries(
  Object.entries(addresses).map(([name, address]) => [name, getAddress(address)]),
) as Record<keyof typeof addresses, Address>;

export const liveStocks = STOCKS.map(stock => ({
  ...stock,
  address: getAddress(stocks[stock.id].token),
  source: getAddress(stocks[stock.id].source),
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

export const tokenContract = (address: Address) => ({ address, abi: erc20Abi });

export const eligibilityDomain = {
  name: "Blue Stock Borrow Controls",
  version: "1",
  chainId,
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
