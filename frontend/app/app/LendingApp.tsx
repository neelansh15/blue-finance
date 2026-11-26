"use client";

import { useRef, useState, type FormEvent } from "react";
import { IconArrow } from "../components/Icons";
import TokenIcon from "../components/TokenIcon";
import { ILLUSTRATIVE_HAIRCUT, REGIME_LABEL, type Regime } from "../components/regimes";
import {
  ACTIONS, CENTS_PER_USDT, MARKETS, STARTING_POSITIONS, TOKENS_PER_UNIT,
  actionMaximum, applyAction, collateralValue, liquidity, marketMetrics, parseAmount, walletUsdt,
  type Action, type Market, type Positions,
} from "./markets";

const SESSIONS = ["open", "extended", "closed", "weekend"] as const;
const BORROWER_ACTIONS = ["deposit", "borrow", "repay", "withdraw"] as const;
const LENDER_ACTIONS = ["lend", "redeem"] as const;
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const quantity = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const money = (cents: number) => dollars.format(cents / CENTS_PER_USDT);
const health = (value: number | null) => value === null ? "No debt" : `${value.toFixed(2)}×`;

export default function LendingApp() {
  const [market, setMarket] = useState<Market>(MARKETS[0]);
  const [positions, setPositions] = useState<Positions>(STARTING_POSITIONS);
  const [regime, setRegime] = useState<Regime>("open");
  const [action, setAction] = useState<Action>("borrow");
  const [amount, setAmount] = useState("");
  const [feedback, setFeedback] = useState("");
  const workspace = useRef<HTMLElement>(null);

  const position = positions[market.id];
  const isLender = action === "lend" || action === "redeem";
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
  const totals = MARKETS.reduce((total, item) => ({
    collateral: total.collateral + collateralValue(item, positions[item.id]),
    debt: total.debt + positions[item.id].debt,
    supplied: total.supplied + positions[item.id].supplied,
  }), { collateral: 0, debt: 0, supplied: 0 });

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
    setPositions({ ...positions, [market.id]: projected });
    setFeedback(`Simulation updated · ${quantity.format(amountUnits / scale)} ${symbol}`);
    setAmount("");
  }

  return (
    <main id="app-main" tabIndex={-1}>
      <section className="app-masthead" aria-labelledby="app-title">
        <div className="wrap">
          <div className="app-heading">
            <div>
              <p className="eyebrow">BNB Chain / Isolated markets</p>
              <h1 id="app-title">Stock-backed <em>lending.</em></h1>
              <p className="app-intro">Supply USDT to a market or borrow against tokenized stocks.</p>
            </div>
            <div className="app-session">
              <label htmlFor="market-session">Simulated market session</label>
              <select id="market-session" value={regime} onChange={event => {
                setRegime(event.target.value as Regime);
                setFeedback("");
              }}>
                {SESSIONS.map(session => <option key={session} value={session}>{REGIME_LABEL[session]}</option>)}
              </select>
              <p>{Math.round(ILLUSTRATIVE_HAIRCUT[regime] * 100)}% collateral haircut</p>
            </div>
          </div>
          <dl className="app-summary">
            <div><dt>Your collateral</dt><dd>{money(totals.collateral)}</dd></div>
            <div><dt>Your debt</dt><dd>{money(totals.debt)}</dd></div>
            <div><dt>Your USDT supplied</dt><dd>{money(totals.supplied)}</dd></div>
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
              <span>Collateral</span><span>Borrow APR</span><span>Liquidity</span><span />
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
                    <span><span className="sr-only">Borrow APR </span>{item.borrowApr.toFixed(2)}%</span>
                    <span className="app-market-liquidity"><span className="sr-only">Liquidity </span>{money(liquidity(item, positions[item.id]))}</span>
                    <IconArrow />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <h2 className="app-positions-heading" id="positions-heading">Your positions</h2>
          <ul className="app-positions" aria-labelledby="positions-heading">
            {MARKETS.filter(item => Object.values(positions[item.id]).some(Boolean)).map(item => {
              const holding = positions[item.id];
              return (
                <li key={item.id}>
                  <div className="app-asset"><TokenIcon symbol={item.id} size={26} /><strong>{item.symbol}</strong></div>
                  <dl>
                    <div><dt>Collateral</dt><dd>{quantity.format(holding.collateral / TOKENS_PER_UNIT)} {item.symbol}</dd></div>
                    <div><dt>Debt</dt><dd>{money(holding.debt)}</dd></div>
                    <div><dt>USDT supplied</dt><dd>{money(holding.supplied)}</dd></div>
                  </dl>
                </li>
              );
            })}
            {totals.collateral === 0 && totals.debt === 0 && totals.supplied === 0 && <li>No positions yet.</li>}
          </ul>
        </section>

        <section className="app-ticket" tabIndex={-1} ref={workspace} aria-labelledby="ticket-title">
          <header className="app-ticket-head">
            <div className="app-asset">
              <TokenIcon symbol={market.id} size={36} />
              <div><p className="app-demo-label">Manage market</p><h2 id="ticket-title">{market.symbol} / USDT</h2></div>
            </div>
            <TokenIcon symbol="USDT" size={26} />
          </header>

          <div className="app-ticket-body">
            <div className="app-mode" role="group" aria-label="Position type">
              <button type="button" aria-pressed={!isLender} onClick={() => selectAction("borrow")}>Borrower</button>
              <button type="button" aria-pressed={isLender} onClick={() => selectAction("lend")}>Lender</button>
            </div>
            <form onSubmit={submit}>
              <div className="app-actions" role="group" aria-label="Market action">
                {(isLender ? LENDER_ACTIONS : BORROWER_ACTIONS).map(next => (
                  <button type="button" key={next} aria-pressed={action === next}
                    onClick={() => selectAction(next)}>{ACTIONS[next].label}</button>
                ))}
              </div>

              <div className="app-amount-heading">
                <label htmlFor="action-amount">Amount</label>
                <span id="action-limit">Max {quantity.format(maximum / scale)} {symbol}</span>
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
              {invalidAmount && <p className="app-message" id="amount-error">Enter a positive amount within the limit, using up to {definition.collateral ? 4 : 2} decimal places.</p>}
              {action === "borrow" && maximum === 0 && <p className="app-message">Supply collateral in this market to increase your borrowing power.</p>}

              <dl className="app-preview">
                {isLender ? (
                  <>
                    <div><dt>Demo USDT balance</dt><dd>{money(wallet)}</dd></div>
                    <div><dt>USDT supplied after action</dt><dd>{money(projected.supplied)}</dd></div>
                    <div><dt>Illustrative supply APR</dt><dd>{market.supplyApr.toFixed(2)}%</dd></div>
                  </>
                ) : (
                  <>
                    <div><dt>Available to borrow</dt><dd>{money(current.available)}{canSubmit && <> <span aria-hidden="true">→</span><span className="sr-only"> after action </span> <strong>{money(preview.available)}</strong></>}</dd></div>
                    <div><dt>Health factor{canSubmit && " after action"}</dt><dd>{health(preview.health)}</dd></div>
                    <div><dt>Weekend health{canSubmit && " after action"}</dt><dd>{health(weekendHealth)}</dd></div>
                    <div><dt>Target LTV / Liquidation LTV</dt><dd>{(market.maxLtv * 100).toFixed(0)}% / {(market.liquidationLtv * 100).toLocaleString("en-US")}%</dd></div>
                  </>
                )}
              </dl>
              <button className="btn app-submit" type="submit" disabled={!canSubmit}>Simulate {definition.label.toLowerCase().replace("usdt", "USDT")}</button>
              <p className="app-feedback" role="status">{feedback}</p>
            </form>
          </div>
        </section>
      </div>
      <p className="wrap app-footnote">Sample prices, rates, and balances. Simulated actions reset on refresh.</p>
    </main>
  );
}
