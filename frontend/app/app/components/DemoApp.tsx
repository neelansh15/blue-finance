"use client";

import { useEffect, useState } from "react";
import BorrowForm from "./BorrowForm";
import CorpActionBanner from "./CorpActionBanner";
import DemoPanel from "./DemoPanel";
import PositionCard from "./PositionCard";
import { useBlue } from "./useBlue";
import RiskPanel from "../risk/RiskPanel";
import { demoPosition } from "../../../src/lib/risk/adapter";
import type { StockId } from "../../../src/lib/blue/client";

export default function DemoApp() {
  const { client, state } = useBlue();
  const [dev, setDev] = useState(false);
  const [picked, setPicked] = useState<StockId>("NVDAB");
  // The account's collateral stock wins: one stock per account.
  const stock = state.account.stock ?? picked;

  // Hidden: ?dev=1 or Shift+D toggles the demo control panel.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("dev") === "1") setDev(true);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.shiftKey && e.key === "D") setDev((d) => !d);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const riskPosition = demoPosition(state);
  return (
    <main id="app-main" tabIndex={-1} className="wrap dapp">
      <h1 className="dapp-title">Blue demo</h1>
      <p className="dapp-sub">
        One Aave V3 pool with a shared USDT reserve. One stock per account as collateral. Mocked data, no transactions.
      </p>
      <CorpActionBanner state={state} stock={stock} />
      <div className={`dapp-grid${dev ? " dapp-grid-dev" : ""}`}>
        <PositionCard state={state} stock={stock} />
        <BorrowForm key={stock} state={state} stock={stock} client={client} />
        {dev && <DemoPanel state={state} demo={client.demo} initialStock={stock} onStock={setPicked} />}
      </div>
      <details className="risk-embedded">
        <summary>Assess this position with the risk backend</summary>
        <RiskPanel key={JSON.stringify(riskPosition)} position={riskPosition} />
      </details>
      <p className="illustrative dapp-foot">
        Developer controls: add ?dev=1 to the URL or press Shift+D. Not live, not audited.
      </p>
    </main>
  );
}
