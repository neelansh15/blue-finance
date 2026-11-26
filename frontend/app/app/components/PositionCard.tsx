import {
  BORROWING_DISCOUNT, RISK, STATUS_LABEL, isScheduledStatus, positionMetrics,
  type MarketStatus, type PoolState, type StockId,
} from "../../../src/lib/blue/client";
import { hf, pct, units, usd } from "./format";

export const STATUS_TITLE = STATUS_LABEL;
export const pillClass = (status: MarketStatus) => (status === "CORP_ACTION" ? "pill-corp" : `pill-${status.toLowerCase()}`);

export function healthStatus(value: number | null) {
  if (value === null) return "healthy";
  if (value < 1) return "liquidatable";
  if (value < 1.1) return "risk";
  if (value < 1.3) return "caution";
  return "healthy";
}

const STATUS_WORD = { healthy: "Healthy", caution: "Watch", risk: "At risk", liquidatable: "Liquidatable" } as const;

export function StatusPill({ status }: { status: MarketStatus }) {
  return (
    <span className={`pill ${pillClass(status)}`} aria-live="polite" data-testid="status-badge">
      <span className="pill-dot" aria-hidden="true" />
      {STATUS_TITLE[status]}
      {isScheduledStatus(status) && <span className="num"> &middot; {pct(BORROWING_DISCOUNT[status], 0)} borrowing discount</span>}
    </span>
  );
}

export default function PositionCard({ state, stock }: { state: PoolState; stock: StockId }) {
  const account = state.account;
  const p = positionMetrics(state);
  const shown = p.stock ?? stock;
  const price = state.stocks[shown].price;
  const health = healthStatus(p.healthFactor);
  return (
    <section className="preview dapp-card" aria-labelledby="pos-title">
      <div className="preview-head">
        <div>
          <p className="preview-kicker">Your position</p>
          <h2 className="preview-title" id="pos-title">
            {shown} <span aria-hidden="true">/</span>
            <span className="sr-only"> collateral, borrowing </span> USDT
          </h2>
        </div>
        <StatusPill status={p.status ?? state.schedule} />
      </div>

      <dl className="preview-stats">
        <div>
          <dt>Collateral</dt>
          <dd>
            <span className="num">{units(account.collateral)}</span> <span className="unit">{shown}</span>
            <span className="sub num">Atlas price {usd(price)} per token</span>
          </dd>
        </div>
        <div>
          <dt>Collateral value</dt>
          <dd><span className="num key">{usd(p.value)}</span>
            <span className="sub num">{p.valuation.usable ? "live Atlas price" : `price unusable: ${p.valuation.reason}`}</span></dd>
        </div>
        <div>
          <dt>Debt (bluDebtUSDT)</dt>
          <dd>
            <span className="num">{usd(account.debt)}</span>
            <span className="sub num">liquidation threshold {pct(RISK.liquidationThreshold)}</span>
          </dd>
        </div>
        <div>
          <dt>Borrow limit</dt>
          <dd>
            <span className="num">{usd(p.borrowLimit)}</span>
            <span className="sub num">borrow LTV {pct(p.borrowLtv)} &middot; {usd(p.headroom)} unused</span>
          </dd>
        </div>
      </dl>

      <div className="dapp-healths">
        <div className="dapp-health">
          <span className="dapp-health-label">Health factor</span>
          {p.valuation.usable || account.debt === 0 ? (
            <span className={`health-val num status-${health === "liquidatable" ? "risk" : health}`} data-testid="health">
              {hf(p.healthFactor)} <span className="health-word">{STATUS_WORD[health]}</span>
            </span>
          ) : (
            // Without a usable price the pool cannot compute health, so liquidation pauses too.
            <span className="health-val num status-caution" data-testid="health">
              Paused <span className="health-word">until the price is usable</span>
            </span>
          )}
        </div>
        <div className="dapp-health">
          <span className="dapp-health-label">Liquidation price</span>
          <span className="health-val num">{p.liquidationPrice === null ? "none" : usd(p.liquidationPrice)}</span>
        </div>
      </div>
      <p className="illustrative">
        <span className="illustrative-tag">Rule</span>
        The market status changes only how much you can borrow (and withdraw while in debt). Health factor and
        liquidation always use the {pct(RISK.liquidationThreshold)} liquidation threshold at the live Atlas price.
      </p>
    </section>
  );
}
