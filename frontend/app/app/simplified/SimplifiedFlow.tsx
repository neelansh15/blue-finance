"use client";

import { useModal } from "connectkit";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAccount } from "wagmi";
import { IconArrow } from "../../components/Icons";
import TokenIcon from "../../components/TokenIcon";
import { REGIME_LABEL } from "../../components/regimes";
import { useDemoAccount } from "../DemoAccount";
import { health, money, quantity } from "../format";
import {
  actionMaximum, applyAction, CENTS_PER_USDT, liquidity, MARKETS, marketMetrics, parseAmount,
  TOKENS_PER_UNIT, walletUsdt, type Market, type Position,
} from "../markets";

const steps = ["Wallet", "Action", "Market", "Transaction", "Summary"] as const;
const choices = [
  { action: "borrow", title: "Borrow", icon: "hand-coins", description: "Use tokenized stock as collateral to borrow USDT." },
  { action: "lend", title: "Supply", icon: "coins", description: "Supply USDT to a market to earn interest." },
] as const;
type Choice = (typeof choices)[number]["action"];

type Receipt = {
  action: Choice;
  market: Market;
  amount: number;
  addedCollateral: number;
  before: Position;
  after: Position;
  walletBefore: number;
  walletAfter: number;
  healthAfter: number | null;
  weekendHealth: number | null;
  availableAfter: number;
  session: string;
  rate: number;
  address: string;
  timestamp: string;
};

const usdt = (cents: number) => `${quantity.format(cents / CENTS_PER_USDT)} USDT`;
const tokens = (units: number, market: Market) => `${quantity.format(units / TOKENS_PER_UNIT)} ${market.symbol}`;

function Details({ rows }: { rows: [string, string][] }) {
  return <dl className="app-preview">{rows.map(([label, value]) => (
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
  ))}</dl>;
}

function MarketName({ market }: { market: Market }) {
  return <span className="app-asset"><TokenIcon symbol={market.id} size={28} />{market.symbol}</span>;
}

