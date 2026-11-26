"use client";

import Link from "next/link";
import { useState } from "react";
import TokenIcon from "../../components/TokenIcon";
import LiveApp from "../LiveApp";

export default function LiveSimplified() {
  const [choice, setChoice] = useState<"earn" | "borrow">();

  if (choice) return <LiveApp key={choice} view={choice} onBack={() => setChoice(undefined)} />;

  return (
    <main id="app-main" tabIndex={-1}>
      <section className="simple-masthead">
        <div className="wrap">
          <h1>Simplified Mode</h1>
          <p>Supply or borrow on BNB Smart Chain.</p>
        </div>
      </section>
      <section className="wrap simple-stage" aria-labelledby="simple-action">
        <h2 id="simple-action">Choose an action</h2>
        <div className="simple-choices">
          <button className="simple-choice" type="button" onClick={() => setChoice("borrow")}>
            <span className="simple-choice-icon"><TokenIcon symbol="TSLAB" size={32} /></span>
            <strong>Borrow</strong>
            <span>Use a tokenized stock as collateral to borrow USDT.</span>
          </button>
          <button className="simple-choice" type="button" onClick={() => setChoice("earn")}>
            <span className="simple-choice-icon"><TokenIcon symbol="USDT" size={32} /></span>
            <strong>Supply</strong>
            <span>Supply USDT to the shared pool and receive bluUSDT.</span>
          </button>
        </div>
        <p className="live-footer"><Link href="/app/simulator/simplified">Preview leveraged borrowing in the simulator</Link></p>
      </section>
    </main>
  );
}
