"use client";

import { useModal } from "connectkit";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { IconArrow } from "../../components/Icons";
import TokenIcon from "../../components/TokenIcon";
import { useDemoAccount } from "../DemoAccount";
import { ReadStatus, TxFeedback, WalletAction } from "../live/LiveParts";
import { EXPLORER, useBlueState, useBlueTransactions, type TxStep } from "../live/useBlueLive";
import { LEVERAGE } from "../../../src/lib/blue/leverage";
import { LEVERAGE_LIVE } from "../../../src/lib/blue/swap";
import { IS_DEMO, parseTokenAmount } from "../../../src/lib/blue/mainnet";
import {
  actionLimit, blockingStock, borrowGate, borrowLtv, borrowRoom, formatAmount, formatBps, formatHealth, formatRate,
  formatUsd, isEligible, liveStock, pinnedStock, position, statusLabel, usdtDebt, type LiveLimit, type LiveState,
} from "../../../src/lib/blue/live-position";
import { LeverageMarkets, LeverageSummary, LeverageTicket, type LeverageReceipt } from "./LeverageFlow";
import { LiveLeverageMarkets, LiveLeverageSummary, LiveLeverageTicket, type LiveLeverageReceipt } from "./LiveLeverageFlow";
import { STOCKS, type Stock, type StockId } from "../markets";

const steps = ["Wallet", "Action", "Market", "Transaction", "Summary"] as const;
const choices = [
  { action: "borrow", title: "Borrow", icon: "hand-coins", description: "Use one tokenized stock as collateral to borrow USDT." },
  { action: "leverage", title: "One-click leveraged borrow", icon: "trending-up",
    subtitle: `Up to ${LEVERAGE.cap}× leverage${LEVERAGE_LIVE ? "" : " · Simulation"}`,
    description: `${LEVERAGE_LIVE ? "Borrow" : "Preview borrowing"} USDT, ${LEVERAGE_LIVE ? "buy" : "buying"} more of the same stock and ${LEVERAGE_LIVE ? "supply" : "supplying"} it as collateral.` },
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
  amount: bigint;
  addedCollateral: bigint;
  before: LiveState;
  after: LiveState;
  address: string;
  timestamp: string;
  transactions: TxStep[];
};

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

function ExplorerLink({ hash }: { hash: string }) {
  return (
    <a className="simple-explorer-link" href={`${EXPLORER}/tx/${hash}`}
      target="_blank" rel="noopener noreferrer" aria-label={`View transaction ${hash} on BscScan (opens in a new tab)`}>
      <span>{hash.slice(0, 10)}…{hash.slice(-8)}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 5h6v6M19 5l-9 9" />
        <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
      </svg>
    </a>
  );
}

function SimulationNotice() {
  return <p className="dapp-banner" role="note"><strong>Simulation.</strong> Sample balances, prices and swaps. No transaction is sent. The demo market’s test tokens have no swap pools, so leverage runs on the live pool only.</p>;
}

/** Limits for the guided borrow, which may add collateral before borrowing. */
function guidedBorrowLimit(state: LiveState, id: StockId, added: bigint): LiveLimit {
  const stock = liveStock(state, id);
  const other = blockingStock(state, stock);
  if (other) return { max: 0n, reason: `Your account uses ${other.id} as collateral. One stock per account.` };
  if (stock.reserve[0] + added === 0n) return { max: 0n, reason: `Add ${id} collateral to borrow.` };
  const gate = borrowGate(state, stock);
  if (gate) return { max: 0n, reason: gate };
  if (!isEligible(stock)) return { max: 0n, reason: `This wallet needs eligibility for ${id}.` };
  return borrowRoom(state, stock, added);
}

export default function SimplifiedFlow() {
  const { address } = useAccount();
  // A different account starts a fresh guide, so amounts and receipts never carry across wallets.
  return <Guide key={address ?? "disconnected"} />;
}

