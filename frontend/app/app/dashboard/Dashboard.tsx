"use client";

import Link from "next/link";
import TokenIcon from "../../components/TokenIcon";
import CorpActionBanner from "../components/CorpActionBanner";
import { useDemoAccount } from "../DemoAccount";
import { health, ltv, money, percent, quantity } from "../format";
import { actionLimits, poolMetrics, positionMetrics, STATUS_LABEL, TOKENS_PER_UNIT } from "../markets";

export default function Dashboard() {
  const { state } = useDemoAccount();
  const account = state.account;
  const position = positionMetrics(state);
  const pool = poolMetrics(state);
  const stock = account.stock;
  const canBorrow = stock ? actionLimits(state, stock).borrow : null;

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
            <div className="app-summary-net"><dt>Net position</dt><dd>{money(position.value + account.supplied - account.debt)}</dd></div>
            <div><dt>Collateral</dt><dd>{money(position.value)}</dd></div>
            <div><dt>Debt</dt><dd>{money(account.debt)}</dd></div>
            <div><dt>bluUSDT</dt><dd>{money(account.supplied)}</dd></div>
          </dl>
        </div>
      </section>

      <div className="wrap dashboard-positions">
        <section className="dashboard-position-panel" aria-labelledby="borrow-positions">
          <div className="app-section-heading">
            <h2 id="borrow-positions">Borrow position</h2>
            <span className="app-unit">One stock per account</span>
          </div>
          <ul className="app-positions" aria-labelledby="borrow-positions">
            {stock && position.status ? (
              <li>
                <div className="app-asset"><TokenIcon symbol={stock} size={32} /><strong>{stock} / USDT</strong></div>
                <CorpActionBanner state={state} stock={stock} />
                <dl>
                  <div><dt>Collateral</dt><dd>{quantity.format(account.collateral / TOKENS_PER_UNIT)} {stock}</dd></div>
                  <div><dt>Debt</dt><dd>{money(account.debt)}</dd></div>
                  <div><dt>Health factor</dt><dd>{health(position.healthFactor)}</dd></div>
                  <div><dt>Market status</dt><dd>{STATUS_LABEL[position.status]}</dd></div>
                  <div><dt>Borrow limit · {ltv(position.borrowLtv)}</dt><dd>{money(position.borrowLimit)}</dd></div>
                  <div><dt>Can borrow now</dt><dd>{money(canBorrow?.max ?? 0)}</dd></div>
                </dl>
                <div className="dashboard-position-actions">
                  {account.debt > 0 && (
                    <Link href={`/app/borrow?market=${stock}&action=repay#manage-market`} aria-label={`Repay USDT borrowed against ${stock}`}>Repay</Link>
                  )}
                  <Link href={`/app/borrow?market=${stock}&action=borrow#manage-market`} aria-label={`Borrow USDT against ${stock}`}>Borrow</Link>
                  <Link href={`/app/borrow?market=${stock}&action=deposit#manage-market`} aria-label={`Add ${stock} collateral`}>Add collateral</Link>
                </div>
              </li>
            ) : (
              <li><p>No collateral or debt yet.</p><div className="dashboard-position-actions">
                <Link href="/app/borrow?action=deposit#manage-market">Supply collateral</Link>
              </div></li>
            )}
          </ul>
        </section>

        <section className="dashboard-position-panel" aria-labelledby="earn-positions">
          <div className="app-section-heading">
            <h2 id="earn-positions">Earn position</h2>
            <span className="app-unit">USDT pool</span>
          </div>
          <ul className="app-positions" aria-labelledby="earn-positions">
            {account.supplied > 0 ? (
              <li>
                <div className="app-asset"><TokenIcon symbol="USDT" size={32} /><strong>bluUSDT</strong></div>
                <dl>
                  <div><dt>bluUSDT balance</dt><dd>{money(account.supplied)}</dd></div>
                  <div><dt>Supply APR</dt><dd>{percent(pool.supplyApr)}</dd></div>
                  <div><dt>Utilisation</dt><dd>{percent(pool.utilisation, 1)}</dd></div>
                </dl>
                <div className="dashboard-position-actions">
                  <Link href="/app/earn?action=lend#manage-market" aria-label="Supply USDT to the pool">Supply</Link>
                  <Link href="/app/earn?action=redeem#manage-market" aria-label="Withdraw USDT from the pool">Withdraw</Link>
                </div>
              </li>
            ) : (
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
