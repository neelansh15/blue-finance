"use client";

import Link from "next/link";
import TokenIcon from "../../components/TokenIcon";
import { useDemoAccount } from "../DemoAccount";
import { health, money, quantity } from "../format";
import { accountTotals, marketMetrics, MARKETS, TOKENS_PER_UNIT } from "../markets";

export default function Dashboard() {
  const { positions, regime } = useDemoAccount();
  const totals = accountTotals(positions);
  const borrowed = MARKETS.filter(({ id }) => positions[id].collateral > 0 || positions[id].debt > 0);
  const supplied = MARKETS.filter(({ id }) => positions[id].supplied > 0);

  return (
    <main id="app-main" tabIndex={-1}>
      <section className="app-masthead" aria-labelledby="dashboard-title">
        <div className="wrap">
          <p className="app-demo-label app-mobile-status">Simulation</p>
          <div className="app-heading">
            <h1 id="dashboard-title">Your <em>dashboard.</em></h1>
            <div className="dashboard-actions">
              <Link className="btn" href="/app/earn">Supply USDT</Link>
              <Link className="btn dashboard-secondary" href="/app/borrow">Borrow USDT</Link>
            </div>
          </div>
          <dl className="app-summary app-summary-overview">
            <div className="app-summary-net"><dt>Net position</dt><dd>{money(totals.collateral + totals.supplied - totals.debt)}</dd></div>
            <div><dt>Collateral</dt><dd>{money(totals.collateral)}</dd></div>
            <div><dt>Debt</dt><dd>{money(totals.debt)}</dd></div>
            <div><dt>USDT supplied</dt><dd>{money(totals.supplied)}</dd></div>
          </dl>
        </div>
      </section>

      <div className="wrap dashboard-positions">
        <section aria-labelledby="borrow-positions">
          <div className="app-section-heading">
            <h2 id="borrow-positions">Borrow positions</h2>
            <span className="app-unit">{borrowed.length} {borrowed.length === 1 ? "market" : "markets"}</span>
          </div>
          <ul className="app-positions" aria-labelledby="borrow-positions">
            {borrowed.map(market => {
              const position = positions[market.id];
              const current = marketMetrics(market, position, regime);
              const weekend = marketMetrics(market, position, "weekend");
              const route = `/app/borrow?market=${market.id}`;
              return (
                <li key={market.id}>
                  <div className="app-asset"><TokenIcon symbol={market.id} size={32} /><strong>{market.symbol} / USDT</strong></div>
                  <dl>
                    <div><dt>Collateral</dt><dd>{quantity.format(position.collateral / TOKENS_PER_UNIT)} {market.symbol}</dd></div>
                    <div><dt>Debt</dt><dd>{money(position.debt)}</dd></div>
                    <div><dt>Available to borrow</dt><dd>{money(current.available)}</dd></div>
                    <div><dt>Health factor</dt><dd>{health(current.health)}</dd></div>
                    {position.debt > 0 && <div><dt>Weekend health</dt><dd>{health(weekend.health)}</dd></div>}
                  </dl>
                  <div className="dashboard-position-actions">
                    {position.debt > 0 && (
                      <Link href={`${route}&action=repay#manage-market`} aria-label={`Repay USDT in ${market.symbol}`}>Repay</Link>
                    )}
                    <Link href={`${route}&action=borrow#manage-market`} aria-label={`Borrow USDT in ${market.symbol}`}>Borrow</Link>
                    <Link href={`${route}&action=deposit#manage-market`} aria-label={`Add collateral in ${market.symbol}`}>Add collateral</Link>
                  </div>
                </li>
              );
            })}
            {borrowed.length === 0 && (
              <li><p>No collateral or debt yet.</p><div className="dashboard-position-actions">
                <Link href="/app/borrow?action=deposit#manage-market">Supply collateral</Link>
              </div></li>
            )}
          </ul>
        </section>

        <section aria-labelledby="earn-positions">
          <div className="app-section-heading">
            <h2 id="earn-positions">Earn positions</h2>
            <span className="app-unit">{supplied.length} {supplied.length === 1 ? "market" : "markets"}</span>
          </div>
          <ul className="app-positions" aria-labelledby="earn-positions">
            {supplied.map(market => {
              const route = `/app/earn?market=${market.id}`;
              return (
                <li key={market.id}>
                  <div className="app-asset"><TokenIcon symbol={market.id} size={32} /><strong>{market.symbol} / USDT</strong></div>
                  <dl>
                    <div><dt>USDT supplied</dt><dd>{money(positions[market.id].supplied)}</dd></div>
                    <div><dt>Supply APR</dt><dd>{market.supplyApr.toFixed(2)}%</dd></div>
                  </dl>
                  <div className="dashboard-position-actions">
                    <Link href={`${route}&action=lend#manage-market`} aria-label={`Supply USDT in ${market.symbol}`}>Supply</Link>
                    <Link href={`${route}&action=redeem#manage-market`} aria-label={`Withdraw USDT in ${market.symbol}`}>Withdraw</Link>
                  </div>
                </li>
              );
            })}
            {supplied.length === 0 && (
              <li><p>No USDT supplied yet.</p><div className="dashboard-position-actions">
                <Link href="/app/earn#manage-market">Supply USDT</Link>
              </div></li>
            )}
          </ul>
        </section>
      </div>
      <p className="wrap app-footnote">Sample data. Simulated actions reset on refresh.</p>
    </main>
  );
}
