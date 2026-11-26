"use client";

import { useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useDemoAccount } from "./DemoAccount";
import RiskPanel from "./risk/RiskPanel";
import { lendingPosition } from "../../src/lib/risk/adapter";
import { health, ltv, money, percent, quantity } from "./format";
import TokenIcon from "../components/TokenIcon";
import CorpActionBanner from "./components/CorpActionBanner";
import {
  ACTIONS, BORROWING_DISCOUNT, CENTS_PER_USDT, RISK, SCHEDULED_STATUSES, STATUS_LABEL, STOCKS, TOKENS_PER_UNIT,
  actionLimits, borrowLtv, executeAction, isStockId, parseAmount, poolMetrics, positionMetrics, stockBorrowCap, stockById, stockStatus,
  type Action, type PoolState, type StockId,
} from "./markets";

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
  const { state } = useDemoAccount();
  const isLender = mode === "earn";
  const groups = isLender ? EARN_GROUPS : BORROW_GROUPS;
  const requested = params.get("market");
  const initialStock: StockId = isStockId(requested) ? requested : state.account.stock ?? "NVDAB";
  const initialAction = groups.flatMap(group => group.actions).find(item => item === params.get("action")) ?? (isLender ? "lend" : "borrow");

  return <MarketWorkspace key={`${requested ?? ""}-${initialAction}`} mode={mode} groups={groups}
    initialStock={initialStock} initialAction={initialAction} />;
}

/** Collateral value of the account in cents (zero without collateral). */
const accountCollateral = (state: PoolState) => positionMetrics(state).value;

