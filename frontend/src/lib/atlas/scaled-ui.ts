import { formatUnits } from "viem";

const WAD = 10n ** 18n;

/** Convert an Atlas price per raw token into a price per displayed share. */
export function pricePerDisplayedShare(answer: bigint, feedDecimals: number, multiplier: bigint): number {
  if (answer <= 0n || multiplier <= 0n || !Number.isInteger(feedDecimals) || feedDecimals < 0 || feedDecimals > 36) {
    throw new Error("Invalid price or display multiplier");
  }
  const price = Number(formatUnits(answer, feedDecimals)) / Number(formatUnits(multiplier, 18));
  if (!Number.isFinite(price) || price <= 0) throw new Error("Price is outside the supported range");
  return price;
}

export function rawToDisplayed(rawAmount: bigint, multiplier: bigint): bigint {
  if (rawAmount < 0n || multiplier <= 0n) throw new Error("Invalid balance or display multiplier");
  return rawAmount * multiplier / WAD;
}
