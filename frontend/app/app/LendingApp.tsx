"use client";

import { useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useDemoAccount } from "./DemoAccount";
import { health, money, quantity } from "./format";
import { IconArrow } from "../components/Icons";
import TokenIcon from "../components/TokenIcon";
import { ILLUSTRATIVE_HAIRCUT, REGIME_LABEL, type Regime } from "../components/regimes";
import {
  ACTIONS, CENTS_PER_USDT, MARKETS, TOKENS_PER_UNIT, accountTotals,
  actionMaximum, applyAction, liquidity, marketMetrics, parseAmount, walletUsdt,
  type Action, type Market,
} from "./markets";

const SESSIONS = ["open", "extended", "closed", "weekend"] as const;
const BORROWER_ACTIONS = ["deposit", "borrow", "repay", "withdraw"] as const;
const LENDER_ACTIONS = ["lend", "redeem"] as const;
type Mode = "borrow" | "earn";

export default function LendingApp({ mode }: { mode: Mode }) {
  const params = useSearchParams();
  const isLender = mode === "earn";
  const actions: readonly Action[] = isLender ? LENDER_ACTIONS : BORROWER_ACTIONS;
  const initialMarket = MARKETS.find(item => item.id === params.get("market")) ?? MARKETS[isLender ? 1 : 0];
  const initialAction = actions.find(item => item === params.get("action")) ?? (isLender ? "lend" : "borrow");

  return <MarketWorkspace key={`${initialMarket.id}-${initialAction}`} mode={mode} actions={actions}
    initialMarket={initialMarket} initialAction={initialAction} />;
}

