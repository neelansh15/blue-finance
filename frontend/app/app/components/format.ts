import { CENTS_PER_USDT, TOKENS_PER_UNIT } from "../../../src/lib/blue/client";

/** USD from cents. */
export const usd = (cents: number) =>
  (cents / CENTS_PER_USDT).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;

export const hf = (n: number | null) => (n === null ? "no debt" : Number.isNaN(n) ? "paused" : n.toFixed(2));

/** Token amount from token units. */
export const units = (amount: number, d = 4) =>
  (amount / TOKENS_PER_UNIT).toLocaleString("en-US", { maximumFractionDigits: d });
