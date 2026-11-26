"use client";

import { useModal } from "connectkit";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { IconArrow } from "../../components/Icons";
import TokenIcon from "../../components/TokenIcon";
import CorpActionBanner from "../components/CorpActionBanner";
import { useDemoAccount } from "../DemoAccount";
import { LEVERAGE } from "../../../src/lib/blue/leverage";
import { LeverageMarkets, LeverageSummary, LeverageTicket, type LeverageReceipt } from "./LeverageFlow";
import { health, ltv, money, percent, quantity } from "../format";
import {
  actionLimits, borrowLtv, CENTS_PER_USDT, executeAction, parseAmount, poolMetrics, positionMetrics,
  STATUS_LABEL, stockStatus, STOCKS, TOKENS_PER_UNIT, type PoolState, type Stock, type StockId,
} from "../markets";

const steps = ["Wallet", "Action", "Market", "Transaction", "Summary"] as const;
const choices = [
  { action: "borrow", title: "Borrow", icon: "hand-coins", description: "Use one tokenized stock as collateral to borrow USDT." },
  { action: "leverage", title: "One-click leveraged borrow", icon: "trending-up", subtitle: `Up to ${LEVERAGE.cap}× leverage`,
    description: "Borrow USDT, buy more of the same stock and supply it as collateral." },
  { action: "lend", title: "Supply", icon: "coins", description: "Supply USDT to the shared pool for bluUSDT and earn interest." },
] as const;
type Choice = (typeof choices)[number]["action"];
type BasicChoice = Exclude<Choice, "leverage">;

/** The USDT pool is the only market for suppliers. */
const POOL = "POOL" as const;
type Selection = StockId | typeof POOL;

type Receipt = {
  action: BasicChoice;
  stock: StockId | null;
  amount: number;
  addedCollateral: number;
  before: PoolState;
  after: PoolState;
  rate: number;
  address: string;
  timestamp: string;
  transactionHash?: `0x${string}`;
};

const usdt = (cents: number) => `${quantity.format(cents / CENTS_PER_USDT)} USDT`;
const tokens = (units: number, stock: StockId) => `${quantity.format(units / TOKENS_PER_UNIT)} ${stock}`;

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="app-preview">{rows.map(([label, value]) => (
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
  ))}</dl>;
}

function StockName({ stock }: { stock: Stock }) {
  return <span className="app-asset"><TokenIcon symbol={stock.id} size={28} />{stock.symbol}</span>;
}

function PoolName() {
  return <span className="app-asset"><TokenIcon symbol="USDT" size={28} />USDT pool</span>;
}

