import { CENTS_PER_USDT } from "./markets";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const quantity = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
export const money = (cents: number) => dollars.format(cents / CENTS_PER_USDT);
export const health = (value: number | null) => value === null ? "No debt" : `${value.toFixed(2)}×`;