function Guide() {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const { setOpen } = useModal();
  const demo = useDemoAccount();
  const query = useBlueState();
  const data = query.data;
  const tx = useBlueTransactions(query.refetch);
  const [step, setStep] = useState(1);
  const [choice, setChoice] = useState<Choice>();
  const [market, setMarket] = useState<Selection>();
  const [amount, setAmount] = useState("");
  const [collateral, setCollateral] = useState("");
  const [receipt, setReceipt] = useState<Receipt>();
  const [partial, setPartial] = useState<TxStep[]>([]);
  const [leverageReceipt, setLeverageReceipt] = useState<LeverageReceipt>();
  const [liveReceipt, setLiveReceipt] = useState<LiveLeverageReceipt>();
  const heading = useRef<HTMLHeadingElement>(null);

  const connected = isConnected && !!address;
  const active = connected ? step : 0;
  const reached = !connected ? 0 : receipt || leverageReceipt || liveReceipt ? 4 : market ? 3 : choice ? 2 : 1;
  const account = data?.account ? data : undefined;
  const borrowing = choice === "borrow";
  const levering = choice === "leverage";
  const basic: BasicChoice | undefined = choice === "leverage" ? undefined : choice;
  const operation = borrowing ? "Borrow" : "Supply";

  useEffect(() => {
    if (active > 0) heading.current?.focus();
  }, [active]);

  function reset() {
    setAmount("");
    setCollateral("");
    setReceipt(undefined);
    setLeverageReceipt(undefined);
    setLiveReceipt(undefined);
    setPartial([]);
    tx.clearFeedback();
  }

  function selectChoice(action: Choice) {
    if (choice !== action) {
      setChoice(action);
      setMarket(undefined);
      reset();
    }
    if (action === "lend") {
      setMarket(POOL);
      setStep(3);
    } else setStep(2);
  }

  function selectMarket(next: Selection) {
    if (market !== next) {
      setMarket(next);
      reset();
    }
    setStep(3);
  }

  const stock: StockId | null = market && market !== POOL ? market : null;
  const selected = data && stock ? liveStock(data, stock) : undefined;
  const added = parseTokenAmount(collateral) ?? 0n;
  const units = parseTokenAmount(amount);
  const collateralLimit: LiveLimit = data && stock ? actionLimit(data, stock, "deposit") : { max: 0n };
  const collateralError = borrowing && collateral !== "" && (added <= 0n || added > collateralLimit.max);
  const usableCollateral = collateralError ? 0n : added;
  const limit: LiveLimit = !data ? { max: 0n }
    : borrowing ? (stock ? guidedBorrowLimit(data, stock, usableCollateral) : { max: 0n })
      : actionLimit(data, "NVDAB", "lend");
  const valid = !!account && !query.isError && !!basic && units !== undefined && units <= limit.max && !collateralError;
  const amountError = amount !== "" && (units === undefined || (!!account && units > limit.max));
  const projected = data && selected
    ? position(data, selected, { collateral: usableCollateral, debt: valid ? units : 0n, enable: true }) : undefined;
  const rate = data ? formatRate(borrowing ? data.borrowRate : data.supplyRate) : "—";
  const walletPlan = !borrowing ? "USDT approval if needed, then supply"
    : [
      ...(usableCollateral > 0n ? [`${stock} approval if needed`, `supply ${stock}`] : []),
      ...(selected && !selected.reserve[8] ? ["enable collateral"] : []),
      "borrow USDT",
    ].join(", then ");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !basic || !data || !address || tx.busy) return;
    const before = data;
    const spent = units!;
    const supplied = borrowing ? usableCollateral : 0n;
    setPartial([]);
    const result = borrowing && selected
      ? await tx.supplyAndBorrow(before, selected, supplied, spent)
      : await tx.execute(before, "lend", before.stocks[0], spent);
    if (!result.ok) {
      setPartial(result.steps);
      // Confirmed collateral is already supplied, so clear it to avoid supplying it twice.
      if (result.steps.some(item => item.label === `Supply ${stock}`)) setCollateral("");
      return;
    }
    const fresh = await query.refetch();
    setReceipt({
      action: basic, stock: borrowing ? stock : null, amount: spent, addedCollateral: supplied, before,
      after: fresh.data ?? before, address, timestamp: new Date().toISOString(), transactions: result.steps,
    });
    setAmount("");
    setCollateral("");
    tx.clearFeedback();
    setStep(4);
  }

  const receiptPosition = receipt?.stock ? position(receipt.after, liveStock(receipt.after, receipt.stock)) : undefined;
  const positions = account ? account.stocks.filter(item => item.reserve[0] > 0n || pinnedStock(account)?.id === item.id) : [];

  function restart() {
    setChoice(undefined);
    setMarket(undefined);
    reset();
    setStep(1);
  }

  return (
    <main id="app-main" tabIndex={-1} className="simple-flow">
      <header className="simple-masthead">
        <div className="wrap">
          <h1>Simplified Mode</h1>
          <p>{LEVERAGE_LIVE ? "Borrow, supply USDT or open a leveraged position on BNB Smart Chain."
            : "Borrow or supply USDT on BNB Smart Chain, or preview a leveraged borrow in simulation."}</p>
          <nav aria-label="Transaction steps">
            <ol className="simple-steps">
              {steps.map((label, index) => (
                <li key={label}>
                  <button type="button" disabled={tx.busy || index > reached} aria-current={active === index ? "step" : undefined}
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
            <p>{connected ? address : IS_DEMO
              ? "A wallet opens the guide. This demo market uses test tokens with no value, and transactions cost real BNB gas."
              : "A wallet opens the guide. Borrowing and supplying use real tokens and BNB gas."}</p>
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
            <h3 id="simple-positions">Your positions</h3>
            <ReadStatus query={query} />
            <table className="simple-table" aria-labelledby="simple-positions">
              <thead><tr><th scope="col">Position</th><th scope="col">Collateral</th><th scope="col">Borrowed</th><th scope="col">Supplied</th></tr></thead>
              <tbody>
                {account && positions.map(item => {
                  const backing = pinnedStock(account)?.id === item.id;
                  return (
                    <tr key={item.id}><th scope="row"><StockName stock={STOCKS.find(entry => entry.id === item.id)!} /></th>
                      <td>{formatAmount(item.reserve[0])} {item.id}</td>
                      <td>{backing ? `${formatAmount(usdtDebt(account))} USDT` : "–"}</td><td>–</td></tr>
                  );
                })}
                {account && account.usdt.reserve[0] > 0n && (
                  <tr><th scope="row"><PoolName /></th><td>–</td><td>–</td><td>{formatAmount(account.usdt.reserve[0])} bluUSDT</td></tr>
                )}
                {account && positions.length === 0 && account.usdt.reserve[0] === 0n && <tr><td colSpan={4}>No positions yet</td></tr>}
              </tbody>
            </table>
          </>
        )}

        {active === 2 && borrowing && (
          <>
            <h2 id="simple-heading" tabIndex={-1} ref={heading}>Choose a stock to borrow against</h2>
            {account && pinnedStock(account) && <p>Your loan uses {pinnedStock(account)!.id} as collateral. Repay it before borrowing against another stock.</p>}
            <ReadStatus query={query} />
            <table className="simple-table" aria-labelledby="simple-heading">
              <thead><tr><th scope="col">Stock</th><th scope="col">Borrow LTV</th>
                <th scope="col">Can borrow</th><th scope="col">Status</th></tr></thead>
              <tbody>{STOCKS.map(item => {
                const row = data ? liveStock(data, item.id) : undefined;
                return (
                  <tr key={item.id} className="simple-market-row">
                    <th scope="row"><button className="simple-market" type="button" onClick={() => selectMarket(item.id)}
                      aria-label={`Select ${item.symbol}`}><StockName stock={item} /><span aria-hidden="true">→</span></button></th>
                    <td>{row ? formatBps(borrowLtv(row)) : "—"}</td>
                    <td>{account ? `${formatAmount(actionLimit(account, item.id, "borrow").max)} USDT` : "—"}</td>
                    <td>{row ? statusLabel(row) : "—"}{data && row && borrowGate(data, row) ? " · Gated" : ""}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </>
        )}

        {active === 2 && levering && LEVERAGE_LIVE && (
          <LiveLeverageMarkets query={query} heading={heading} onSelect={selectMarket} />
        )}

        {active === 2 && levering && !LEVERAGE_LIVE && (
          <>
            <SimulationNotice />
            <LeverageMarkets state={demo.state} heading={heading} onSelect={selectMarket} />
          </>
        )}

        {active === 2 && !borrowing && !levering && (
          <>
            <h2 id="simple-heading" tabIndex={-1} ref={heading}>Supply to the USDT pool</h2>
            <ReadStatus query={query} />
            <table className="simple-table" aria-labelledby="simple-heading">
              <thead><tr><th scope="col">Pool</th><th scope="col">Supply APR</th><th scope="col">Your supply</th><th scope="col">Liquidity</th></tr></thead>
              <tbody>
                <tr className="simple-market-row">
                  <th scope="row"><button className="simple-market" type="button" onClick={() => selectMarket(POOL)}
                    aria-label="Select the USDT pool"><PoolName /><span aria-hidden="true">→</span></button></th>
                  <td>{data ? formatRate(data.supplyRate) : "—"}</td>
                  <td>{account ? formatAmount(account.usdt.reserve[0]) : "—"}</td>
                  <td>{data ? formatAmount(data.liquidity) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {active === 3 && levering && LEVERAGE_LIVE && stock && (
          <LiveLeverageTicket key={stock} id={stock} query={query} tx={tx} heading={heading}
            onDone={next => { setLiveReceipt(next); setStep(4); }} />
        )}

        {active === 4 && levering && liveReceipt && (
          <LiveLeverageSummary receipt={liveReceipt} heading={heading} onRestart={restart} />
        )}

        {active === 3 && levering && !LEVERAGE_LIVE && stock && address && (
          <>
            <SimulationNotice />
            <LeverageTicket key={stock} state={demo.state} client={demo.client} stock={stock} address={address} heading={heading}
              onDone={next => { setLeverageReceipt(next); setStep(4); }} />
          </>
        )}

        {active === 4 && levering && leverageReceipt && (
          <>
            <SimulationNotice />
            <LeverageSummary receipt={leverageReceipt} heading={heading} onRestart={restart} />
          </>
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
              <dl className="app-ticket-rate"><dt>{operation} APR</dt><dd>{rate}</dd></dl>
            </header>
            <form className="app-ticket-body simple-form" onSubmit={submit}>
              <ReadStatus query={query} />
              {borrowing && data && selected && borrowGate(data, selected) && (
                <div className="dapp-banner" role="status"><strong>New borrowing is gated.</strong> {borrowGate(data, selected)}</div>
              )}
              {borrowing && stock && (
                <div>
                  <div className="app-amount-heading"><label htmlFor="simple-collateral">Add collateral</label>
                    <span id="simple-collateral-limit">{account ? `${formatAmount(collateralLimit.max)} ${stock} available` : "—"}</span></div>
                  <div className="app-amount">
                    <input id="simple-collateral" inputMode="decimal" autoComplete="off" placeholder="0.00" value={collateral} disabled={tx.busy}
                      onChange={event => { setCollateral(event.target.value); tx.clearFeedback(); }} aria-invalid={collateralError || undefined}
                      aria-describedby={collateralError ? "simple-collateral-limit simple-collateral-error" : "simple-collateral-limit"} />
                    <span>{stock}</span>
                    <button type="button" disabled={tx.busy || collateralLimit.max === 0n}
                      onClick={() => setCollateral(formatUnits(collateralLimit.max, 18))}>Max</button>
                  </div>
                  {collateralError && <p id="simple-collateral-error" className="app-message">Enter an amount up to your available {stock}, with up to 18 decimals.</p>}
                  {account && collateralLimit.reason && <p className="app-message">{collateralLimit.reason}</p>}
                </div>
              )}
              <div>
                <div className="app-amount-heading"><label htmlFor="simple-amount">{operation} amount</label>
                  <span id="simple-limit">{account ? `${formatAmount(limit.max)} USDT available` : "—"}</span></div>
                <div className="app-amount">
                  <input id="simple-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} disabled={tx.busy}
                    onChange={event => { setAmount(event.target.value); tx.clearFeedback(); }} aria-invalid={amountError || undefined}
                    aria-describedby={amountError ? "simple-limit simple-amount-error" : "simple-limit"} />
                  <span>USDT</span>
                  <button type="button" disabled={tx.busy || limit.max === 0n} onClick={() => setAmount(formatUnits(limit.max, 18))}>Max</button>
                </div>
                {amountError && <p id="simple-amount-error" className="app-message">Enter a positive amount within the limit, with up to 18 decimals.</p>}
                {!amountError && account && limit.reason && <p className="app-message">{limit.reason}</p>}
              </div>
              {data && <Details rows={borrowing && selected && projected ? [
                ["Market status", `${statusLabel(selected)} · ${formatBps(borrowLtv(selected))} borrow LTV`],
                ["Projected debt", `${formatAmount(projected.debt)} USDT`],
                ["Projected borrow limit", formatUsd(projected.borrowLimit)],
                ["Projected health factor", formatHealth(projected.healthFactor)],
                ["Liquidation price", projected.liquidationPrice === null ? "None" : formatUsd(projected.liquidationPrice)],
                ["Wallet transactions", walletPlan],
              ] : [
                ["Projected bluUSDT", account ? `${formatAmount(account.usdt.reserve[0] + (valid ? units! : 0n))} USDT` : "—"],
                ["Wallet balance after", account ? `${formatAmount(account.usdt.wallet - (valid ? units! : 0n))} USDT` : "—"],
                ["Supply APR", rate],
                ["Wallet transactions", walletPlan],
              ]} />}
              <WalletAction>
                {borrowing && account && selected && !blockingStock(account, selected) && !isEligible(selected) && (
                  <button type="button" className="btn app-submit" disabled={tx.busy || query.isError}
                    onClick={() => void tx.requestEligibility(selected)}>Request {stock} eligibility</button>
                )}
                <button type="submit" className="btn app-submit" disabled={!valid || tx.busy}>
                  {tx.busy ? "Wallet action in progress" : `${operation} USDT`}
                </button>
              </WalletAction>
              <TxFeedback feedback={tx.feedback} />
              {partial.length > 0 && <Details rows={partial.map(item => [item.label, <ExplorerLink key={item.hash} hash={item.hash} />])} />}
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
              <span>{receipt.action === "borrow" ? `Borrowed ${formatAmount(receipt.amount)} USDT against ${receipt.stock}`
                : `Supplied ${formatAmount(receipt.amount)} USDT to the USDT pool`}</span>
            </h2>
            <p>Confirmed on BNB Smart Chain.</p>
            <Details rows={[
              ["Market", receipt.stock ? `${receipt.stock} collateral · USDT pool` : "USDT pool"],
              ["Amount", `${formatAmount(receipt.amount)} USDT`],
              [receipt.action === "borrow" ? "Borrow APR" : "Supply APR",
                formatRate(receipt.action === "borrow" ? receipt.after.borrowRate : receipt.after.supplyRate)],
              ["Wallet", receipt.address],
              ["Confirmed at", receipt.timestamp],
              ["Transaction Hash", <ExplorerLink key="final" hash={receipt.transactions.at(-1)!.hash} />],
              ...receipt.transactions.slice(0, -1).map(item =>
                [item.label, <ExplorerLink key={item.hash} hash={item.hash} />] as [string, ReactNode]),
              ["Wallet USDT", `${formatAmount(receipt.before.usdt.wallet)} → ${formatAmount(receipt.after.usdt.wallet)}`],
              ...(receipt.stock && receiptPosition ? [
                ["Market status", statusLabel(receiptPosition.stock)],
                ["Collateral added", `${formatAmount(receipt.addedCollateral)} ${receipt.stock}`],
                ["Total collateral", `${formatAmount(receiptPosition.collateral)} ${receipt.stock}`],
                ["Total debt", `${formatAmount(usdtDebt(receipt.before))} → ${formatAmount(usdtDebt(receipt.after))} USDT`],
                ["Borrow limit", formatUsd(receiptPosition.borrowLimit)],
                ["Health factor", formatHealth(receiptPosition.healthFactor)],
              ] as [string, ReactNode][] : [
                ["bluUSDT balance", `${formatAmount(receipt.before.usdt.reserve[0])} → ${formatAmount(receipt.after.usdt.reserve[0])}`],
              ] as [string, ReactNode][]),
            ]} />
            <button type="button" className="btn" onClick={restart}>Start another transaction</button>
          </div>
        )}
      </section>
    </main>
  );
}
