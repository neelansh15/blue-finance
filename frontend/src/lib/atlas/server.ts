import { createPublicClient, fallback, http, parseAbi } from "viem";
import { bsc } from "viem/chains";
import { ApiCache } from "../api-cache";
import { pricePerDisplayedShare } from "./scaled-ui";
import { BSTOCK_FEEDS, type AtlasPrice, type BStockSymbol } from "./prices";

const cache = new ApiCache<AtlasPrice>();
export function getAtlasPrice(symbol: BStockSymbol): Promise<AtlasPrice> {
  return cache.get(symbol, () => readAtlasPrice(symbol));
}

const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const tokenAbi = parseAbi(["function uiMultiplier() view returns (uint256)"]);

const client = createPublicClient({
  chain: bsc,
  transport: fallback([
    http("https://bsc-dataseed.binance.org", { timeout: 10000, retryCount: 0 }),
    http("https://bsc-dataseed1.defibit.io", { timeout: 10000, retryCount: 0 }),
  ]),
});

async function readAtlasPrice(symbol: BStockSymbol): Promise<AtlasPrice> {
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
