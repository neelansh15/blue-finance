import { ILLUSTRATIVE_HAIRCUT } from "./regimes";

// Example position and the proposed liquidation LTV from architecture-v1, section 13.
const COLLATERAL_UNITS = 50;
const COLLATERAL_VALUE = 10_000;
const DEBT = 3_600;
const LIQUIDATION_LTV = 0.625;
const REGULAR_CEILING = COLLATERAL_VALUE * LIQUIDATION_LTV;
const WEEKEND_HEALTH = (REGULAR_CEILING * (1 - ILLUSTRATIVE_HAIRCUT.weekend)) / DEBT;
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function PositionPreview({ haircut, id }: { haircut: number; id: string }) {
  const adjusted = COLLATERAL_VALUE * (1 - haircut);
  const ceiling = adjusted * LIQUIDATION_LTV;
  const reduction = REGULAR_CEILING - ceiling;

  return (
    <div className="position" role="group" aria-labelledby={id}>
      <header className="position-head">
        <p>Example position</p>
        <h3 id={id}>
          NVDAB <span aria-hidden="true">/</span>
          <span className="sr-only"> collateral, borrowing </span> USDT
        </h3>
      </header>

      <dl className="position-ceiling" aria-live="polite">
        <dt>Illustrative borrowing ceiling</dt>
        <dd className="num">{currency.format(ceiling)}</dd>
        <dd>{reduction ? `−${currency.format(reduction)} vs. regular session` : "Regular-session baseline"}</dd>
      </dl>

      <dl className="position-metrics">
        <div>
          <dt>Collateral · {COLLATERAL_UNITS} NVDAB</dt>
          <dd className="num">{currency.format(COLLATERAL_VALUE)}</dd>
        </div>
        <div>
          <dt>Value after haircut</dt>
          <dd className="num">{currency.format(adjusted)}</dd>
        </div>
        <div>
          <dt>Debt</dt>
          <dd className="num">{DEBT.toLocaleString("en-US")} USDT</dd>
        </div>
        <div>
          <dt>Liquidation health</dt>
          <dd className="num">{(ceiling / DEBT).toFixed(2)}×</dd>
        </div>
        <div>
          <dt>Weekend health</dt>
          <dd className="num">{WEEKEND_HEALTH.toFixed(2)}×</dd>
        </div>
      </dl>
      <p className="position-note">
        Example uses a {LIQUIDATION_LTV * 100}% liquidation LTV. Dawn’s router would cap new borrowing below this ceiling.
      </p>
    </div>
  );
}
