"use client";

import { useState } from "react";
import {
  SCHEDULED_STATUSES, STATUS_LABEL, STOCKS, isScheduledStatus, isStockId, needsPriceReview, positionMetrics, stockStatus,
  type DemoControls, type PoolState, type StockId,
} from "../../../src/lib/blue/client";
import { hf, usd } from "./format";

/** Hidden developer panel. Mock only. Drives the keeper, admin and price scenarios. */
export default function DemoPanel({ state, demo, initialStock, onStock }: {
  state: PoolState;
  demo: DemoControls;
  initialStock: StockId;
  onStock?: (stock: StockId) => void;
}) {
  const [log, setLog] = useState("");
  const [stock, setStock] = useState(initialStock);
  const s = state.stocks[stock];
  const p = positionMetrics(state);
  const say = (r: { message: string }) => setLog(r.message);
  const run = (message: string, action: () => void) => { action(); setLog(message); };

  return (
    <aside className="preview dapp-card dapp-dev" aria-labelledby="dev-title" data-testid="demo-panel">
      <p className="preview-kicker">Developer only, mock data</p>
      <h2 className="preview-title" id="dev-title">Demo control</h2>

      <div className="dapp-dev-group">
        <h3>Stock</h3>
        <label className="sr-only" htmlFor="dev-stock">Stock</label>
        <select id="dev-stock" className="dapp-input" value={stock}
          onChange={(e) => {
            const next = e.target.value;
            if (isStockId(next)) { setStock(next); onStock?.(next); }
          }}>
          {STOCKS.map((item) => <option key={item.id} value={item.id}>{item.id} &middot; {item.name}</option>)}
        </select>
        <p className="dapp-hint num">
          Status {STATUS_LABEL[stockStatus(state, stock)]} &middot; Atlas {usd(s.price)} (accepted {usd(s.acceptedPrice)})
          &middot; multiplier {s.multiplier}{s.multiplier !== s.acceptedMultiplier ? ` (accepted ${s.acceptedMultiplier})` : ""}
        </p>
      </div>

      <div className="dapp-dev-group">
        <h3>1. Market status</h3>
        <label className="sr-only" htmlFor="dev-status">Scheduled status</label>
        <select id="dev-status" className="dapp-input" value={state.scheduleSource === "clock" ? "clock" : state.schedule}
          onChange={(e) => demo.setSchedule(isScheduledStatus(e.target.value) ? e.target.value : null)}>
          <option value="clock">Follow US Eastern clock ({STATUS_LABEL[state.schedule]})</option>
          {SCHEDULED_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
        </select>
        <p className="dapp-hint">WEEKEND lowers the borrow limit to 42.5% LTV. Health factor does not change.</p>
      </div>

      <div className="dapp-dev-group">
        <h3>2. Halt</h3>
        <div className="dapp-btnrow">
          <button className="btn btn-quiet" onClick={() => run(`Keeper halted ${stock}.`, () => demo.halt(stock))}>Halt {stock}</button>
          <button className="btn btn-quiet" onClick={() => say(demo.clearStatus(stock))}>Admin clears status</button>
          <button className="btn btn-quiet" onClick={() => run(s.guardianHold ? "Hold released." : "Guardian hold set.", () => demo.setGuardianHold(stock, !s.guardianHold))}>
            {s.guardianHold ? "Release guardian hold" : "Guardian hold"}
          </button>
        </div>
      </div>

      <div className="dapp-dev-group">
        <h3>3. Keeper lapse</h3>
        <div className="dapp-btnrow">
          <button className="btn btn-quiet" onClick={() => run("No keeper report for 10 minutes. Borrowing paused.", demo.keeperLapse)}>Lapse</button>
          <button className="btn btn-quiet" disabled={state.keeper !== "LAPSED"}
            onClick={() => run("Keeper reports again. Recovery window started.", demo.keeperReport)}>Keeper reports</button>
          <button className="btn btn-quiet" disabled={state.keeper !== "RECOVERING"}
            onClick={() => run("30 minutes of healthy reports. Borrowing resumes.", demo.finishRecovery)}>30 minutes pass</button>
        </div>
        <p className="dapp-hint">Keeper: {state.keeper.toLowerCase()}. Withdrawals within the limit still work.</p>
      </div>

      <div className="dapp-dev-group">
        <h3>4. Split and multiplier</h3>
        <div className="dapp-btnrow">
          <button className="btn btn-quiet" onClick={() => run("Keeper set CORP_ACTION ahead of a 2-for-1 split.", () => demo.announceSplit(stock, 2))}>
            a. Announce split
          </button>
          <button className="btn btn-quiet" onClick={() => run("Multiplier changed. Pricing stops until the admin accepts a new price.", () => demo.changeMultiplier(stock, s.pendingSplit ?? 2))}>
            b. Multiplier changes
          </button>
          <button className="btn btn-quiet" onClick={() => say(demo.acceptPrice(stock))}>c. Admin accepts price</button>
          <button className="btn btn-quiet" onClick={() => say(demo.clearStatus(stock))}>d. Admin clears status</button>
        </div>
        <p className="dapp-hint">a-b-c-d is an announced split. b then c alone is a multiplier change without notice.</p>
      </div>

      <div className="dapp-dev-group">
        <h3>5. Price moves</h3>
        <div className="dapp-btnrow">
          {[-0.1, -0.25, -0.45, 0.1].map((f) => (
            <button key={f} className="btn btn-quiet" onClick={() => run(`Atlas price ${f > 0 ? "+" : ""}${f * 100}%.`, () => demo.movePrice(stock, f))}>
              {f > 0 ? "+" : ""}{f * 100}%
            </button>
          ))}
          <button className="btn btn-quiet" onClick={() => run("Accepted price is 3 hours old.", () => demo.stalePrice(stock))}>Stale for borrowing</button>
        </div>
        <p className="dapp-hint num">
          {needsPriceReview(s) ? "Moved over 20%: borrowing waits for admin review. " : ""}
          Health factor {hf(p.healthFactor)}{p.liquidatable ? " (liquidatable)" : ""}.
        </p>
        <button className="btn btn-primary" onClick={() => say(demo.runLiquidation())} disabled={!p.liquidatable}>
          Run liquidation bot
        </button>
      </div>

      <div className="dapp-dev-group">
        <h3>6. Other checks</h3>
        <div className="dapp-btnrow">
          <button className="btn btn-quiet" onClick={() => run(state.usdtPriceFresh ? "USDT price stale." : "USDT price fresh.", () => demo.setUsdtPriceFresh(!state.usdtPriceFresh))}>
            {state.usdtPriceFresh ? "USDT price stale" : "USDT price fresh"}
          </button>
          <button className="btn btn-quiet" onClick={() => run(state.account.eligibilityMinutesLeft > 0 ? "Eligibility expired." : "Eligibility renewed for one day.", () => demo.setEligibility(state.account.eligibilityMinutesLeft <= 0))}>
            {state.account.eligibilityMinutesLeft > 0 ? "Expire eligibility" : "Renew eligibility"}
          </button>
        </div>
      </div>

      <button className="btn btn-quiet" onClick={() => run("Reset to the starting state.", demo.reset)}>Reset</button>
      <p className="dapp-result" role="status">{log}</p>
    </aside>
  );
}
