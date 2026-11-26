import { derivePosition, healthStatus, type BlueSnapshot, type Regime } from "../../../src/lib/blue/client";
import { hf, pct, units, usd } from "./format";

export const REGIME_TITLE: Record<Regime, string> = {
  OPEN: "Open",
  EXTENDED: "Extended",
  CLOSED: "Closed",
  WEEKEND: "Weekend",
  HALTED: "Halted",
  CORP_ACTION: "Corporate action",
};
export const pillClass = (r: Regime) => (r === "CORP_ACTION" ? "pill-corp" : `pill-${r.toLowerCase()}`);

const STATUS_WORD = {
  healthy: "Healthy",
  caution: "Watch",
  risk: "At risk",
  liquidatable: "Liquidatable",
} as const;

function Health({ label, value }: { label: string; value: number }) {
  const st = healthStatus(value);
  const cls = st === "liquidatable" ? "risk" : st;
  return (
    <div className="dapp-health">
      <span className="dapp-health-label">{label}</span>
      <span className={`health-val num status-${cls}`}>
        {hf(value)} <span className="health-word">{STATUS_WORD[st]}</span>
      </span>
    </div>
  );
}

export default function PositionCard({ s }: { s: BlueSnapshot }) {
  const p = derivePosition(s);
  const frozen = p.oracle.frozen;
  return (
    <section className="preview dapp-card" aria-labelledby="pos-title">
      <div className="preview-head">
        <div>
          <p className="preview-kicker">Your position</p>
          <h2 className="preview-title" id="pos-title">
            {s.symbol} <span aria-hidden="true">/</span>
            <span className="sr-only"> collateral, borrowing </span> {s.loanSymbol}
          </h2>
        </div>
        <span className={`pill ${pillClass(s.regime)}`} aria-live="polite" data-testid="regime-badge">
          <span className="pill-dot" aria-hidden="true" />
          {REGIME_TITLE[s.regime]} <span className="num">&middot; haircut {pct(p.haircutNow, 0)}</span>
        </span>
      </div>

      <dl className="preview-stats">
        <div>
          <dt>Collateral (UI units)</dt>
          <dd>
            <span className="num" data-testid="ui-balance">{units(p.uiBalance)}</span> <span className="unit">{s.symbol}</span>
            <span className="sub num">
              raw {units(s.collateralRaw, 2)} &times; m {p.multiplier.toFixed(2)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Collateral value</dt>
          <dd>
            <span className="num key">{usd(p.valueNow)}</span>
            <span className="sub num">
              {usd(p.grossValue)} before haircut{frozen ? ", frozen price" : ""}
            </span>
          </dd>
        </div>
        <div>
          <dt>Debt</dt>
          <dd>
            <span className="num">{s.debt.toFixed(2)}</span> <span className="unit">{s.loanSymbol}</span>
            <span className="sub num">LTV {pct(p.ltvNow)} of {pct(s.params.lltv)} LLTV</span>
          </dd>
        </div>
        <div>
          <dt>Can still borrow</dt>
          <dd>
            <span className="num">{p.available.toFixed(2)}</span> <span className="unit">{s.loanSymbol}</span>
            <span className="sub num">limit LTV {pct(p.target)}</span>
          </dd>
        </div>
      </dl>

      <div className="dapp-healths">
        <Health label="Health now" value={p.healthNow} />
        <Health label="Health at weekend" value={p.healthWeekend} />
      </div>
      <p className="dapp-liq num">
        Liquidation price in UI units: {usd(p.liquidationPriceUI)} per {s.symbol} (feed now {usd(s.feedPricePerUI)}).
      </p>
      <p className="illustrative">
        <span className="illustrative-tag">Placeholder</span>
        Weekend health applies the placeholder weekend haircut ({pct(s.params.haircut.WEEKEND, 0)}) to today&apos;s price.
        Haircuts of 0 / 4% / 10% / 15% are illustrative, not calibrated.
      </p>
    </section>
  );
}
