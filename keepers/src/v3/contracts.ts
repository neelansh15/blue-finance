import { getAddress, parseAbi } from "viem";
import deployment from "../../../frontend/src/lib/blue/bsc-mainnet.json";

export const chainId = deployment.chainId;
export const pool = getAddress(deployment.pool);
export const usdtSource = getAddress(deployment.usdtSource);
export const stocks = Object.entries(deployment.stocks).map(([symbol, asset]) => ({
  symbol, ticker: asset.ticker, token: getAddress(asset.token), source: getAddress(asset.source),
}));

export const controls = {
  address: getAddress(deployment.controls),
  abi: parseAbi([
    "function keeper() view returns (address)",
    "function signer() view returns (address)",
    "function heartbeat() view returns (uint32)",
    "function maxEligibility() view returns (uint32)",
    "function nonces(address account) view returns (uint256)",
    "function eligibilityDigest(address account, address stock, uint256 nonce, uint256 expiry) view returns (bytes32)",
    "function report(address stock, bool healthy)",
    "error NewRiskBlocked(address stock)",
  ]),
} as const;

export const calendar = {
  address: getAddress(deployment.calendar),
  abi: parseAbi([
    "function status(address stock) view returns (uint8)",
    "function isKeeper(address user) view returns (bool)",
    "function overrideOf(address stock) view returns (uint8 state, uint64 expiry)",
    "function setOverride(address stock, uint8 status, uint64 duration)",
  ]),
} as const;

export const sourceAbi = parseAbi([
  "function reporter() view returns (address)",
  "function refresh()",
  "function usableForBorrow() view returns (bool)",
  "function multiplier() view returns (uint256)",
  "error InvalidRound()",
  "error UnusablePrice()",
  "error DiscontinuousPrice()",
]);

export const stockAbi = parseAbi(["function uiMultiplier() view returns (uint256)"]);

export const domain = {
  name: "Blue Stock Borrow Controls",
  version: "1",
  chainId,
  verifyingContract: controls.address,
} as const;

export const types = {
  Eligibility: [
    { name: "account", type: "address" },
    { name: "pool", type: "address" },
    { name: "stock", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;
