import { wadToNumber } from "../../../src/lib/blue/client";

export const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;

export const hf = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "no debt");

export const units = (wad: bigint, d = 2) =>
  wadToNumber(wad).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
