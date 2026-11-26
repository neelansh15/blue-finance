import { CENTS_PER_USDT } from "./markets";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const quantity = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
export const money = (cents: number) => dollars.format(cents / CENTS_PER_USDT);
export const health = (value: number | null) =>
  value === null ? "No debt" : Number.isNaN(value) ? "Paused (price unusable)" : `${value.toFixed(2)}×`;
export const percent = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
/** Borrow LTV such as 42.5% without trailing zeros. */
export const ltv = (value: number) => `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
