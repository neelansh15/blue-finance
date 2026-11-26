"use client";

import { useEffect, useState } from "react";
import { BSTOCK_FEEDS, fetchAtlasPrice, PRICE_STALE_MS, type AtlasPrice, type BStockSymbol } from "../../src/lib/atlas/prices";
import TokenIcon from "./TokenIcon";

const symbols = Object.keys(BSTOCK_FEEDS) as BStockSymbol[];
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
type PriceState = { price?: AtlasPrice; unavailable?: boolean };

export default function BStockPrices() {
  const [prices, setPrices] = useState<Partial<Record<BStockSymbol, PriceState>>>({});
  const [now, setNow] = useState(0);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const results = await Promise.allSettled(symbols.map(fetchAtlasPrice));
      if (!active) return;
      setNow(Date.now());
      setPrices(previous => {
        const next = { ...previous };
        results.forEach((result, index) => {
          const symbol = symbols[index];
          next[symbol] = result.status === "fulfilled"
            ? { price: result.value }
            : { ...previous[symbol], unavailable: true };
        });
        return next;
      });
    }
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return (
    <div className="stock-strip">
      <p id="stock-examples">bStock prices · Atlas</p>
      <ul aria-labelledby="stock-examples">
        {symbols.map(symbol => {
          const state = prices[symbol];
          const price = state?.price;
          const stale = price && (state?.unavailable || now - price.updatedAt > PRICE_STALE_MS);
          const updated = price && new Date(price.updatedAt).toLocaleString(undefined, {
            dateStyle: "medium", timeStyle: "short",
          });
          return (
            <li key={symbol}>
              <TokenIcon symbol={symbol} />
              <span>
                <strong>{BSTOCK_FEEDS[symbol].name}</strong>
                <small>{symbol} · {price ? currency.format(price.priceUsd) : state?.unavailable ? "Unavailable" : "Loading…"}</small>
                {price && <small>{stale ? "Stale · " : ""}Updated {updated}</small>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
