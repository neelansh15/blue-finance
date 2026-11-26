"use client";

import { useId, useState } from "react";
import {
  derivePosition,
  hMax,
  validateBorrow,
  type DawnClient,
  type DawnSnapshot,
} from "../../../src/lib/dawn/client";
import { hf, pct } from "./format";

export default function BorrowForm({ s, client }: { s: DawnSnapshot; client: DawnClient }) {
  const id = useId();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const p = derivePosition(s);
  const amount = text.trim() === "" ? NaN : Number(text);
  const check = validateBorrow(s, text.trim() === "" ? 0 : amount);
  const showError = text.trim() !== "" || p.borrowBlocked;
  const error = !check.ok && showError ? check.reason : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!check.ok || busy) return;
    setBusy(true);
    try {
      const r = await client.borrow(amount);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setText("");
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="preview dapp-card" aria-labelledby="borrow-title">
      <p className="preview-kicker">Borrow</p>
      <h2 className="preview-title" id="borrow-title">
        Borrow {s.loanSymbol}
      </h2>

      <p className="dapp-formula num">
        targetLTV = LLTV &times; (1 &minus; h_max) &minus; margin = {pct(s.params.lltv)} &times; (1 &minus;{" "}
        {pct(hMax(s.params), 0)}) &minus; {pct(s.params.margin, 0)} ={" "}
        <span className="key">{p.borrowBlocked ? "blocked" : pct(p.target, 2)}</span>
      </p>

      <form onSubmit={submit} noValidate>
        <label className="dapp-label" htmlFor={id}>
          Amount ({s.loanSymbol})
        </label>
        <div className="dapp-input-row">
          <input
            id={id}
            className="dapp-input num"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMsg(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-err`}
          />
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setText(Math.floor(p.available * 100) / 100 + "")}
            disabled={p.borrowBlocked || p.available <= 0}
          >
            Max
          </button>
        </div>
        <p id={`${id}-err`} className="dapp-error" role="alert">
          {error ?? ""}
        </p>

        <dl className="preview-stats">
          <div>
            <dt>New debt</dt>
            <dd className="num">{Number.isFinite(check.newDebt) ? check.newDebt.toFixed(2) : "-"}</dd>
          </div>
          <div>
            <dt>New LTV</dt>
            <dd className="num">
              {pct(check.newLtv)} <span className="unit">of {pct(p.target, 1)} limit</span>
            </dd>
          </div>
          <div>
            <dt>Health now</dt>
            <dd className="num">{hf(check.newHealthNow)}</dd>
          </div>
          <div>
            <dt>Health at weekend</dt>
            <dd className="num">{hf(check.newHealthWeekend)}</dd>
          </div>
        </dl>

        <button type="submit" className="btn btn-primary dapp-submit" disabled={!check.ok || busy}>
          {busy ? "Borrowing..." : "Borrow (mock)"}
        </button>
      </form>
      <p className="dapp-result" role="status" data-ok={msg?.ok}>
        {msg?.text ?? ""}
      </p>
      <p className="illustrative">
        <span className="illustrative-tag">Note</span>
        The router limit is bypassable without the wrapper contract (phase 2). h_max and the margin are placeholders.
      </p>
    </section>
  );
}
