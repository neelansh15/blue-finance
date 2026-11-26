import type { Address } from "viem";

export const BSTOCK_FEEDS = {
  NVDAB: { name: "NVIDIA", token: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", feed: "0x2bd759006b423BFF444181A13C96a6b134E557BB" },
  TSLAB: { name: "Tesla", token: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f", feed: "0xf569C3e52e797219eCFDc1659c3250B0BbDC693C" },
  AAPLB: { name: "Apple", token: "0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A", feed: "0x5AfB6E8B04A63e6075620397520399ca9ffE7C05" },
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
