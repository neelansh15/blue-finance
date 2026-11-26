"use client";

import { useId, useState } from "react";
import {
  ACTIONS, CENTS_PER_USDT, RISK, TOKENS_PER_UNIT, actionLimits, executeAction, positionMetrics,
  type Action, type BlueClient, type PoolState, type StockId,
} from "../../../src/lib/blue/client";
import { parseAmount } from "../markets";
import { hf, pct, units, usd } from "./format";

const FORM_ACTIONS: readonly Action[] = ["borrow", "repay", "deposit", "withdraw"];
const SHORT: Record<Action, string> = {
  borrow: "Borrow", repay: "Repay", deposit: "Add collateral", withdraw: "Withdraw", lend: "Supply", redeem: "Withdraw",
};

export default function BorrowForm({ state, stock, client }: { state: PoolState; stock: StockId; client: BlueClient }) {
  const id = useId();
  const [action, setAction] = useState<Action>("borrow");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const collateral = ACTIONS[action].collateral;
  const scale = collateral ? TOKENS_PER_UNIT : CENTS_PER_USDT;
  const symbol = collateral ? stock : "USDT";
  const limit = actionLimits(state, stock)[action];
  const amount = parseAmount(text.trim(), scale);
  const invalid = text.trim() !== "" && (amount <= 0 || amount > limit.max);
  const error = limit.max === 0 ? limit.reason : invalid ? `Enter up to ${(limit.max / scale).toString()} ${symbol}.` : undefined;
  const before = positionMetrics(state);
  const preview = amount > 0 && !invalid ? executeAction(state, action, stock, amount) : null;
  const after = preview?.ok ? positionMetrics(preview.state) : before;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = client.act(action, stock, amount);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) setText("");
  }

  return (
    <section className="preview dapp-card" aria-labelledby="borrow-title">
      <p className="preview-kicker">Manage loan</p>
      <h2 className="preview-title" id="borrow-title">{stock} collateral, USDT loan</h2>

      <div className="dapp-btnrow" role="group" aria-label="Action">
        {FORM_ACTIONS.map(next => (
          <button key={next} type="button" className="btn btn-quiet" aria-pressed={action === next}
            onClick={() => { setAction(next); setText(""); setMsg(null); }}>{SHORT[next]}</button>
        ))}
      </div>

      <form onSubmit={submit} noValidate>
        <label className="dapp-label" htmlFor={id}>Amount ({symbol})</label>
        <div className="dapp-input-row">
          <input id={id} className="dapp-input num" inputMode="decimal" autoComplete="off" placeholder="0.00" value={text}
            onChange={(e) => { setText(e.target.value); setMsg(null); }}
            aria-invalid={invalid || undefined} aria-describedby={`${id}-err`} />
          <button type="button" className="btn btn-quiet" disabled={limit.max === 0}
            onClick={() => setText(String(limit.max / scale))}>Max</button>
        </div>
        <p id={`${id}-err`} className="dapp-error" role="alert">{error ?? ""}</p>

        <dl className="preview-stats">
          <div><dt>Available</dt><dd className="num">{collateral ? units(limit.max) : usd(limit.max)} {collateral ? stock : ""}</dd></div>
          <div><dt>Debt after</dt><dd className="num">{usd((preview?.ok ? preview.state : state).account.debt)}</dd></div>
          <div><dt>Borrow limit after</dt><dd className="num">{usd(after.borrowLimit)} <span className="unit">at {pct(after.borrowLtv)}</span></dd></div>
          <div><dt>Health factor after</dt><dd className="num">{hf(after.healthFactor)}</dd></div>
        </dl>

        <button type="submit" className="btn btn-primary dapp-submit" disabled={amount <= 0 || invalid || limit.max === 0}>
          {ACTIONS[action].label} (simulated)
        </button>
      </form>
      <p className="dapp-result" role="status" data-ok={msg?.ok}>{msg?.text ?? ""}</p>
      <p className="illustrative">
        <span className="illustrative-tag">Note</span>
        Borrowing needs signed eligibility, a live keeper, fresh Atlas and USDT prices, and room under the borrow LTV,
        the stock borrow cap and pool liquidity. Repaying always works. Liquidation threshold {pct(RISK.liquidationThreshold)}.
      </p>
    </section>
  );
}
