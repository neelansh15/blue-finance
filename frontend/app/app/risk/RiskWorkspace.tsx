"use client";

import { useState } from "react";
import { ReadStatus } from "../live/LiveParts";
import { useBlueState } from "../live/useBlueLive";
import { STOCKS, isStockId, type StockId } from "../markets";
import {
  accountStock, borrowGate, borrowLtv, formatAmount, formatBps, formatHealth, formatUsd, liveRiskPosition, liveStock,
  position, statusLabel, stockCap,
} from "../../../src/lib/blue/live-position";
import StockRiskTable from "./StockRiskTable";
import RiskPanel from "./RiskPanel";

export default function RiskWorkspace() {
  const query = useBlueState();
  const data = query.data;
  const [picked, setPicked] = useState<StockId | null>(null);
  const stock = picked ?? (data && accountStock(data)?.id) ?? "NVDAB";
  const market = data ? liveStock(data, stock) : undefined;
  const held = data?.account && market ? position(data, market) : undefined;
  const risk = data ? liveRiskPosition(data, stock) : undefined;

  return <main id="app-main" tabIndex={-1}>
    <section className="app-masthead"><div className="wrap">
      <p className="app-demo-label">BNB Mainnet contract metrics · synthetic advisory scenarios</p>
      <div className="app-heading"><h1>Understand <em>your risk.</em></h1></div>
      <p>Read your position and each market’s borrowing checks from the contracts, then compare them with synthetic advisory scenarios.</p>
      <ReadStatus query={query} />
    </div></section>
    <div className="wrap risk-workspace">
      <section className="stock-risk" aria-labelledby="onchain-risk-title">
        <div className="stock-risk-heading">
          <div><p className="app-demo-label">Onchain</p><h2 id="onchain-risk-title">Borrowing checks by market</h2>
            <p>Live reads from the oracle, market calendar and borrow controls.</p></div>
        </div>
        <div className="risk-table-scroll" tabIndex={0} role="region" aria-label="Onchain market risk table">
          <table className="risk-table">
            <thead><tr><th scope="col">Stock</th><th scope="col">Oracle price</th><th scope="col">Status</th><th scope="col">Borrow LTV</th>
              <th scope="col">Liq. threshold</th><th scope="col">Debt / cap (USDT)</th><th scope="col">New borrowing</th></tr></thead>
            <tbody>{STOCKS.map(item => {
              const row = data ? liveStock(data, item.id) : undefined;
              const gate = data && row ? borrowGate(data, row) : undefined;
              return <tr key={item.id}>
                <th scope="row">{item.symbol}</th>
                <td>{row ? formatUsd(row.price) : "—"}</td>
                <td>{row ? statusLabel(row) : "—"}</td>
                <td>{row ? formatBps(borrowLtv(row)) : "—"}</td>
                <td>{row ? formatBps(row.liquidationThreshold) : "—"}</td>
                <td>{row ? `${formatAmount(row.debt)} / ${formatAmount(stockCap(row).cap)}${stockCap(row).fromLaunch ? " (launch)" : ""}` : "—"}</td>
                <td>{!row ? "—" : gate ?? "Open to eligible wallets"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <label htmlFor="risk-market">Collateral stock</label>{" "}
      <select id="risk-market" value={stock} onChange={e => isStockId(e.target.value) && setPicked(e.target.value)}>
        {STOCKS.map(m => <option key={m.id} value={m.id}>{m.symbol} / USDT</option>)}
      </select>
      {held ? <dl className="risk-metrics">
        <div><dt>Collateral</dt><dd>{formatAmount(held.collateral)} {stock}</dd></div>
        <div><dt>Collateral value</dt><dd>{formatUsd(held.collateralValue)}</dd></div>
        <div><dt>Debt</dt><dd>{formatAmount(held.debt)} USDT</dd></div>
        <div><dt>Health factor</dt><dd>{formatHealth(held.healthFactor)}</dd></div>
        <div><dt>Borrow limit</dt><dd>{formatUsd(held.borrowLimit)}</dd></div>
        <div><dt>Liquidation price</dt><dd>{held.liquidationPrice === null ? "None" : formatUsd(held.liquidationPrice)}</dd></div>
      </dl> : <p>Connect a wallet to see your onchain position.</p>}

      <StockRiskTable />
      {risk && <RiskPanel key={`${risk.symbol}-${risk.quantity.toFixed(4)}-${risk.debtUsd.toFixed(0)}-${risk.unsupported ?? ""}`} position={risk} live />}
    </div>
  </main>;
}
