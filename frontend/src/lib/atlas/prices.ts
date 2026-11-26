import type { Address } from "viem";

export const BSTOCK_FEEDS = {
  TSLAB: { name: "Tesla", token: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f", feed: "0xf569C3e52e797219eCFDc1659c3250B0BbDC693C" },
  NVDAB: { name: "NVIDIA", token: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", feed: "0x2bd759006b423BFF444181A13C96a6b134E557BB" },
  QQQB: { name: "Invesco QQQ", token: "0x205812CdBed920aFf76C6580abD681a46D11efc7", feed: "0xA94918f11c9e7703426CCD494A4a999924942DDD" },
  SPCXB: { name: "SpaceX", token: "0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1", feed: "0xdf8b61796436eD39F406623aa2166a7f185185Cb" },
  GOOGLB: { name: "Alphabet", token: "0x3F53De71c126BdaBAe20f9cD64848d317f6C3238", feed: "0x9A47A6560E224a26F663675D5c76888A26cac6C3" },
} as const satisfies Record<string, { name: string; token: Address; feed: Address }>;

export type BStockSymbol = keyof typeof BSTOCK_FEEDS;
export type AtlasPrice = { symbol: BStockSymbol; priceUsd: number; updatedAt: number };
export const PRICE_STALE_MS = 2 * 60 * 60 * 1000;

export async function fetchAtlasPrice(symbol: BStockSymbol): Promise<AtlasPrice> {
  const response = await fetch(`/api/atlas/prices/${symbol}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Atlas price unavailable");
  const price: AtlasPrice = await response.json();
  if (price.symbol !== symbol || !Number.isFinite(price.priceUsd) || price.priceUsd <= 0 ||
      !Number.isSafeInteger(price.updatedAt) || price.updatedAt <= 0 || price.updatedAt > Date.now() + 60_000) {
    throw new Error("Invalid Atlas observation");
  }
  return price;
}
