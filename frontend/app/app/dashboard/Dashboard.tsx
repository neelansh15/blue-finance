"use client";

import Link from "next/link";
import TokenIcon from "../../components/TokenIcon";
import { ReadStatus, WalletAction } from "../live/LiveParts";
import { useBlueState } from "../live/useBlueLive";
import {
  actionLimit, borrowGate, borrowLtv, formatAmount, formatBps, formatHealth, formatRate, formatUsd, pinnedStock,
  position, statusLabel, stockValue, usdtDebt, usdtValue, utilisation, type LiveState,
} from "../../../src/lib/blue/live-position";

/** Collateral, debt and supplied USDT valued by the pool's oracle. Undefined when a needed price is unusable. */
function totals(data: LiveState) {
  const values = data.stocks.filter(stock => stock.reserve[0] > 0n).map(stock => stockValue(stock.reserve[0], stock));
  const collateral = values.some(value => value === undefined) ? undefined
    : values.reduce<bigint>((sum, value) => sum + value!, 0n);
  const debt = usdtDebt(data) === 0n ? 0n : usdtValue(data, usdtDebt(data));
  const supplied = data.usdt.reserve[0] === 0n ? 0n : usdtValue(data, data.usdt.reserve[0]);
  const net = collateral === undefined || debt === undefined || supplied === undefined ? undefined : collateral + supplied - debt;
  return { collateral, debt, net };
}

export default function Dashboard() {
  const query = useBlueState();
  const data = query.data;
  const connected = !!data?.account;
  const sum = data && connected ? totals(data) : undefined;
  const positions = data && connected
    ? data.stocks.filter(stock => stock.reserve[0] > 0n || pinnedStock(data)?.id === stock.id) : [];

  return (
    <main id="app-main" tabIndex={-1}>
      <section className="app-masthead" aria-labelledby="dashboard-title">
        <div className="wrap">
          <p className="app-demo-label app-mobile-status">BNB Mainnet</p>
          <div className="app-heading">
            <h1 id="dashboard-title">Your <em>dashboard.</em></h1>
            <div className="dashboard-actions">
              <Link className="btn" href="/app/earn">Supply USDT</Link>
              <Link className="btn dashboard-secondary" href="/app/borrow">Borrow USDT</Link>
            </div>
          </div>
          <dl className="app-summary app-summary-overview">
            <div className="app-summary-net"><dt>Net position</dt><dd>{sum ? formatUsd(sum.net) : "—"}</dd></div>
            <div><dt>Collateral</dt><dd>{sum ? formatUsd(sum.collateral) : "—"}</dd></div>
            <div><dt>Debt</dt><dd>{sum ? formatUsd(sum.debt) : "—"}</dd></div>
            <div><dt>bluUSDT</dt><dd>{data && connected ? formatAmount(data.usdt.reserve[0]) : "—"}</dd></div>
          </dl>
          <ReadStatus query={query} />
        </div>
      </section>

      <div className="wrap dashboard-positions">
        <section className="dashboard-position-panel" aria-labelledby="borrow-positions">
          <div className="app-section-heading">
            <h2 id="borrow-positions">Borrow position</h2>
            <span className="app-unit">One stock per account</span>
          </div>
          <ul className="app-positions" aria-labelledby="borrow-positions">
            {data && positions.length > 0 ? positions.map(stock => {
              const held = position(data, stock);
              const backing = pinnedStock(data)?.id === stock.id;
              const gate = borrowGate(data, stock);
              return (
                <li key={stock.id}>
                  <div className="app-asset"><TokenIcon symbol={stock.id} size={32} /><strong>{stock.id} / USDT</strong></div>
                  {gate && <div className="dapp-banner" role="status"><strong>New borrowing is gated.</strong> {gate}</div>}
                  <dl>
                    <div><dt>Supplied</dt><dd>{formatAmount(stock.reserve[0])} {stock.id}</dd></div>
                    <div><dt>Used as collateral</dt><dd>{stock.reserve[8] ? "Yes" : "No"}</dd></div>
                    <div><dt>Debt</dt><dd>{formatAmount(held.debt)} USDT</dd></div>
                    <div><dt>Health factor</dt><dd>{formatHealth(held.healthFactor)}</dd></div>
                    <div><dt>Market status</dt><dd>{statusLabel(stock)}</dd></div>
                    <div><dt>Borrow limit · {formatBps(borrowLtv(stock))}</dt><dd>{formatUsd(held.borrowLimit)}</dd></div>
                    <div><dt>Can borrow now</dt><dd>{formatAmount(actionLimit(data, stock.id, "borrow").max)} USDT</dd></div>
                  </dl>
                  <div className="dashboard-position-actions">
                    {backing && usdtDebt(data) > 0n && (
                      <Link href={`/app/borrow?market=${stock.id}&action=repay#manage-market`} aria-label={`Repay USDT borrowed against ${stock.id}`}>Repay</Link>
                    )}
                    <Link href={`/app/borrow?market=${stock.id}&action=borrow#manage-market`} aria-label={`Borrow USDT against ${stock.id}`}>Borrow</Link>
                    <Link href={`/app/borrow?market=${stock.id}&action=deposit#manage-market`} aria-label={`Add ${stock.id} collateral`}>Add collateral</Link>
                    <Link href={`/app/borrow?market=${stock.id}&action=withdraw#manage-market`} aria-label={`Withdraw ${stock.id}`}>Withdraw</Link>
                  </div>
                </li>
              );
            }) : (
              <li><p>{connected ? "No collateral or debt yet." : "Connect a wallet to see your positions."}</p><div className="dashboard-position-actions">
                <WalletAction className="btn"><Link href="/app/borrow?action=deposit#manage-market">Supply collateral</Link></WalletAction>
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
            {data && data.usdt.reserve[0] > 0n && connected ? (
              <li>
                <div className="app-asset"><TokenIcon symbol="USDT" size={32} /><strong>bluUSDT</strong></div>
                <dl>
                  <div><dt>bluUSDT balance</dt><dd>{formatAmount(data.usdt.reserve[0])}</dd></div>
                  <div><dt>Supply APR</dt><dd>{formatRate(data.supplyRate)}</dd></div>
                  <div><dt>Utilisation</dt><dd>{utilisation(data)}</dd></div>
                </dl>
                <div className="dashboard-position-actions">
                  <Link href="/app/earn?action=lend#manage-market" aria-label="Supply USDT to the pool">Supply</Link>
                  <Link href="/app/earn?action=redeem#manage-market" aria-label="Withdraw USDT from the pool">Withdraw</Link>
                </div>
              </li>
            ) : (
              <li><p>{connected ? "No USDT supplied yet." : "Connect a wallet to see your supply."}</p><div className="dashboard-position-actions">
                <Link href="/app/earn#manage-market">Supply USDT</Link>
              </div></li>
            )}
          </ul>
        </section>
      </div>
      <p className="wrap app-footnote">Live BNB Smart Chain data, valued by the pool’s oracle. <Link href="/app/simulator">Open the simulator</Link> for sample positions.</p>
    </main>
  );
}
