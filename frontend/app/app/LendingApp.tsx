"use client";

import { useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useDemoAccount } from "./DemoAccount";
import { health, money, quantity } from "./format";
import TokenIcon from "../components/TokenIcon";
import RiskPanel from "./risk/RiskPanel";
import { lendingPosition } from "../../src/lib/risk/adapter";
import { ILLUSTRATIVE_HAIRCUT, REGIME_LABEL, type Regime } from "../components/regimes";
import {
  ACTIONS, CENTS_PER_USDT, MARKETS, TOKENS_PER_UNIT, accountTotals,
  actionMaximum, applyAction, collateralValue, liquidity, marketMetrics, parseAmount, walletUsdt,
  type Action, type Market,
} from "./markets";

const SESSIONS = ["open", "extended", "closed", "weekend"] as const;
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
  const isLender = mode === "earn";
  const groups = isLender ? EARN_GROUPS : BORROW_GROUPS;
  const initialMarket = MARKETS.find(item => item.id === params.get("market")) ?? MARKETS[isLender ? 1 : 0];
  const initialAction = groups.flatMap(group => group.actions).find(item => item === params.get("action")) ?? (isLender ? "lend" : "borrow");

  return <MarketWorkspace key={`${initialMarket.id}-${initialAction}`} mode={mode} groups={groups}
    initialMarket={initialMarket} initialAction={initialAction} />;
}

