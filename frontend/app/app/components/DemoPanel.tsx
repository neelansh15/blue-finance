"use client";

import { useState } from "react";
import {
  REGIMES,
  derivePosition,
  isRegime,
  liquidationOutcome,
  naivePricePerRaw,
  collateralValue,
  healthFactor,
  numberToWad,
  wadToNumber,
  type DawnSnapshot,
  type DemoControls,
} from "../../../src/lib/dawn/client";
import { hf, usd } from "./format";

/** Hidden developer panel. Mock only. Drives the four WS8 scenarios. */
export default function DemoPanel({ s, demo }: { s: DawnSnapshot; demo: DemoControls }) {
  const [log, setLog] = useState<string>("");
  const [mText, setMText] = useState("2");
  const [priceText, setPriceText] = useState("");
  const p = derivePosition(s);
  const naive = naivePricePerRaw(s.feedPricePerUI);
  const naiveHf = healthFactor(
    collateralValue(s.collateralRaw, naive, s.params.haircut[s.regime]),
    s.params.lltv,
    s.debt,
  );
  const liq = liquidationOutcome(s);
  const say = (r: { message: string }) => setLog(r.message);

  return (
    <aside className="preview dapp-card dapp-dev" aria-labelledby="dev-title" data-testid="demo-panel">
      <p className="preview-kicker">Developer only, mock data</p>
      <h2 className="preview-title" id="dev-title">
        Demo control
      </h2>

      <div className="dapp-dev-group">
        <h3>Scenarios 1-2: regime</h3>
        <label className="sr-only" htmlFor="dev-regime">
          Regime
        </label>
        <select
          id="dev-regime"
          className="dapp-input"
          value={s.regime}
          onChange={(e) => isRegime(e.target.value) && demo.setRegime(e.target.value)}
        >
          {REGIMES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <p className="dapp-hint">Scenario 1: OPEN, borrow. Scenario 2: WEEKEND, limit tightens, health drops.</p>
      </div>

      <div className="dapp-dev-group">
        <h3>Scenario 3: 2-for-1 split</h3>
        <div className="dapp-btnrow">
          <button className="btn btn-quiet" onClick={() => demo.announceSplit(2)}>
            a. Announce
          </button>
          <button className="btn btn-quiet" onClick={() => demo.applyScheduledMultiplier()} disabled={!s.pendingMultiplier}>
            b. Multiplier effective
          </button>
          <button className="btn btn-quiet" onClick={() => demo.feedPrintsPostSplit()}>
            c. Feed prints post-split
          </button>
          <button className="btn btn-quiet" onClick={() => say(demo.tryClearCorpAction())}>
            d. Keeper clears
          </button>
        </div>
        <dl className="dapp-compare num">
          <div>
            <dt>Dawn oracle, per raw</dt>
            <dd>
              {usd(p.oracle.pricePerRaw)} {p.oracle.frozen ? "(frozen)" : ""} / health {hf(p.healthNow)}
            </dd>
          </div>
          <div>
            <dt>Naive oracle (ignores m)</dt>
            <dd className={naiveHf < 1 ? "status-risk" : ""}>
              {usd(naive)} / health {hf(naiveHf)} {naiveHf < 1 ? "LIQUIDATABLE" : ""}
            </dd>
          </div>
        </dl>
        <div className="dapp-btnrow">
          <label className="sr-only" htmlFor="dev-m">
            Multiplier
          </label>
          <input id="dev-m" className="dapp-input num" value={mText} onChange={(e) => setMText(e.target.value)} />
          <button
            className="btn btn-quiet"
            onClick={() => {
              const n = Number(mText);
              if (Number.isFinite(n) && n > 0) demo.setMultiplier(numberToWad(n));
            }}
          >
            Set multiplier (m = {wadToNumber(s.uiMultiplier)})
          </button>
        </div>
        <p className="dapp-hint">Scenario 3: a, b (Dawn freezes, naive overvalues), c, d. Naive compares the ignore-m reading.</p>
      </div>

      <div className="dapp-dev-group">
        <h3>Scenario 4: price gap</h3>
        <div className="dapp-btnrow">
          {[-0.1, -0.3, -0.45, 0.1].map((f) => (
            <button key={f} className="btn btn-quiet" onClick={() => demo.movePrice(f)}>
              {f > 0 ? "+" : ""}
              {f * 100}%
            </button>
          ))}
        </div>
        <div className="dapp-btnrow">
          <label className="sr-only" htmlFor="dev-price">
            Feed price per UI share
          </label>
          <input
            id="dev-price"
            className="dapp-input num"
            placeholder={`feed ${s.feedPricePerUI.toFixed(2)}`}
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
          />
          <button
            className="btn btn-quiet"
            onClick={() => {
              const n = Number(priceText);
              if (Number.isFinite(n) && n > 0) demo.setFeedPrice(n);
            }}
          >
            Set price
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => say(demo.runLiquidationBot())} disabled={!liq.liquidatable}>
          Run liquidation bot
        </button>
      </div>

      <button className="btn btn-quiet" onClick={() => { demo.reset(); setLog("Reset to the starting state."); }}>
        Reset
      </button>
      <p className="dapp-result" role="status">
        {log}
      </p>
    </aside>
  );
}