function MarketWorkspace({ mode, actions, initialMarket, initialAction }: {
  mode: Mode;
  actions: readonly Action[];
  initialMarket: Market;
  initialAction: Action;
}) {
  const { positions, setPositions, regime, setRegime } = useDemoAccount();
  const [market, setMarket] = useState(initialMarket);
  const [action, setAction] = useState(initialAction);
  const [amount, setAmount] = useState("");
  const [feedback, setFeedback] = useState("");
  const workspace = useRef<HTMLElement>(null);

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
  const current = marketMetrics(market, position, regime);
  const projected = canSubmit ? applyAction(position, action, amountUnits) : position;
  const preview = marketMetrics(market, projected, regime);
  const weekendHealth = marketMetrics(market, projected, "weekend").health;
  const totals = accountTotals(positions);
  const collateralAction = action === "deposit" || action === "withdraw";
  const metricLabel = isLender ? "USDT supplied" : collateralAction ? "Borrowing power" : "Health factor";
  const metricBefore = isLender ? money(position.supplied) : collateralAction ? money(current.available) : health(current.health);
  const metricAfter = isLender ? money(projected.supplied) : collateralAction ? money(preview.available) : health(preview.health);

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
            {!isLender && <div className="app-session">
              <label htmlFor="market-session">Market session</label>
              <select id="market-session" value={regime} onChange={event => {
                setRegime(event.target.value as Regime);
                setFeedback("");
              }}>
                {SESSIONS.map(session => <option key={session} value={session}>{REGIME_LABEL[session]}</option>)}
              </select>
              <p>{Math.round(ILLUSTRATIVE_HAIRCUT[regime] * 100)}% collateral haircut</p>
            </div>}
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
          <div className="app-market-ledger">
            <div className="app-market-head" aria-hidden="true">
              <span>Market</span><span>Supply APR</span><span>Borrow APR</span><span className="app-market-liquidity">Liquidity</span><span />
            </div>
            <ul aria-label="Isolated markets">
              {MARKETS.map(item => (
                <li key={item.id}>
                  <button className="app-market-row" type="button"
                    aria-pressed={item.id === market.id}
                    onClick={() => selectMarket(item)}>
                    <span className="app-asset">
                      <TokenIcon symbol={item.id} size={36} />
                      <span><strong>{item.symbol}</strong><small>{item.name}</small></span>
                    </span>
                    <span><span className="sr-only">Supply APR </span>{item.supplyApr.toFixed(2)}%</span>
                    <span><span className="sr-only">Borrow APR </span>{item.borrowApr.toFixed(2)}%</span>
                    <span className="app-market-liquidity"><span className="sr-only">Liquidity </span>{money(liquidity(item, positions[item.id]))}</span>
                    <IconArrow />
                  </button>
                </li>
              ))}
            </ul>
          </div>

        </section>

        <section className="app-ticket" id="manage-market" tabIndex={-1} ref={workspace} aria-labelledby="ticket-title">
          <header className="app-ticket-head">
            <div className="app-asset">
              <TokenIcon symbol={market.id} size={36} />
              <h2 id="ticket-title">{market.symbol} / USDT</h2>
            </div>
          </header>

          <div className="app-ticket-body">
            <form onSubmit={submit}>
              {isLender ? (
                <fieldset className="earn-action-picker">
                  <legend className="sr-only">Earn action</legend>
                  {LENDER_ACTIONS.map(next => (
                    <label key={next}>
                      <input type="radio" name="earn-action" value={next} checked={action === next}
                        onChange={() => selectAction(next)} />
                      <span>{next === "lend" ? "Supply" : "Withdraw"}</span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <div className="app-action-choice">
                  <label htmlFor="market-action">Action</label>
                  <select id="market-action" value={action} onChange={event => selectAction(event.target.value as Action)}>
                    {actions.map(next => <option key={next} value={next}>{ACTIONS[next].label}</option>)}
                  </select>
                </div>
              )}

              <div className="app-amount-heading">
                <label htmlFor="action-amount">Amount</label>
                <span id="action-limit">{quantity.format(maximum / scale)} {symbol} available</span>
              </div>
              <div className="app-amount">
                <input id="action-amount" inputMode="decimal" placeholder="0.00" value={amount}
                  aria-describedby={invalidAmount ? "action-limit amount-error" : "action-limit"}
                  aria-invalid={invalidAmount || undefined}
                  onChange={event => { setAmount(event.target.value); setFeedback(""); }} />
                <span aria-hidden="true">{symbol}</span>
                <button type="button" disabled={maximum === 0}
                  onClick={() => { setAmount(String(maximum / scale)); setFeedback(""); }}>Max</button>
              </div>
              {invalidAmount && <p className="app-message" id="amount-error">Use a positive amount within the limit ({definition.collateral ? 4 : 2} decimal places max).</p>}
              {action === "borrow" && maximum === 0 && <p className="app-message">Supply collateral to unlock borrowing.</p>}

              <dl className="app-preview">
                <div><dt>{metricLabel}</dt><dd>{metricBefore}{metricAfter !== metricBefore && (
                  <> <span aria-hidden="true">→</span><span className="sr-only"> after action </span> <strong>{metricAfter}</strong></>
                )}</dd></div>
              </dl>
              <button className="btn app-submit" type="submit" disabled={!canSubmit}>
                {definition.label}<span className="sr-only"> (simulation)</span>
              </button>
              <p className="app-feedback" role="status">{feedback}</p>
            </form>
            <details className="app-risk-details">
              <summary>{isLender ? "Market details" : "Risk and market details"}</summary>
              <dl className="app-preview">
                <div><dt>Market liquidity</dt><dd>{money(liquidity(market, position))}</dd></div>
                {isLender ? (
                  <div><dt>Supply APR</dt><dd>{market.supplyApr.toFixed(2)}%</dd></div>
                ) : (
                  <>
                    <div><dt>Available to borrow{canSubmit && " after action"}</dt><dd>{money(preview.available)}</dd></div>
                    <div><dt>Weekend health{canSubmit && " after action"}</dt><dd>{health(weekendHealth)}</dd></div>
                    <div><dt>Target / liquidation LTV</dt><dd>{(market.maxLtv * 100).toFixed(0)}% / {(market.liquidationLtv * 100).toLocaleString("en-US")}%</dd></div>
                  </>
                )}
              </dl>
            </details>
          </div>
        </section>
      </div>
      <p className="wrap app-footnote">Sample rates and balances. Simulated actions reset on refresh.</p>
    </main>
  );
}
