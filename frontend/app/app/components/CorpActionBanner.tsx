import { statusNotice, type PoolState, type StockId } from "../../../src/lib/blue/client";

/** "What you can do" banner for a stock: halts, corporate actions, monitoring lapses and price reviews. */
export default function CorpActionBanner({ state, stock }: { state: PoolState; stock: StockId }) {
  const notice = statusNotice(state, stock);
  if (!notice) return null;
  return (
    <div className={`dapp-banner${notice.tone === "risk" ? " dapp-banner-risk" : ""}`} role="status" data-testid="status-banner">
      <strong>{notice.title}</strong> {notice.body}
    </div>
  );
}
