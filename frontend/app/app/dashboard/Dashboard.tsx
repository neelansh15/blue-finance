"use client";

import Link from "next/link";
import { IconArrow } from "../../components/Icons";
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
          <dl className="app-summary">
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
            <Link className="dashboard-link" href="/app/borrow">Borrow markets <IconArrow /></Link>
          </div>
          <ul className="app-positions" aria-labelledby="borrow-positions">
            {borrowed.map(market => {
              const position = positions[market.id];
              return (
                <li key={market.id}>
                  <div className="app-section-heading">
                    <div className="app-asset"><TokenIcon symbol={market.id} size={26} /><strong>{market.symbol}</strong></div>
                    <Link className="dashboard-link" href={`/app/borrow?market=${market.id}&action=${position.debt > 0 ? "repay" : "borrow"}#manage-market`}
                      aria-label={`Manage ${market.symbol} borrow position`}>Manage <IconArrow /></Link>
                  </div>
                  <dl>
                    <div><dt>Collateral</dt><dd>{quantity.format(position.collateral / TOKENS_PER_UNIT)} {market.symbol}</dd></div>
                    <div><dt>Debt</dt><dd>{money(position.debt)}</dd></div>
                    <div><dt>Health factor</dt><dd>{health(marketMetrics(market, position, regime).health)}</dd></div>
                  </dl>
                </li>
              );
            })}
            {borrowed.length === 0 && <li>No collateral or debt yet.</li>}
          </ul>
        </section>

        <section aria-labelledby="earn-positions">
          <div className="app-section-heading">
            <h2 id="earn-positions">Earn positions</h2>
            <Link className="dashboard-link" href="/app/earn">Earn markets <IconArrow /></Link>
          </div>
          <ul className="app-positions" aria-labelledby="earn-positions">
            {supplied.map(market => (
              <li key={market.id}>
                <div className="app-section-heading">
                  <div className="app-asset"><TokenIcon symbol={market.id} size={26} /><strong>{market.symbol}</strong></div>
                  <Link className="dashboard-link" href={`/app/earn?market=${market.id}&action=redeem#manage-market`}
                    aria-label={`Manage ${market.symbol} earn position`}>Manage <IconArrow /></Link>
                </div>
                <dl>
                  <div><dt>USDT supplied</dt><dd>{money(positions[market.id].supplied)}</dd></div>
                  <div><dt>Supply APR</dt><dd>{market.supplyApr.toFixed(2)}%</dd></div>
                </dl>
              </li>
            ))}
            {supplied.length === 0 && <li>No USDT supplied yet.</li>}
          </ul>
        </section>
      </div>
      <p className="wrap app-footnote">Sample data. Simulated actions reset on refresh.</p>
    </main>
  );
}
