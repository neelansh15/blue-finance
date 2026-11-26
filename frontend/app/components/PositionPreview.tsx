import { AnimatedValue } from "./AnimatedValue";
import TokenIcon from "./TokenIcon";
import { BASE_LTV, LIQUIDATION_THRESHOLD } from "./market-status";

// Example position: the market status discount changes borrowing power, never health.
const COLLATERAL_VALUE = 10_000;
const DEBT = 4_000;
const HEALTH = (COLLATERAL_VALUE * LIQUIDATION_THRESHOLD) / DEBT;
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function amounts(discount: number) {
  const borrowLtv = BASE_LTV * (1 - discount);
  const limit = COLLATERAL_VALUE * borrowLtv;
  const reduction = COLLATERAL_VALUE * BASE_LTV - limit;
  return {
    borrowLtv: `${(borrowLtv * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`,
    limit: currency.format(limit),
    headroom: currency.format(Math.max(0, limit - DEBT)),
    comparison: reduction >= 0.005
      ? `−${currency.format(reduction)} vs. regular session`
      : "Regular-session baseline",
  };
}

export default function PositionPreview({
  discount,
  animatedDiscount,
  id,
}: {
  discount: number;
  animatedDiscount: number;
  id: string;
}) {
  const actual = amounts(discount);
  const visual = amounts(animatedDiscount);

  return (
    <div className="position" role="group" aria-labelledby={id}>
      <header className="position-head">
        <div>
          <p>Example position</p>
          <h3 id={id}>
            NVDAB <span aria-hidden="true">/</span>
            <span className="sr-only"> collateral, borrowing </span> USDT
          </h3>
        </div>
        <div className="position-icons">
          <TokenIcon symbol="NVDAB" />
          <TokenIcon symbol="USDT" />
        </div>
      </header>

      <dl className="position-ceiling">
        <dt>Collateral-based limit</dt>
        <dd className="num" aria-live="polite">
          <AnimatedValue value={actual.limit}>{visual.limit}</AnimatedValue>
        </dd>
        <dd><AnimatedValue value={actual.comparison}>{visual.comparison}</AnimatedValue></dd>
      </dl>

      <dl className="position-metrics">
        <div>
          <dt>Collateral value</dt>
          <dd className="num">{currency.format(COLLATERAL_VALUE)}</dd>
        </div>
        <div>
          <dt>Borrow LTV</dt>
          <dd className="num"><AnimatedValue value={actual.borrowLtv}>{visual.borrowLtv}</AnimatedValue></dd>
        </div>
        <div>
          <dt>Debt</dt>
          <dd className="num">{DEBT.toLocaleString("en-US")} USDT</dd>
        </div>
        <div>
          <dt>Room under the LTV limit</dt>
          <dd className="num"><AnimatedValue value={actual.headroom}>{visual.headroom}</AnimatedValue></dd>
        </div>
        <div>
          <dt>Health factor</dt>
          <dd className="num">{HEALTH.toFixed(2)}× at every status</dd>
        </div>
      </dl>
      <p className="position-note">
        This example holds prices and debt fixed. New loans also depend on the stock’s remaining debt cap and available USDT.
      </p>
    </div>
  );
}
