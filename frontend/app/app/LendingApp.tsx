"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import RiskPanel from "./risk/RiskPanel";
import TokenIcon from "../components/TokenIcon";
import { ReadStatus, TxFeedback, WalletAction } from "./live/LiveParts";
import { EXPLORER, useBlueState, useBlueTransactions } from "./live/useBlueLive";
import {
  ACTIONS, BORROWING_DISCOUNT, MARKET_STATUSES, SCHEDULED_STATUSES, STATUS_LABEL, STOCKS, isStockId, stockById,
  type Action, type StockId,
} from "./markets";
import { BLUE, IS_DEMO, parseTokenAmount } from "../../src/lib/blue/mainnet";
import {
  accountStock, actionLimit, blockingStock, borrowGate, borrowLtv, formatAmount, formatBps, formatHealth, formatRate,
  formatUsd, isEligible, liveRiskPosition, liveStock, position, stockCap, stockValue, usdtDebt, usdtValue, utilisation,
  type LiveState,
} from "../../src/lib/blue/live-position";

const ACTION_LABELS: Record<Action, string> = {
  borrow: "Borrow", repay: "Repay", deposit: "Supply", withdraw: "Withdraw", lend: "Supply", redeem: "Withdraw",
};

type ActionGroup = { label?: string; actions: readonly Action[] };

const BORROW_GROUPS: readonly ActionGroup[] = [
  { label: "Loan", actions: ["borrow", "repay"] },
  { label: "Collateral", actions: ["deposit", "withdraw"] },
];
const EARN_GROUPS: readonly ActionGroup[] = [{ actions: ["lend", "redeem"] }];
type Mode = "borrow" | "earn";

export default function LendingApp({ mode }: { mode: Mode }) {
  const params = useSearchParams();
  const { address } = useAccount();
  const isLender = mode === "earn";
  const groups = isLender ? EARN_GROUPS : BORROW_GROUPS;
  const requested = params.get("market");
  const requestedStock = isStockId(requested) ? requested : null;
  const initialAction = groups.flatMap(group => group.actions).find(item => item === params.get("action")) ?? (isLender ? "lend" : "borrow");

  return <MarketWorkspace key={`${address ?? ""}-${requested ?? ""}-${initialAction}`} mode={mode} groups={groups}
    requestedStock={requestedStock} initialAction={initialAction} />;
}

