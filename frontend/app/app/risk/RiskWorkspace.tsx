"use client";

import { useState } from "react";
import { useDemoAccount } from "../DemoAccount";
import { STOCKS, isStockId, type StockId } from "../markets";
import { lendingPosition } from "../../../src/lib/risk/adapter";
import StockRiskTable from "./StockRiskTable";
import RiskPanel from "./RiskPanel";

export default function RiskWorkspace() {
  const { state } = useDemoAccount();
  const [picked, setPicked] = useState<StockId | null>(null);
  const stock = picked ?? state.account.stock ?? "NVDAB";
  const position = lendingPosition(state, stock);
  return <main id="app-main" tabIndex={-1}>
    <section className="app-masthead"><div className="wrap">
      <p className="app-demo-label">Advisory · simulation</p>
      <div className="app-heading"><h1>Understand <em>your risk.</em></h1></div>
      <p>Monitor stock health and risk drivers, then stress-test the position in your demo account.</p>
    </div></section>
    <div className="wrap risk-workspace">
      <StockRiskTable />
      <label htmlFor="risk-market">Collateral stock</label>{" "}
      <select id="risk-market" value={stock} onChange={e => isStockId(e.target.value) && setPicked(e.target.value)}>
        {STOCKS.map(m => <option key={m.id} value={m.id}>{m.symbol} / USDT</option>)}
      </select>
      <RiskPanel key={JSON.stringify(position)} position={position} />
    </div>
  </main>;
}
