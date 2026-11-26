"use client";

import { useId, useState } from "react";
import { ILLUSTRATIVE_HAIRCUT, REGIME_LABEL, REGIME_NOTE, type Regime } from "./regimes";

// Illustrative mock position. Not real data, not protocol parameters.
const COLLATERAL_UNITS = 50;
const COLLATERAL_VALUE = 10_000; // USD, illustrative round number
const DEBT = 3_600; // USDT, illustrative
const LLTV = 0.625; // proposed LLTV for the demo market (architecture-v1, section 13)

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const OPTIONS: Regime[] = ["open", "extended", "closed", "weekend"];

function metrics(r: Regime) {
  const h = ILLUSTRATIVE_HAIRCUT[r];
  const adjusted = COLLATERAL_VALUE * (1 - h);
  const limit = adjusted * LLTV;
  const health = limit / DEBT;
  return { h, adjusted, limit, health, available: Math.max(0, limit - DEBT) };
}

export default function PositionPreview() {
  const [regime, setRegime] = useState<Regime>("open");
  const name = useId();
  const m = metrics(regime);
  const wk = metrics("weekend");
  // Bar: share of borrow limit used by debt.
  const used = Math.min(1, DEBT / m.limit);
  const status = m.health >= 1.5 ? "healthy" : m.health >= 1.15 ? "caution" : "risk";

  return (
    <div className="preview" aria-labelledby={`${name}-title`} role="group">
      <div className="preview-head">
        <div>
          <p className="preview-kicker">Position simulator</p>
          <h2 className="preview-title" id={`${name}-title`}>
            NVDAB <span aria-hidden="true">/</span>
            <span className="sr-only"> collateral, borrowing </span> USDT
          </h2>
        </div>
        <span className={`pill pill-${regime}`} aria-live="polite">
          <span className="pill-dot" aria-hidden="true" />
          Market {REGIME_LABEL[regime].toLowerCase()}
        </span>
      </div>

      <fieldset className="segmented">
        <legend className="sr-only">Preview the position in a market regime</legend>
        {OPTIONS.map((r) => (
          <label key={r} className="segmented-opt">
            <input
              type="radio"
              name={name}
              value={r}
              checked={regime === r}
              onChange={() => setRegime(r)}
            />
            <span>{REGIME_LABEL[r]}</span>
          </label>
        ))}
      </fieldset>

      <dl className="preview-stats">
        <div>
          <dt>Collateral</dt>
          <dd>
            <span className="num">{COLLATERAL_UNITS.toFixed(2)}</span> <span className="unit">NVDAB</span>
            <span className="sub num">{usd(COLLATERAL_VALUE)}</span>
          </dd>
        </div>
        <div>
          <dt>Regime haircut</dt>
          <dd>
            <span className="num">{(m.h * 100).toFixed(1)}%</span>
            <span className="sub num">Priced at {usd(m.adjusted)}</span>
          </dd>
        </div>
        <div>
          <dt>Borrowed</dt>
          <dd>
            <span className="num">{DEBT.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>{" "}
            <span className="unit">USDT</span>
          </dd>
        </div>
        <div>
          <dt>Borrow limit</dt>
          <dd>
            <span className="num key">{usd(m.limit)}</span>
            <span className="sub num">{usd(m.available)} available</span>
          </dd>
        </div>
      </dl>

      <div className="health">
        <div className="health-row">
          <span>Health</span>
          <span className={`health-val status-${status}`}>
            <span className="num">{m.health.toFixed(2)}</span>
            <span className="health-word">{status === "healthy" ? "Healthy" : status === "caution" ? "Caution" : "At risk"}</span>
          </span>
        </div>
        <div
          className="meter"
          role="meter"
          aria-label="Share of borrow limit used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(used * 100)}
          aria-valuetext={`${Math.round(used * 100)}% of borrow limit used`}
        >
          <span style={{ width: `${used * 100}%` }} />
        </div>
        <p className="health-foot">
          <span>Weekend health</span>
          <span className="num">{wk.health.toFixed(2)}</span>
        </p>
      </div>

      <p className="preview-note">{REGIME_NOTE[regime]}</p>
      <p className="illustrative">
        <span className="illustrative-tag">Illustrative</span>
        Simulated values. The proposed demo liquidation LTV is 62.5%.
      </p>
    </div>
  );
}
