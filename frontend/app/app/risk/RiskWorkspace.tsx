"use client";

import { useState } from "react";
import { useDemoAccount } from "../DemoAccount";
import { MARKETS, type MarketId } from "../markets";
import { lendingPosition } from "../../../src/lib/risk/adapter";
import RiskPanel from "./RiskPanel";

export default function RiskWorkspace() {
  const { positions } = useDemoAccount();
  const [marketId, setMarketId] = useState<MarketId>("NVDAB");
  const market = MARKETS.find(m => m.id === marketId)!;
  const position = lendingPosition(market, positions[market.id]);
  return <main id="app-main" tabIndex={-1}>
    <section className="app-masthead"><div className="wrap">
      <p className="app-demo-label">Advisory · simulation</p>
      <div className="app-heading"><h1>Understand <em>your risk.</em></h1></div>
      <p>Review risk recommendations and stress-test the positions in your demo account.</p>
    </div></section>
    <div className="wrap risk-workspace">
      <label htmlFor="risk-market">Collateral market</label>{" "}
      <select id="risk-market" value={marketId} onChange={e => setMarketId(e.target.value as MarketId)}>
        {MARKETS.map(m => <option key={m.id} value={m.id}>{m.symbol} / USDT</option>)}
      </select>
      <RiskPanel key={JSON.stringify(position)} position={position} />
    </div>
  </main>;
}