function MarketWorkspace({ mode, groups, requestedStock, initialAction }: {
  mode: Mode;
  groups: readonly ActionGroup[];
  requestedStock: StockId | null;
  initialAction: Action;
}) {
  const query = useBlueState();
  const data: LiveState | undefined = query.data;
  const tx = useBlueTransactions(query.refetch);
  const { address } = useAccount();
  const [picked, setPicked] = useState<StockId | null>(requestedStock);
  const [action, setAction] = useState(initialAction);
  const [amount, setAmount] = useState("");
  const workspace = useRef<HTMLElement>(null);
  const amountField = useRef<HTMLInputElement>(null);

  const isLender = mode === "earn";
  const connected = !!address && !!data?.account;
  const stock: StockId = picked ?? (data && accountStock(data)?.id) ?? "NVDAB";
  const selected = stockById(stock);
  const market = data ? liveStock(data, stock) : undefined;
  const definition = ACTIONS[action];
  const symbol = definition.collateral ? stock : "USDT";
  const limit = data ? actionLimit(data, stock, action) : { max: 0n, reason: undefined };
  const units = parseTokenAmount(amount);
  const invalidAmount = amount !== "" && (units === undefined || (connected && units > limit.max));
  const usable = !!data && !query.isError;
  const canSubmit = usable && connected && units !== undefined && units <= limit.max;
  const amountError = invalidAmount
    ? units !== undefined && units > limit.max
      ? `Enter ${formatAmount(limit.max)} ${symbol} or less.`
      : "Enter a positive amount with up to 18 decimal places."
    : "";

  const held = data ? accountStock(data) : undefined;
  const current = data && market ? position(data, market) : undefined;
  const blocking = data && market ? blockingStock(data, market) : undefined;
  const otherStock = !isLender && blocking ? blocking.id : null;
  const noCollateral = connected && !!market && !otherStock && market.reserve[0] === 0n;
  const needsCollateral = action === "borrow" && noCollateral;
  const needsEnable = connected && !isLender && !!market && !otherStock && market.reserve[0] > 0n && !market.reserve[8];
  const needsEligibility = action === "borrow" && connected && !!market && !otherStock && !isEligible(market);
  const gate = data && market ? borrowGate(data, market) : undefined;
  const status = market?.market === undefined ? undefined : MARKET_STATUSES[market.market];
  const scheduled = SCHEDULED_STATUSES.find(option => option === status);
  const discount = scheduled ? `${Math.round(BORROWING_DISCOUNT[scheduled] * 100)}% borrowing discount` : status ? "Borrowing blocked" : "—";

  function previewRows() {
    if (!data || !market) return [];
    const change = canSubmit ? units! : 0n;
    if (isLender) {
      const sign = action === "lend" ? 1n : -1n;
      return [
        { label: "bluUSDT balance", before: formatAmount(data.usdt.reserve[0]), after: formatAmount(data.usdt.reserve[0] + sign * change) },
        { label: "Wallet USDT", before: formatAmount(data.usdt.wallet), after: formatAmount(data.usdt.wallet - sign * change) },
        { label: "Supply APR", before: formatRate(data.supplyRate), after: formatRate(data.supplyRate) },
      ];
    }
    const after = position(data, market, action === "deposit" ? { collateral: change, enable: change > 0n }
      : action === "withdraw" ? { collateral: -change }
        : action === "borrow" ? { debt: change } : { debt: -change });
    return [
      action === "deposit" || action === "withdraw"
        ? { label: "Collateral value", before: formatUsd(current!.collateralValue), after: formatUsd(after.collateralValue) }
        : { label: "Debt (USDT)", before: formatAmount(current!.debt), after: formatAmount(after.debt) },
      { label: `Borrow limit · ${formatBps(borrowLtv(market))} LTV`, before: formatUsd(current!.borrowLimit), after: formatUsd(after.borrowLimit) },
      { label: "Health factor", before: formatHealth(current!.healthFactor), after: formatHealth(after.healthFactor) },
    ];
  }

  function selectAction(next: Action) {
    setAction(next);
    setAmount("");
    tx.clearFeedback();
  }

  function selectStock(next: StockId) {
    if (tx.busy) return;
    setPicked(next);
    setAmount("");
    tx.clearFeedback();
    if (window.matchMedia("(max-width: 920px)").matches) workspace.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !data || !market || tx.busy) return;
    // Keep the stock fixed while the account's collateral changes under it.
    setPicked(stock);
    const result = await tx.execute(data, action, market, units!);
    if (result.ok) setAmount("");
  }

  const accountValue = data && held ? stockValue(held.reserve[0], held) : 0n;

  return (
    <main id="app-main" tabIndex={-1}>
      <section className="app-masthead" aria-labelledby="app-title">
        <div className="wrap">
          <p className="app-demo-label app-mobile-status">BNB Mainnet</p>
          <div className="app-heading">
            <div>
              <h1 id="app-title">{isLender ? <>Earn <em>with USDT.</em></> : <>Borrow <em>against stocks.</em></>}</h1>
            </div>
            {!isLender && (
              <fieldset className="market-action-picker app-session">
                <legend className="sr-only">{stock} market status, read from the onchain calendar</legend>
                <div className="app-session-head">
                  <span>{stock} market status · live</span>
                  <span>{discount}</span>
                </div>
                <div className="app-session-options">
                  {/* A halt or corporate action replaces the scheduled sessions. */}
                  {(status && !scheduled ? [status] : SCHEDULED_STATUSES).map(option => (
                    <label key={option}>
                      <input type="radio" name="market-status" value={option} checked={status === option} readOnly disabled />
                      <span>{STATUS_LABEL[option]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
          <dl className="app-summary app-summary-pair">
            {isLender ? (
              <>
                <div><dt>bluUSDT balance</dt><dd>{connected ? formatAmount(data.usdt.reserve[0]) : "—"}</dd></div>
                <div><dt>Wallet USDT</dt><dd>{connected ? formatAmount(data.usdt.wallet) : "—"}</dd></div>
              </>
            ) : (
              <>
                <div><dt>Collateral{connected && held ? ` · ${held.id}` : ""}</dt><dd>{connected ? formatUsd(accountValue) : "—"}</dd></div>
                <div><dt>Debt (USDT)</dt><dd>{connected ? formatAmount(usdtDebt(data)) : "—"}</dd></div>
              </>
            )}
          </dl>
          <ReadStatus query={query} />
        </div>
      </section>

      <div className="wrap app-workspace">
        {isLender ? (
          <section className="app-market-panel" aria-labelledby="markets-heading">
            <div className="app-section-heading">
              <h2 id="markets-heading">USDT pool</h2>
              <span className="app-unit">One shared reserve</span>
            </div>
            <table className="app-market-ledger" aria-labelledby="markets-heading">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col" className="app-rate-priority">Supply APR</th>
                  <th scope="col">Borrow APR</th>
                  <th scope="col" className="app-market-account">Your bluUSDT</th>
                  <th scope="col" className="app-market-liquidity">Available</th>
                </tr>
              </thead>
              <tbody>
                <tr data-selected="true">
                  <th scope="row">
                    <span className="app-asset">
                      <TokenIcon symbol="USDT" size={32} />
                      <span>
                        <strong>USDT</strong><small className="app-market-name">Receive bluUSDT</small>
                        {connected && <small className="app-market-compact">{formatAmount(data.usdt.reserve[0])} supplied</small>}
                      </span>
                    </span>
                  </th>
                  <td className="app-rate-priority">{data ? formatRate(data.supplyRate) : "—"}</td>
                  <td>{data ? formatRate(data.borrowRate) : "—"}</td>
                  <td className="app-market-account">{connected ? formatAmount(data.usdt.reserve[0]) : "—"}</td>
                  <td className="app-market-liquidity">{data ? formatAmount(data.liquidity) : "—"}</td>
                </tr>
              </tbody>
            </table>
            <dl className="app-preview" style={{ marginInline: 16 }}>
              <div><dt>Utilisation</dt><dd>{data ? utilisation(data) : "—"}</dd></div>
              <div><dt>Total supplied</dt><dd>{data ? `${formatAmount(data.totalSupplied)} USDT` : "—"}</dd></div>
              <div><dt>Total borrowed</dt><dd>{data ? `${formatAmount(data.totalBorrowed)} USDT` : "—"}</dd></div>
              <div><dt>Available liquidity</dt><dd>{data ? `${formatAmount(data.liquidity)} USDT` : "—"}</dd></div>
              <div><dt>Supply cap</dt><dd>{data ? `${data.caps[1].toLocaleString("en-US")} USDT` : "—"}</dd></div>
              <div><dt>Collateral</dt><dd>{STOCKS.map(item => item.id).join(", ")}</dd></div>
            </dl>
          </section>
        ) : (
          <section className="app-market-panel" aria-labelledby="markets-heading">
            <div className="app-section-heading">
              <h2 id="markets-heading">Collateral</h2>
              <span className="app-unit"><TokenIcon symbol="USDT" size={18} /> One stock per account</span>
            </div>
            <table className="app-market-ledger" aria-labelledby="markets-heading">
              <thead>
                <tr>
                  <th scope="col">Stock</th>
                  <th scope="col" className="app-market-account">Oracle price</th>
                  <th scope="col" className="app-rate-priority">Borrow LTV</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="app-market-liquidity">Liq. threshold</th>
                  <th scope="col" className="app-market-liquidity">Stock debt / cap</th>
                </tr>
              </thead>
              <tbody>
                {STOCKS.map(item => {
                  const row = data ? liveStock(data, item.id) : undefined;
                  const yours = connected && !!row && row.reserve[0] > 0n;
                  const price = row ? formatUsd(row.price) : "—";
                  return (
                    <tr key={item.id} data-selected={item.id === stock}>
                      <th scope="row">
                        <button className="app-market-select app-asset" type="button" aria-controls="manage-market"
                          aria-pressed={item.id === stock} disabled={tx.busy} onClick={() => selectStock(item.id)}>
                          <TokenIcon symbol={item.id} size={32} />
                          <span>
                            <strong>{item.symbol}</strong>
                            <small className="app-market-name">{item.name}{yours ? " · supplied" : ""}</small>
                            <small className="app-market-compact">{price}</small>
                          </span>
                        </button>
                      </th>
                      <td className="app-market-account">{price}</td>
                      <td className="app-rate-priority">{row ? formatBps(borrowLtv(row)) : "—"}</td>
                      <td>{row?.market === undefined ? "—" : STATUS_LABEL[MARKET_STATUSES[row.market]]}
                        {data && row && borrowGate(data, row) && <small style={{ display: "block" }}>Borrowing gated</small>}</td>
                      <td className="app-market-liquidity">{row ? formatBps(row.liquidationThreshold) : "—"}</td>
                      <td className="app-market-liquidity">{row ? `${formatAmount(row.debt)} / ${formatAmount(stockCap(row).cap)} USDT` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        <section className="app-ticket" id="manage-market" tabIndex={-1} ref={workspace} aria-labelledby="ticket-title">
          <header className="app-ticket-head">
            <div className="app-asset">
              <TokenIcon symbol={isLender ? "USDT" : stock} size={36} />
              <h2 id="ticket-title">{isLender ? "USDT pool" : `${selected.symbol} / USDT`}</h2>
            </div>
            <dl className="app-ticket-rate">
              <dt>{isLender ? "Supply APR" : "Borrow APR"}</dt>
              <dd>{data ? formatRate(isLender ? data.supplyRate : data.borrowRate) : "—"}</dd>
            </dl>
          </header>

          <div className="app-ticket-body">
            {!isLender && gate && <div className="dapp-banner" role="status"><strong>New borrowing is gated.</strong> {gate} Repayment stays available.</div>}
            <form onSubmit={submit}>
              <fieldset className="market-action-picker app-action-rail" disabled={tx.busy}>
                <legend className="sr-only">{isLender ? "Earn action" : "Borrow action"}</legend>
                {groups.map(group => (
                  <div className="market-action-pair" key={group.label ?? "earn"}>
                    {group.actions.map(next => (
                      <label key={next}>
                        <input type="radio" name="market-action" value={next} checked={action === next}
                          aria-label={ACTIONS[next].label} onChange={() => selectAction(next)} />
                        <span>{ACTION_LABELS[next]}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </fieldset>

              <div className="app-amount-heading">
                <label htmlFor="action-amount">Amount</label>
                <span id="action-limit">{connected ? `${formatAmount(limit.max)} ${symbol} available` : "Connect to see your limit"}</span>
              </div>
              <div className="app-amount">
                <input id="action-amount" ref={amountField} inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount}
                  disabled={tx.busy}
                  aria-describedby={invalidAmount ? "action-limit amount-error" : limit.reason ? "action-limit action-reason" : "action-limit"}
                  aria-invalid={invalidAmount || undefined}
                  onChange={event => { setAmount(event.target.value); tx.clearFeedback(); }} />
                <span aria-hidden="true">{symbol}</span>
                <button type="button" disabled={tx.busy || limit.max === 0n}
                  onClick={() => { setAmount(formatUnits(limit.max, 18)); tx.clearFeedback(); }}>Max</button>
              </div>
              {invalidAmount && <p className="app-message" id="amount-error">{amountError}</p>}
              {!invalidAmount && !needsCollateral && connected && limit.reason && <p className="app-message" id="action-reason">{limit.reason}</p>}
              {needsCollateral && <p className="app-message">Supply {selected.symbol} as collateral to borrow.</p>}

              {connected && !needsCollateral && !otherStock && (
                <div className="app-position-preview">
                  <p>{canSubmit ? "Position preview" : "Current position"}</p>
                  <dl className="app-preview">
                    {previewRows().map(({ label, before, after }) => (
                      <div key={label}><dt>{label}</dt><dd>{before}{before !== after && (
                        <> <span aria-hidden="true">→</span><span className="sr-only"> after action </span> <strong>{after}</strong></>
                      )}</dd></div>
                    ))}
                  </dl>
                </div>
              )}
              <WalletAction>
                {needsEnable && action !== "withdraw" && (
                  <button className="btn app-submit" type="button" disabled={!usable || tx.busy}
                    onClick={() => { setPicked(stock); void tx.enableCollateral(market!); }}>Enable {stock} as collateral</button>
                )}
                {needsEligibility && !needsCollateral && (
                  <button className="btn app-submit" type="button" disabled={!usable || tx.busy}
                    onClick={() => { setPicked(stock); void tx.requestEligibility(market!); }}>Request {stock} eligibility</button>
                )}
                {needsCollateral ? (
                  <button className="btn app-submit" type="button" disabled={tx.busy} onClick={() => {
                    selectAction("deposit");
                    amountField.current?.focus();
                  }}>Supply collateral</button>
                ) : (
                  <button className="btn app-submit" type="submit" disabled={!canSubmit || tx.busy}>
                    {tx.busy ? "Wallet action in progress" : definition.label}
                  </button>
                )}
              </WalletAction>
              <TxFeedback feedback={tx.feedback} />
            </form>
            <details className="app-risk-details">
              <summary>{isLender ? "Pool details" : "Risk and market details"}</summary>
              {data && market && (
                <dl className="app-preview">
                  <div><dt>Pool USDT available</dt><dd>{formatAmount(data.liquidity)} USDT</dd></div>
                  <div><dt>Utilisation</dt><dd>{utilisation(data)}</dd></div>
                  {isLender ? (
                    <>
                      <div><dt>Supply cap</dt><dd>{data.caps[1].toLocaleString("en-US")} USDT</dd></div>
                      <div><dt>Borrow cap</dt><dd>{data.caps[0].toLocaleString("en-US")} USDT</dd></div>
                    </>
                  ) : (
                    <>
                      <div><dt>Status · {status ? STATUS_LABEL[status] : "Unavailable"}</dt><dd>{formatBps(borrowLtv(market))} borrow LTV</dd></div>
                      <div><dt>Liquidation threshold / bonus</dt>
                        <dd>{formatBps(market.liquidationThreshold)} / {formatBps(market.liquidationBonus === undefined ? undefined : market.liquidationBonus - 10_000n)}</dd></div>
                      <div><dt>Stock debt / cap{stockCap(market).fromLaunch ? " (launch setting)" : ""}</dt>
                        <dd>{formatAmount(market.debt)} / {formatAmount(stockCap(market).cap)} USDT</dd></div>
                      <div><dt>{stock} price ready for borrowing</dt><dd>{market.sourceReady === undefined ? "Unavailable" : market.sourceReady ? "Yes" : "No"}</dd></div>
                      <div><dt>USDT price ready for borrowing</dt><dd>{data.usdt.sourceReady === undefined ? "Unavailable" : data.usdt.sourceReady ? "Yes" : "No"}</dd></div>
                      <div><dt>Keeper and hold checks</dt><dd>{gate ? "Blocked" : "Passing"}</dd></div>
                      {connected && <div><dt>Your eligibility</dt><dd>{isEligible(market)
                        ? `Until ${new Date(Number(market.eligibleUntil) * 1000).toLocaleString()}` : "Not registered"}</dd></div>}
                      {connected && current?.liquidationPrice !== null && current?.liquidationPrice !== undefined && (
                        <div><dt>Liquidation price</dt><dd>{formatUsd(current.liquidationPrice)}</dd></div>
                      )}
                    </>
                  )}
                </dl>
              )}
              {isLender ? (
                <p className="app-message">Borrowers against every listed stock draw from this one reserve, so suppliers share exposure across all collateral.</p>
              ) : (
                <p className="app-message">The market status discount lowers borrowing power (and withdrawals while in debt) only. Health factor and liquidation always use the liquidation threshold.</p>
              )}
              <p className="app-message"><a href={`${EXPLORER}/address/${BLUE.pool}`} target="_blank" rel="noopener noreferrer">View the pool on BscScan</a></p>
            </details>
          </div>
        </section>
      </div>
      {!isLender && data && <details className="wrap risk-embedded">
        <summary>Stress-test this position with synthetic advisory scenarios</summary>
        <LiveRisk state={data} stock={stock} />
      </details>}
      <p className="wrap app-footnote">{IS_DEMO ? "Demo market on BNB Smart Chain using test tokens with no value. Wallet approvals use real BNB gas." : "Live BNB Smart Chain data. Wallet approvals move real tokens and use BNB gas."} Unaudited hackathon contracts with prototype risk limits. <Link href="/app/simulator">Open the simulator</Link>.</p>
    </main>
  );
}

function LiveRisk({ state, stock }: { state: LiveState; stock: StockId }) {
  const risk = liveRiskPosition(state, stock);
  // Results reset when the position changes materially, and survive routine price refreshes.
  return <RiskPanel key={`${risk.symbol}-${risk.quantity.toFixed(4)}-${risk.debtUsd.toFixed(0)}-${risk.unsupported ?? ""}`} position={risk} live />;
}