export default function SimplifiedFlow() {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const { setOpen } = useModal();
  const { positions, setPositions, regime } = useDemoAccount();
  const [step, setStep] = useState(1);
  const [choice, setChoice] = useState<Choice>();
  const [market, setMarket] = useState<Market>();
  const [amount, setAmount] = useState("");
  const [collateral, setCollateral] = useState("");
  const [receipt, setReceipt] = useState<Receipt>();
  const heading = useRef<HTMLHeadingElement>(null);

  const connected = isConnected && !!address;
  const active = connected ? step : 0;
  const reached = !connected ? 0 : receipt ? 4 : market ? 3 : choice ? 2 : 1;
  const wallet = walletUsdt(positions);
  const holdings = MARKETS.filter(({ id }) => Object.values(positions[id]).some(value => value > 0));
  const borrowing = choice === "borrow";
  const operation = borrowing ? "Borrow" : "Supply";

  useEffect(() => {
    if (active > 0) heading.current?.focus();
  }, [active]);

  function selectChoice(action: Choice) {
    if (choice !== action) {
      setChoice(action);
      setMarket(undefined);
      setAmount("");
      setCollateral("");
      setReceipt(undefined);
    }
    setStep(2);
  }

  function selectMarket(next: Market) {
    if (market?.id !== next.id) {
      setMarket(next);
      setAmount("");
      setCollateral("");
      setReceipt(undefined);
    }
    setStep(3);
  }

  const position = market && positions[market.id];
  const added = parseAmount(collateral, TOKENS_PER_UNIT);
  const units = parseAmount(amount, CENTS_PER_USDT);
  const collateralMaximum = market && position ? actionMaximum("deposit", market, position, regime, wallet) : 0;
  const collateralError = borrowing && collateral !== "" && (added <= 0 || added > collateralMaximum);
  const funded = position && borrowing && !collateralError ? applyAction(position, "deposit", added) : position;
  const maximum = market && funded && choice ? actionMaximum(choice, market, funded, regime, wallet) : 0;
  const valid = units > 0 && units <= maximum && !collateralError;
  const projected = funded && choice && valid ? applyAction(funded, choice, units) : funded;
  const rate = market ? borrowing ? market.borrowApr : market.supplyApr : 0;
  const amountError = amount !== "" && (units <= 0 || units > maximum);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connected || !address || !valid || !market || !choice || !position || !projected) return;
    const updated = { ...positions, [market.id]: projected };
    const metrics = marketMetrics(market, projected, regime);
    setPositions(updated);
    setReceipt({
      action: choice, market, amount: units, addedCollateral: borrowing ? added : 0,
      before: position, after: projected, rate, address, timestamp: new Date().toISOString(),
      walletBefore: wallet, walletAfter: walletUsdt(updated), session: REGIME_LABEL[regime],
      healthAfter: metrics.health, weekendHealth: marketMetrics(market, projected, "weekend").health,
      availableAfter: metrics.available,
    });
    setAmount("");
    setCollateral("");
    setStep(4);
  }

  return (
    <main id="app-main" tabIndex={-1} className="simple-flow">
      <header className="simple-masthead">
        <div className="wrap">
          <h1>Simplified Mode</h1>
          <p>Walk through a USDT loan or supply in the simulator.</p>
          <nav aria-label="Transaction steps">
            <ol className="simple-steps">
              {steps.map((label, index) => (
                <li key={label}>
                  <button type="button" disabled={index > reached} aria-current={active === index ? "step" : undefined}
                    onClick={() => setStep(index)}>
                    <span aria-hidden="true">{index + 1}</span>{label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </header>

      <section className="wrap simple-stage" aria-labelledby="simple-heading">
        {active === 0 && (
          <div className="simple-center">
            <h2 id="simple-heading" tabIndex={-1} ref={heading}>{connected ? "Wallet connected" : "Connect your wallet"}</h2>
            <p>{connected ? address : "A wallet opens the guide. Positions and transactions use demo data."}</p>
            <button className="btn" type="button" disabled={isConnecting || isReconnecting}
              onClick={() => connected ? setStep(1) : setOpen(true)}>
              {connected ? "Continue" : isConnecting || isReconnecting ? "Connecting…" : "Connect wallet"}
              {connected && <IconArrow />}
            </button>
          </div>
        )}

        {active === 1 && (
          <>
            <h2 className="simple-center" id="simple-heading" tabIndex={-1} ref={heading}>What would you like to do?</h2>
            <div className="simple-choices">
              {choices.map(item => (
                <button key={item.action} type="button" className="simple-choice" onClick={() => selectChoice(item.action)}>
                  <span className="simple-icon" style={{ maskImage: `url(/assets/icons/${item.icon}.svg)` }} aria-hidden="true" />
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
            <h3 id="simple-positions">Your simulated positions</h3>
            <table className="simple-table" aria-labelledby="simple-positions">
              <thead><tr><th scope="col">Market</th><th scope="col">Collateral</th><th scope="col">Borrowed</th><th scope="col">Supplied</th></tr></thead>
              <tbody>{holdings.length ? holdings.map(item => {
                const holding = positions[item.id];
                return <tr key={item.id}><th scope="row"><MarketName market={item} /></th>
                  <td>{tokens(holding.collateral, item)}</td><td>{money(holding.debt)}</td><td>{money(holding.supplied)}</td></tr>;
              }) : <tr><td colSpan={4}>No positions yet</td></tr>}</tbody>
            </table>
          </>
        )}

        {active === 2 && (
          <>
            <h2 id="simple-heading" tabIndex={-1} ref={heading}>Choose a market to {operation.toLowerCase()}</h2>
            <table className="simple-table" aria-labelledby="simple-heading">
              <thead><tr><th scope="col">Market</th><th scope="col">{borrowing ? "Borrow APR" : "Supply APR"}</th>
                <th scope="col">{borrowing ? "Can borrow" : "Your supply"}</th><th scope="col">Liquidity</th></tr></thead>
              <tbody>{MARKETS.map(item => (
                <tr key={item.id} className="simple-market-row">
                  <th scope="row"><button className="simple-market" type="button" onClick={() => selectMarket(item)}
                    aria-label={`Select ${item.symbol} market`}><MarketName market={item} /><span aria-hidden="true">→</span></button></th>
                  <td>{(borrowing ? item.borrowApr : item.supplyApr).toFixed(2)}%</td>
                  <td>{money(borrowing ? marketMetrics(item, positions[item.id], regime).available : positions[item.id].supplied)}</td>
                  <td>{money(liquidity(item, positions[item.id]))}</td>
                </tr>
              ))}</tbody>
            </table>
          </>
        )}

        {active === 3 && market && position && (
          <div className="app-ticket simple-ticket">
            <header className="app-ticket-head">
              <div className="app-asset">
                <TokenIcon symbol="USDT" size={36} />
                <div>
                  <h2 id="simple-heading" tabIndex={-1} ref={heading}>{operation} USDT</h2>
                  <p className="simple-ticket-market">{market.symbol} Market</p>
                </div>
              </div>
              <dl className="app-ticket-rate"><dt>{operation} APR</dt><dd>{rate.toFixed(2)}%</dd></dl>
            </header>
            <form className="app-ticket-body simple-form" onSubmit={submit}>
              {borrowing && (
                <div>
                  <div className="app-amount-heading"><label htmlFor="simple-collateral">Add collateral</label>
                    <span id="simple-collateral-limit">{tokens(collateralMaximum, market)} available</span></div>
                  <div className="app-amount">
                    <input id="simple-collateral" inputMode="decimal" placeholder="0.00" value={collateral}
                      onChange={event => setCollateral(event.target.value)} aria-invalid={collateralError || undefined}
                      aria-describedby={collateralError ? "simple-collateral-limit simple-collateral-error" : "simple-collateral-limit"} />
                    <span>{market.symbol}</span>
                    <button type="button" disabled={!collateralMaximum} onClick={() => setCollateral(String(collateralMaximum / TOKENS_PER_UNIT))}>Max</button>
                  </div>
                  {collateralError && <p id="simple-collateral-error" className="app-message">Enter an amount up to your available collateral, with up to four decimals.</p>}
                  {!position.collateral && !added && <p className="app-message">Add collateral to unlock borrowing in this market.</p>}
                </div>
              )}
              <div>
                <div className="app-amount-heading"><label htmlFor="simple-amount">{operation} amount</label>
                  <span id="simple-limit">{usdt(maximum)} available</span></div>
                <div className="app-amount">
                  <input id="simple-amount" inputMode="decimal" placeholder="0.00" value={amount}
                    onChange={event => setAmount(event.target.value)} aria-invalid={amountError || undefined}
                    aria-describedby={amountError ? "simple-limit simple-amount-error" : "simple-limit"} />
                  <span>USDT</span>
                  <button type="button" disabled={!maximum} onClick={() => setAmount(String(maximum / CENTS_PER_USDT))}>Max</button>
                </div>
                {amountError && <p id="simple-amount-error" className="app-message">Enter a positive amount within the limit, with up to two decimals.</p>}
              </div>
              {projected && <Details rows={borrowing ? [
                ["Market session", REGIME_LABEL[regime]],
                ["Projected debt", usdt(projected.debt)],
                ["Projected health", health(marketMetrics(market, projected, regime).health)],
                ["Weekend health", health(marketMetrics(market, projected, "weekend").health)],
              ] : [["Projected supply", usdt(projected.supplied)], ["Demo wallet balance", usdt(wallet - (valid ? units : 0))]]} />}
              <button type="submit" className="btn app-submit" disabled={!valid}>Simulate {operation.toLowerCase()}</button>
            </form>
          </div>
        )}

        {active === 4 && receipt && (
          <div className="simple-receipt">
            <h2 className="simple-success" id="simple-heading" tabIndex={-1} ref={heading}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12 4 4L19 6" />
              </svg>
              <span>{receipt.action === "borrow" ? "Borrowed" : "Supplied"} {usdt(receipt.amount)} {receipt.action === "borrow" ? "from" : "to"} {receipt.market.symbol}/USDT Market</span>
            </h2>
            <p>Simulated transaction. Your demo position was updated.</p>
            <Details rows={[
              ["Market", `${receipt.market.symbol} / USDT`],
              ["Amount", usdt(receipt.amount)],
              [receipt.action === "borrow" ? "Borrow APR" : "Supply APR", `${receipt.rate.toFixed(2)}%`],
              ["Wallet", receipt.address],
              ["Executed at", receipt.timestamp],
              ["Demo wallet balance", `${usdt(receipt.walletBefore)} → ${usdt(receipt.walletAfter)}`],
              ...(receipt.action === "borrow" ? [
                ["Market session", receipt.session],
                ["Collateral added", tokens(receipt.addedCollateral, receipt.market)],
                ["Total collateral", tokens(receipt.after.collateral, receipt.market)],
                ["Total debt", `${usdt(receipt.before.debt)} → ${usdt(receipt.after.debt)}`],
                ["Remaining borrowing power", usdt(receipt.availableAfter)],
                ["Health factor", health(receipt.healthAfter)],
                ["Weekend health", health(receipt.weekendHealth)],
              ] as [string, string][] : [
                ["Total supplied", `${usdt(receipt.before.supplied)} → ${usdt(receipt.after.supplied)}`],
              ] as [string, string][]),
            ]} />
            <button type="button" className="btn" onClick={() => {
              setChoice(undefined); setMarket(undefined); setReceipt(undefined); setStep(1);
            }}>Start another transaction</button>
          </div>
        )}
      </section>
    </main>
  );
}