function MarketWorkspace({ mode, groups, initialMarket, initialAction }: {
  mode: Mode;
  groups: readonly ActionGroup[];
  initialMarket: Market;
  initialAction: Action;
}) {
  const { positions, setPositions, regime, setRegime } = useDemoAccount();
  const [market, setMarket] = useState(initialMarket);
  const [action, setAction] = useState(initialAction);
  const [amount, setAmount] = useState("");
  const [feedback, setFeedback] = useState("");
  const workspace = useRef<HTMLElement>(null);
  const amountField = useRef<HTMLInputElement>(null);

  const position = positions[market.id];
  const isLender = mode === "earn";
  const definition = ACTIONS[action];
  const symbol = definition.collateral ? market.symbol : "USDT";
  const scale = definition.collateral ? TOKENS_PER_UNIT : CENTS_PER_USDT;
  const wallet = walletUsdt(positions);
  const maximum = actionMaximum(action, market, position, regime, wallet);
  const amountUnits = parseAmount(amount, scale);
  const invalidAmount = amount !== "" && (amountUnits <= 0 || amountUnits > maximum);
  const canSubmit = amountUnits > 0 && !invalidAmount;
  const amountError = invalidAmount
    ? amountUnits > maximum
      ? `Enter ${quantity.format(maximum / scale)} ${symbol} or less.`
      : `Enter a positive amount with up to ${definition.collateral ? 4 : 2} decimal places.`
    : "";
  const needsCollateral = action === "borrow" && position.collateral === 0;
  const current = marketMetrics(market, position, regime);
  const projected = canSubmit ? applyAction(position, action, amountUnits) : position;
  const preview = marketMetrics(market, projected, regime);
  const weekendHealth = marketMetrics(market, projected, "weekend").health;
  const totals = accountTotals(positions);
  const collateralAction = action === "deposit" || action === "withdraw";
  const rateLabel = isLender ? "Supply APR" : "Borrow APR";
  const rate = isLender ? market.supplyApr : market.borrowApr;
  const walletAfter = wallet + projected.debt - position.debt + position.supplied - projected.supplied;
  const previewRows = isLender ? [
    { label: "USDT supplied", before: money(position.supplied), after: money(projected.supplied) },
    { label: "Wallet balance", before: money(wallet), after: money(walletAfter) },
  ] : [
    collateralAction
      ? { label: "Collateral value", before: money(collateralValue(market, position)), after: money(collateralValue(market, projected)) }
      : { label: "Debt", before: money(position.debt), after: money(projected.debt) },
    { label: "Available to borrow", before: money(current.available), after: money(preview.available) },
    { label: "Health factor", before: health(current.health), after: health(preview.health) },
  ];

  function selectAction(next: Action) {
    setAction(next);
    setAmount("");
    setFeedback("");
  }

  function selectMarket(next: Market) {
    setMarket(next);
    setAmount("");
    setFeedback("");
    if (window.matchMedia("(max-width: 920px)").matches) workspace.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setPositions(previous => {
      const holding = previous[market.id];
      if (amountUnits > actionMaximum(action, market, holding, regime, walletUsdt(previous))) return previous;
      return { ...previous, [market.id]: applyAction(holding, action, amountUnits) };
    });
    setFeedback(`Simulation updated · ${quantity.format(amountUnits / scale)} ${symbol}`);
    setAmount("");
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
                <legend className="sr-only">Market session</legend>
                <div className="app-session-head" aria-hidden="true">
                  <span>Market session</span>
                  <span>{Math.round(ILLUSTRATIVE_HAIRCUT[regime] * 100)}% haircut</span>
                </div>
                <div className="app-session-options">
                  {SESSIONS.map(session => (
                    <label key={session}>
                      <input type="radio" name="market-session" value={session} checked={regime === session}
                        aria-describedby="session-haircut" onChange={() => { setRegime(session); setFeedback(""); }} />
                      <span>{session === "closed" ? "Overnight" : REGIME_LABEL[session]}</span>
                    </label>
                  ))}
                </div>
                <span className="sr-only" id="session-haircut">{Math.round(ILLUSTRATIVE_HAIRCUT[regime] * 100)}% collateral haircut</span>
              </fieldset>
            )}
          </div>
          <dl className="app-summary app-summary-pair">
            {isLender ? (
              <>
                <div><dt>USDT supplied</dt><dd>{money(totals.supplied)}</dd></div>
                <div><dt>Demo USDT balance</dt><dd>{money(wallet)}</dd></div>
              </>
            ) : (
              <>
                <div><dt>Collateral</dt><dd>{money(totals.collateral)}</dd></div>
                <div><dt>Debt</dt><dd>{money(totals.debt)}</dd></div>
              </>
            )}
          </dl>
        </div>
      </section>

      <div className="wrap app-workspace">
        <section aria-labelledby="markets-heading">
          <div className="app-section-heading">
            <h2 id="markets-heading">Markets</h2>
            <span className="app-unit"><TokenIcon symbol="USDT" size={18} /> USDT loans</span>
          </div>
          <table className="app-market-ledger" aria-labelledby="markets-heading">
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col" className={isLender ? "app-rate-priority" : undefined}>Supply APR</th>
                <th scope="col" className={!isLender ? "app-rate-priority" : undefined}>Borrow APR</th>
                <th scope="col" className="app-market-account">{isLender ? "Your supply" : "Can borrow"}</th>
                <th scope="col" className="app-market-liquidity">Liquidity</th>
              </tr>
            </thead>
            <tbody>
              {MARKETS.map(item => {
                const holding = positions[item.id];
                const accountValue = isLender ? holding.supplied : marketMetrics(item, holding, regime).available;
                return (
                  <tr key={item.id} data-selected={item.id === market.id}>
                    <th scope="row">
                      <button className="app-market-select app-asset" type="button" aria-controls="manage-market"
                        aria-pressed={item.id === market.id} onClick={() => selectMarket(item)}>
                        <TokenIcon symbol={item.id} size={32} />
                        <span>
                          <strong>{item.symbol}</strong><small className="app-market-name">{item.name}</small>
                          <small className="app-market-compact">{money(accountValue)} {isLender ? "supplied" : "available"}</small>
                        </span>
                      </button>
                    </th>
                    <td className={isLender ? "app-rate-priority" : undefined}>{item.supplyApr.toFixed(2)}%</td>
                    <td className={!isLender ? "app-rate-priority" : undefined}>{item.borrowApr.toFixed(2)}%</td>
                    <td className="app-market-account">{money(accountValue)}</td>
                    <td className="app-market-liquidity">{money(liquidity(item, holding))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="app-ticket" id="manage-market" tabIndex={-1} ref={workspace} aria-labelledby="ticket-title">
          <header className="app-ticket-head">
            <div className="app-asset">
              <TokenIcon symbol={market.id} size={36} />
              <h2 id="ticket-title">{market.symbol} / USDT</h2>
            </div>
            <dl className="app-ticket-rate"><dt>{rateLabel}</dt><dd>{rate.toFixed(2)}%</dd></dl>
          </header>

          <div className="app-ticket-body">
            <form onSubmit={submit}>
              <fieldset className="market-action-picker app-action-rail">
                <legend className="sr-only">{isLender ? "Earn action" : "Borrow market action"}</legend>
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
                  aria-describedby={invalidAmount ? "action-limit amount-error" : "action-limit"}
                  aria-invalid={invalidAmount || undefined}
                  onChange={event => { setAmount(event.target.value); setFeedback(""); }} />
                <span aria-hidden="true">{symbol}</span>
                <button type="button" disabled={maximum === 0}
                  onClick={() => { setAmount(String(maximum / scale)); setFeedback(""); }}>Max</button>
              </div>
              {invalidAmount && <p className="app-message" id="amount-error">{amountError}</p>}
              {needsCollateral && <p className="app-message">Supply {market.symbol} as collateral to borrow.</p>}
              {action === "borrow" && !needsCollateral && maximum === 0 && (
                <p className="app-message">Borrowing limit reached. Supply more collateral or repay debt.</p>
              )}

              {!needsCollateral && (
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
              <summary>{isLender ? "Market details" : "Risk and market details"}</summary>
              <dl className="app-preview">
                <div><dt>Market liquidity</dt><dd>{money(liquidity(market, position))}</dd></div>
                {!isLender && (
                  <>
                    <div><dt>Weekend health{canSubmit && " after action"}</dt><dd>{health(weekendHealth)}</dd></div>
                    <div><dt>Target / liquidation LTV</dt><dd>{(market.maxLtv * 100).toFixed(0)}% / {(market.liquidationLtv * 100).toLocaleString("en-US")}%</dd></div>
                  </>
                )}
              </dl>
            </details>
          </div>
        </section>
      </div>
      {!isLender && <details className="wrap risk-embedded"><summary>Analyse this demo position</summary>
        <RiskPanel key={JSON.stringify(lendingPosition(market, position))} position={lendingPosition(market, position)} />
      </details>}
      <p className="wrap app-footnote">Sample rates and balances. Simulated actions reset on refresh.</p>
    </main>
  );
}