export default function SimplifiedFlow() {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const { setOpen } = useModal();
  const { state, client } = useDemoAccount();
  const [step, setStep] = useState(1);
  const [choice, setChoice] = useState<Choice>();
  const [market, setMarket] = useState<Selection>();
  const [amount, setAmount] = useState("");
  const [collateral, setCollateral] = useState("");
  const [receipt, setReceipt] = useState<Receipt>();
  const [leverageReceipt, setLeverageReceipt] = useState<LeverageReceipt>();
  const heading = useRef<HTMLHeadingElement>(null);

  const connected = isConnected && !!address;
  const active = connected ? step : 0;
  const reached = !connected ? 0 : receipt || leverageReceipt ? 4 : market ? 3 : choice ? 2 : 1;
  const account = state.account;
  const pool = poolMetrics(state);
  const borrowing = choice === "borrow";
  const levering = choice === "leverage";
  const basic: BasicChoice | undefined = choice === "leverage" ? undefined : choice;
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
      setLeverageReceipt(undefined);
    }
    if (action === "lend") {
      setMarket(POOL);
      setStep(3);
    } else setStep(2);
  }

  function selectMarket(next: Selection) {
    if (market !== next) {
      setMarket(next);
      setAmount("");
      setCollateral("");
      setReceipt(undefined);
      setLeverageReceipt(undefined);
    }
    setStep(3);
  }

  const stock: StockId | null = market && market !== POOL ? market : null;
  const actionStock: StockId = stock ?? account.stock ?? "NVDAB";
  const added = parseAmount(collateral, TOKENS_PER_UNIT);
  const units = parseAmount(amount, CENTS_PER_USDT);
  const collateralLimit = stock ? actionLimits(state, stock).deposit : { max: 0 };
  const collateralError = borrowing && collateral !== "" && (added <= 0 || added > collateralLimit.max);
  const funded = borrowing && stock && added > 0 && !collateralError ? executeAction(state, "deposit", stock, added).state : state;
  const limit = basic ? actionLimits(funded, actionStock)[basic] : { max: 0 };
  const maximum = limit.max;
  const valid = !!basic && units > 0 && units <= maximum && !collateralError;
  const projected = valid && basic ? executeAction(funded, basic, actionStock, units).state : funded;
  const after = positionMetrics(projected);
  const rate = borrowing ? pool.borrowApr : pool.supplyApr;
  const amountError = amount !== "" && (units <= 0 || units > maximum);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connected || !address || !valid || !basic) return;
    const before = state;
    if (borrowing && stock && added > 0 && !client.act("deposit", stock, added).ok) return;
    if (!client.act(basic, actionStock, units).ok) return;
    setReceipt({
      action: basic, stock: borrowing ? actionStock : null, amount: units, addedCollateral: borrowing ? added : 0,
      before, after: client.getState(), rate, address, timestamp: new Date().toISOString(),
    });
    setAmount("");
    setCollateral("");
    setStep(4);
  }

  const receiptAfter = receipt ? positionMetrics(receipt.after) : null;

  return (
    <main id="app-main" tabIndex={-1} className="simple-flow">
      <header className="simple-masthead">
        <div className="wrap">
          <h1>Simplified Mode</h1>
          <p>Walk through a USDT loan, a leveraged borrow or a supply in the simulator.</p>
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
                  {"subtitle" in item && <em className="simple-choice-subtitle">{item.subtitle}</em>}
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
            <h3 id="simple-positions">Your simulated positions</h3>
            <table className="simple-table" aria-labelledby="simple-positions">
              <thead><tr><th scope="col">Position</th><th scope="col">Collateral</th><th scope="col">Borrowed</th><th scope="col">Supplied</th></tr></thead>
              <tbody>
                {account.stock && (
                  <tr><th scope="row"><StockName stock={STOCKS.find(item => item.id === account.stock)!} /></th>
                    <td>{tokens(account.collateral, account.stock)}</td><td>{money(account.debt)}</td><td>–</td></tr>
                )}
                {account.supplied > 0 && (
                  <tr><th scope="row"><PoolName /></th><td>–</td><td>–</td><td>{money(account.supplied)} bluUSDT</td></tr>
                )}
                {!account.stock && account.supplied === 0 && <tr><td colSpan={4}>No positions yet</td></tr>}
              </tbody>
            </table>
          </>
        )}

        {active === 2 && borrowing && (
          <>
            <h2 id="simple-heading" tabIndex={-1} ref={heading}>Choose a stock to borrow against</h2>
            {account.stock && <p>Your account uses {account.stock} as collateral. One stock per account, so other stocks need a fresh account or a repaid loan.</p>}
            <table className="simple-table" aria-labelledby="simple-heading">
              <thead><tr><th scope="col">Stock</th><th scope="col">Borrow LTV</th>
                <th scope="col">Can borrow</th><th scope="col">Status</th></tr></thead>
              <tbody>{STOCKS.map(item => {
                const itemStatus = stockStatus(state, item.id);
                return (
                  <tr key={item.id} className="simple-market-row">
                    <th scope="row"><button className="simple-market" type="button" onClick={() => selectMarket(item.id)}
                      aria-label={`Select ${item.symbol}`}><StockName stock={item} /><span aria-hidden="true">→</span></button></th>
                    <td>{ltv(borrowLtv(itemStatus))}</td>
                    <td>{money(actionLimits(state, item.id).borrow.max)}</td>
                    <td>{STATUS_LABEL[itemStatus]}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </>
        )}

        {active === 2 && levering && <LeverageMarkets state={state} heading={heading} onSelect={selectMarket} />}

        {active === 2 && !borrowing && !levering && (
          <>
            <h2 id="simple-heading" tabIndex={-1} ref={heading}>Supply to the USDT pool</h2>
            <table className="simple-table" aria-labelledby="simple-heading">
              <thead><tr><th scope="col">Pool</th><th scope="col">Supply APR</th><th scope="col">Your supply</th><th scope="col">Liquidity</th></tr></thead>
              <tbody>
                <tr className="simple-market-row">
                  <th scope="row"><button className="simple-market" type="button" onClick={() => selectMarket(POOL)}
                    aria-label="Select the USDT pool"><PoolName /><span aria-hidden="true">→</span></button></th>
                  <td>{percent(pool.supplyApr)}</td><td>{money(account.supplied)}</td><td>{money(pool.liquidity)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {active === 3 && levering && stock && address && (
          <LeverageTicket key={stock} state={state} client={client} stock={stock} address={address} heading={heading}
            onDone={next => { setLeverageReceipt(next); setStep(4); }} />
        )}

        {active === 4 && levering && leverageReceipt && (
          <LeverageSummary receipt={leverageReceipt} heading={heading} onRestart={() => {
            setChoice(undefined); setMarket(undefined); setLeverageReceipt(undefined); setStep(1);
          }} />
        )}

        {active === 3 && market && basic && (
          <div className="app-ticket simple-ticket">
            <header className="app-ticket-head">
              <div className="app-asset">
                <TokenIcon symbol="USDT" size={36} />
                <div>
                  <h2 id="simple-heading" tabIndex={-1} ref={heading}>{operation} USDT</h2>
                  <p className="simple-ticket-market">{stock ? `${stock} collateral` : "USDT pool"}</p>
                </div>
              </div>
              <dl className="app-ticket-rate"><dt>{operation} APR</dt><dd>{percent(rate)}</dd></dl>
            </header>
            <form className="app-ticket-body simple-form" onSubmit={submit}>
              {stock && <CorpActionBanner state={state} stock={stock} />}
              {borrowing && stock && (
                <div>
                  <div className="app-amount-heading"><label htmlFor="simple-collateral">Add collateral</label>
                    <span id="simple-collateral-limit">{tokens(collateralLimit.max, stock)} available</span></div>
                  <div className="app-amount">
                    <input id="simple-collateral" inputMode="decimal" placeholder="0.00" value={collateral}
                      onChange={event => setCollateral(event.target.value)} aria-invalid={collateralError || undefined}
                      aria-describedby={collateralError ? "simple-collateral-limit simple-collateral-error" : "simple-collateral-limit"} />
                    <span>{stock}</span>
                    <button type="button" disabled={!collateralLimit.max} onClick={() => setCollateral(String(collateralLimit.max / TOKENS_PER_UNIT))}>Max</button>
                  </div>
                  {collateralError && <p id="simple-collateral-error" className="app-message">Enter an amount up to your available {stock}, with up to four decimals.</p>}
                  {"reason" in collateralLimit && collateralLimit.reason && <p className="app-message">{collateralLimit.reason}</p>}
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
                {!amountError && "reason" in limit && limit.reason && <p className="app-message">{limit.reason}</p>}
              </div>
              <Details rows={borrowing && stock ? [
                ["Market status", `${STATUS_LABEL[stockStatus(state, stock)]} · ${ltv(borrowLtv(stockStatus(state, stock)))} borrow LTV`],
                ["Projected debt", usdt(projected.account.debt)],
                ["Projected borrow limit", usdt(after.borrowLimit)],
                ["Projected health factor", health(after.healthFactor)],
                ["Liquidation price", after.liquidationPrice === null ? "None" : money(after.liquidationPrice)],
              ] : [
                ["Projected bluUSDT", usdt(projected.account.supplied)],
                ["Demo wallet balance", usdt(projected.account.usdt)],
                ["Supply APR after", percent(poolMetrics(projected).supplyApr)],
              ]} />
              <button type="submit" className="btn app-submit" disabled={!valid}>Simulate {operation.toLowerCase()}</button>
            </form>
          </div>
        )}

        {active === 4 && receipt && receiptAfter && (
          <div className="simple-receipt">
            <h2 className="simple-success" id="simple-heading" tabIndex={-1} ref={heading}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12 4 4L19 6" />
              </svg>
              <span>{receipt.action === "borrow" ? `Borrowed ${usdt(receipt.amount)} against ${receipt.stock}` : `Supplied ${usdt(receipt.amount)} to the USDT pool`}</span>
            </h2>
            <p>Simulated transaction. Your demo position was updated.</p>
            <Details rows={[
              ["Market", receipt.stock ? `${receipt.stock} collateral · USDT pool` : "USDT pool"],
              ["Amount", usdt(receipt.amount)],
              [receipt.action === "borrow" ? "Borrow APR" : "Supply APR", percent(receipt.rate)],
              ["Wallet", receipt.address],
              ["Executed at", receipt.timestamp],
              ["Transaction Hash", receipt.transactionHash ? (
                <a className="simple-explorer-link" href={`https://bscscan.com/tx/${receipt.transactionHash}`}
                  target="_blank" rel="noopener noreferrer" aria-label={`View transaction ${receipt.transactionHash} on BscScan (opens in a new tab)`}>
                  <span>{receipt.transactionHash.slice(0, 10)}…{receipt.transactionHash.slice(-8)}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M13 5h6v6M19 5l-9 9" />
                    <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
                  </svg>
                </a>
              ) : "Unavailable for simulated transactions"],
              ["Demo wallet balance", `${usdt(receipt.before.account.usdt)} → ${usdt(receipt.after.account.usdt)}`],
              ...(receipt.action === "borrow" && receipt.stock ? [
                ["Market status", receiptAfter.status ? STATUS_LABEL[receiptAfter.status] : "–"],
                ["Collateral added", tokens(receipt.addedCollateral, receipt.stock)],
                ["Total collateral", tokens(receipt.after.account.collateral, receipt.stock)],
                ["Total debt", `${usdt(receipt.before.account.debt)} → ${usdt(receipt.after.account.debt)}`],
                ["Borrow limit", usdt(receiptAfter.borrowLimit)],
                ["Health factor", health(receiptAfter.healthFactor)],
              ] as [string, string][] : [
                ["bluUSDT balance", `${usdt(receipt.before.account.supplied)} → ${usdt(receipt.after.account.supplied)}`],
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
