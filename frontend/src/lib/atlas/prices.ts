import { createPublicClient, fallback, http, parseAbi, type Address } from "viem";
import { bsc } from "viem/chains";
import { pricePerDisplayedShare } from "./scaled-ui";

export const BSTOCK_FEEDS = {
  NVDAB: { name: "NVIDIA", token: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", feed: "0x2bd759006b423BFF444181A13C96a6b134E557BB" },
  TSLAB: { name: "Tesla", token: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f", feed: "0xf569C3e52e797219eCFDc1659c3250B0BbDC693C" },
  AAPLB: { name: "Apple", token: "0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A", feed: "0x5AfB6E8B04A63e6075620397520399ca9ffE7C05" },
} as const satisfies Record<string, { name: string; token: Address; feed: Address }>;

export type BStockSymbol = keyof typeof BSTOCK_FEEDS;
export type AtlasPrice = { symbol: BStockSymbol; priceUsd: number; updatedAt: number };
export const PRICE_STALE_MS = 2 * 60 * 60 * 1000;

const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const tokenAbi = parseAbi(["function uiMultiplier() view returns (uint256)"]);

const client = createPublicClient({
  chain: bsc,
  transport: fallback([
    http("https://bsc-dataseed.binance.org", { timeout: 10000 }),
    http("https://bsc-dataseed1.defibit.io", { timeout: 10000 }),
  ]),
});

export async function fetchAtlasPrice(symbol: BStockSymbol): Promise<AtlasPrice> {
  const { token, feed } = BSTOCK_FEEDS[symbol];
  const [round, decimals, multiplier] = await Promise.all([
    client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "uiMultiplier" }),
  ]);
  const [roundId, answer, , updatedAt, answeredInRound] = round;
  const timestamp = Number(updatedAt) * 1000;
  if (updatedAt === 0n || answeredInRound < roundId || !Number.isSafeInteger(timestamp) || timestamp > Date.now() + 60_000) {
    throw new Error("Invalid Atlas observation");
  }
  return { symbol, priceUsd: pricePerDisplayedShare(answer, decimals, multiplier), updatedAt: timestamp };
}