function MarketWorkspace({ mode, groups, initialStock, initialAction }: {
  mode: Mode;
  groups: readonly ActionGroup[];
  initialStock: StockId;
  initialAction: Action;
}) {
  const { state, client } = useDemoAccount();
  const [stock, setStock] = useState(initialStock);
  const [action, setAction] = useState(initialAction);
  const [amount, setAmount] = useState("");
  const [feedback, setFeedback] = useState("");
  const workspace = useRef<HTMLElement>(null);
  const amountField = useRef<HTMLInputElement>(null);

  const isLender = mode === "earn";
  const account = state.account;
  const selected = stockById(stock);
  const definition = ACTIONS[action];
  const symbol = definition.collateral ? stock : "USDT";
  const scale = definition.collateral ? TOKENS_PER_UNIT : CENTS_PER_USDT;
  const limit = actionLimits(state, stock)[action];
  const maximum = limit.max;
  const amountUnits = parseAmount(amount, scale);
  const invalidAmount = amount !== "" && (amountUnits <= 0 || amountUnits > maximum);
  const canSubmit = amountUnits > 0 && !invalidAmount;
  const amountError = invalidAmount
    ? amountUnits > maximum
      ? `Enter ${quantity.format(maximum / scale)} ${symbol} or less.`
      : `Enter a positive amount with up to ${definition.collateral ? 4 : 2} decimal places.`
    : "";
  const needsCollateral = action === "borrow" && account.collateral === 0 && account.stock === null;
  const projectedState = canSubmit ? executeAction(state, action, stock, amountUnits).state : state;
  const pool = poolMetrics(state);
  const poolAfter = poolMetrics(projectedState);
  const current = positionMetrics(state);
  const preview = positionMetrics(projectedState);
  const status = stockStatus(state, stock);
  const collateralAction = action === "deposit" || action === "withdraw";
  const otherStock = account.stock !== null && account.stock !== stock ? account.stock : null;
  const previewRows = isLender ? [
    { label: "bluUSDT balance", before: money(account.supplied), after: money(projectedState.account.supplied) },
    { label: "Wallet USDT", before: money(account.usdt), after: money(projectedState.account.usdt) },
    { label: "Supply APR", before: percent(pool.supplyApr), after: percent(poolAfter.supplyApr) },
  ] : [
    collateralAction
      ? { label: "Collateral value", before: money(current.value), after: money(preview.value) }
      : { label: "Debt", before: money(account.debt), after: money(projectedState.account.debt) },
    { label: `Borrow limit · ${ltv(borrowLtv(status))} LTV`, before: money(current.borrowLimit), after: money(preview.borrowLimit) },
    { label: "Health factor", before: health(current.healthFactor), after: health(preview.healthFactor) },
  ];

  function selectAction(next: Action) {
    setAction(next);
    setAmount("");
    setFeedback("");
  }

  function selectStock(next: StockId) {
    setStock(next);
    setAmount("");
    setFeedback("");
    if (window.matchMedia("(max-width: 920px)").matches) workspace.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const result = client.act(action, stock, amountUnits);
    setFeedback(result.message);
    if (result.ok) setAmount("");
  }

  return (
    <main id="app-main" tabIndex={-1}>
      <section className="app-masthead" aria-labelledby="app-title">
        <div className="wrap">
          <p className="app-demo-label app-mobile-status">Simulation</p>
          <div className="app-heading">
            <div>
              <h1 id="app-title">{isLender ? <>Earn <em>with USDT.</em></> : <>Borrow <em>against stocks.</em></>}</h1>
            </div>
            {!isLender && (
              <fieldset className="market-action-picker app-session">
                <legend className="sr-only">Market status (demo)</legend>
                <div className="app-session-head" aria-hidden="true">
                  <span>Market status{state.scheduleSource === "clock" ? " · live" : " · demo"}</span>
                  <span>{Math.round(BORROWING_DISCOUNT[state.schedule] * 100)}% borrowing discount</span>
                </div>
                <div className="app-session-options">
                  {SCHEDULED_STATUSES.map(option => (
                    <label key={option}>
                      <input type="radio" name="market-status" value={option} checked={state.schedule === option}
                        aria-describedby="status-discount" onChange={() => { client.demo.setSchedule(option); setFeedback(""); }} />
                      <span>{STATUS_LABEL[option]}</span>
                    </label>
                  ))}
                </div>
                <span className="sr-only" id="status-discount">
                  {Math.round(BORROWING_DISCOUNT[state.schedule] * 100)}% borrowing discount. It lowers borrowing power only; health factor is unchanged.
                </span>
              </fieldset>
            )}
          </div>
          <dl className="app-summary app-summary-pair">
            {isLender ? (
              <>
                <div><dt>bluUSDT balance</dt><dd>{money(account.supplied)}</dd></div>
                <div><dt>Demo USDT balance</dt><dd>{money(account.usdt)}</dd></div>
              </>
            ) : (
              <>
                <div><dt>Collateral{account.stock ? ` · ${account.stock}` : ""}</dt><dd>{money(accountCollateral(state))}</dd></div>
                <div><dt>Debt</dt><dd>{money(account.debt)}</dd></div>
              </>
            )}
          </dl>
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
                        <small className="app-market-compact">{money(account.supplied)} supplied</small>
                      </span>
                    </span>
                  </th>
                  <td className="app-rate-priority">{percent(pool.supplyApr)}</td>
                  <td>{percent(pool.borrowApr)}</td>
                  <td className="app-market-account">{money(account.supplied)}</td>
                  <td className="app-market-liquidity">{money(pool.liquidity)}</td>
                </tr>
              </tbody>
            </table>
            <dl className="app-preview" style={{ marginInline: 16 }}>
              <div><dt>Utilisation</dt><dd>{percent(pool.utilisation, 1)}</dd></div>
              <div><dt>Total supplied</dt><dd>{money(state.supplied)}</dd></div>
              <div><dt>Total borrowed</dt><dd>{money(state.borrowed)}</dd></div>
              <div><dt>Available liquidity</dt><dd>{money(pool.liquidity)}</dd></div>
              <div><dt>Supply cap</dt><dd>{money(state.supplyCap)}</dd></div>
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
                  <th scope="col" className="app-market-account">Atlas price</th>
                  <th scope="col" className="app-rate-priority">Borrow LTV</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="app-market-liquidity">Liq. threshold</th>
                  <th scope="col" className="app-market-liquidity">Stock borrow cap</th>
                </tr>
              </thead>
              <tbody>
                {STOCKS.map(item => {
                  const itemStatus = stockStatus(state, item.id);
                  const cap = stockBorrowCap(state, item.id);
                  return (
                    <tr key={item.id} data-selected={item.id === stock}>
                      <th scope="row">
                        <button className="app-market-select app-asset" type="button" aria-controls="manage-market"
                          aria-pressed={item.id === stock} onClick={() => selectStock(item.id)}>
                          <TokenIcon symbol={item.id} size={32} />
                          <span>
                            <strong>{item.symbol}</strong>
                            <small className="app-market-name">{item.name}{account.stock === item.id ? " · your collateral" : ""}</small>
                            <small className="app-market-compact">{money(state.stocks[item.id].price)}</small>
                          </span>
                        </button>
                      </th>
                      <td className="app-market-account">{money(state.stocks[item.id].price)}</td>
                      <td className="app-rate-priority">{ltv(borrowLtv(itemStatus))}</td>
                      <td>{STATUS_LABEL[itemStatus]}</td>
                      <td className="app-market-liquidity">{ltv(RISK.liquidationThreshold)}</td>
                      <td className="app-market-liquidity">{money(state.stocks[item.id].debt)} / {money(cap)}</td>
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
              <dd>{percent(isLender ? pool.supplyApr : pool.borrowApr)}</dd>
            </dl>
          </header>

          <div className="app-ticket-body">
            {!isLender && <CorpActionBanner state={state} stock={stock} />}
            <form onSubmit={submit}>
              <fieldset className="market-action-picker app-action-rail">
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
                <span id="action-limit">{quantity.format(maximum / scale)} {symbol} available</span>
              </div>
              <div className="app-amount">
                <input id="action-amount" ref={amountField} inputMode="decimal" placeholder="0.00" value={amount}
                  aria-describedby={invalidAmount ? "action-limit amount-error" : limit.reason ? "action-limit action-reason" : "action-limit"}
                  aria-invalid={invalidAmount || undefined}
                  onChange={event => { setAmount(event.target.value); setFeedback(""); }} />
                <span aria-hidden="true">{symbol}</span>
                <button type="button" disabled={maximum === 0}
                  onClick={() => { setAmount(String(maximum / scale)); setFeedback(""); }}>Max</button>
              </div>
              {invalidAmount && <p className="app-message" id="amount-error">{amountError}</p>}
              {!invalidAmount && !needsCollateral && limit.reason && <p className="app-message" id="action-reason">{limit.reason}</p>}
              {needsCollateral && <p className="app-message">Supply {selected.symbol} as collateral to borrow.</p>}

              {!needsCollateral && !otherStock && (
                <div className="app-position-preview">
                  <p>{canSubmit ? "Position preview" : "Current position"}</p>
                  <dl className="app-preview">
                    {previewRows.map(({ label, before, after }) => (
                      <div key={label}><dt>{label}</dt><dd>{before}{before !== after && (
                        <> <span aria-hidden="true">→</span><span className="sr-only"> after action </span> <strong>{after}</strong></>
                      )}</dd></div>
                    ))}
                  </dl>
                </div>
              )}
              {needsCollateral ? (
                <button className="btn app-submit" type="button" onClick={() => {
                  selectAction("deposit");
                  amountField.current?.focus();
                }}>Supply collateral</button>
              ) : (
                <button className="btn app-submit" type="submit" disabled={!canSubmit}>
                  {definition.label}<span className="sr-only"> (simulation)</span>
                </button>
              )}
              <p className="app-feedback" role="status">{feedback}</p>
            </form>
            <details className="app-risk-details">
              <summary>{isLender ? "Pool details" : "Risk and market details"}</summary>
              <dl className="app-preview">
                <div><dt>Pool USDT available</dt><dd>{money(pool.liquidity)}</dd></div>
                <div><dt>Utilisation</dt><dd>{percent(pool.utilisation, 1)}</dd></div>
                {isLender ? (
                  <>
                    <div><dt>Rate model</dt><dd>2% base, 80% optimal</dd></div>
                    <div><dt>Reserve factor</dt><dd>10%</dd></div>
                  </>
                ) : (
                  <>
                    <div><dt>Status · {STATUS_LABEL[status]}</dt><dd>{ltv(borrowLtv(status))} borrow LTV</dd></div>
                    <div><dt>Liquidation threshold / bonus</dt><dd>{ltv(RISK.liquidationThreshold)} / {ltv(RISK.liquidationBonus)}</dd></div>
                    <div><dt>Stock borrow cap ({STATUS_LABEL[status].toLowerCase()})</dt>
                      <dd>{money(state.stocks[stock].debt)} / {money(stockBorrowCap(state, stock))}</dd></div>
                    {account.stock === stock && current.liquidationPrice !== null && (
                      <div><dt>Liquidation price</dt><dd>{money(current.liquidationPrice)}</dd></div>
                    )}
                  </>
                )}
              </dl>
              {isLender ? (
                <p className="app-message">Borrowers against every listed stock draw from this one reserve, so suppliers share exposure across all collateral.</p>
              ) : (
                <p className="app-message">The market status discount lowers borrowing power (and withdrawals while in debt) only. Health factor and liquidation always use the {ltv(RISK.liquidationThreshold)} threshold.</p>
              )}
            </details>
          </div>
        </section>
      </div>
      {!isLender && <details className="wrap risk-embedded">
        <summary>Assess this position with the risk backend</summary>
        <RiskPanel key={JSON.stringify(lendingPosition(state, stock))} position={lendingPosition(state, stock)} />
      </details>}
      <p className="wrap app-footnote">Sample rates and balances. Interest does not accrue in the simulation. Simulated actions reset on refresh.</p>
    </main>
  );
}
