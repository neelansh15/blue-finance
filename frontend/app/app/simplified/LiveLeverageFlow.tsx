"use client";

// Leveraged borrowing on the live pool. One-click sends the whole plan as one atomic EIP-5792 batch; without
// batching, each call is confirmed separately and a stopped run offers the matching tidy-up.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { erc20Abi, formatUnits, maxUint256, type Address } from "viem";
import { useAccount, useBytecode, usePublicClient } from "wagmi";
import { bsc } from "wagmi/chains";
import TokenIcon from "../../components/TokenIcon";
import { ReadStatus, TxFeedback, WalletAction } from "../live/LiveParts";
import { EXPLORER, errorMessage, type TxStep, type useBlueState, type useBlueTransactions } from "../live/useBlueLive";
import {
  approvalTotals, approveCall, batchCalls, currentLeverage, LIVE_LEVERAGE, oraclePrice, planLive, recoveryStep,
  stepCall, stepSpend, swapSize, type LivePlan, type LiveRequest, type LiveStep,
} from "../../../src/lib/blue/live-leverage";
import {
  borrowGate, borrowLtv, formatAmount, formatBps, formatHealth, formatRate, formatUsd, isEligible, liveStock,
  pinnedStock, position, statusLabel, usdtDebt, type LiveState,
} from "../../../src/lib/blue/live-position";
import { IS_DEMO, parseTokenAmount } from "../../../src/lib/blue/mainnet";
import { quotePrice, SWAP } from "../../../src/lib/blue/swap";
import { STOCKS, type StockId } from "../markets";
import { BATCHING_TEXT, times, useBatching } from "./batching";

type Query = ReturnType<typeof useBlueState>;
type Transactions = ReturnType<typeof useBlueTransactions>;

export type LiveLeverageReceipt = {
  stock: StockId;
  mode: "one-click" | "steps";
  before: LiveState;
  after: LiveState;
  completed: string[];
  transactions: TxStep[];
  stoppedEarly: boolean;
  address: string;
  timestamp: string;
};

const WAD = 10n ** 18n;
const usdt = (amount: bigint) => `${formatAmount(amount)} USDT`;
const oraclePrices = (state: LiveState, id: StockId) => {
  const price = oraclePrice(state, liveStock(state, id)) ?? WAD;
  return { buy: price, sell: price };
};

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="app-preview">{rows.map(([label, value]) => (
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
  ))}</dl>;
}

function describe(step: LiveStep, id: StockId): string {
  switch (step.kind) {
    case "supply": return `Supply ${formatAmount(step.amount)} ${id} as collateral`;
    case "enable": return `Use ${id} as collateral`;
    case "borrow": return `Borrow ${usdt(step.amount)}`;
    case "buy": return `Swap at most ${usdt(step.maxIn)} for ${formatAmount(step.amountOut)} ${id}`;
    case "withdraw": return step.all ? `Withdraw all ${id}` : `Withdraw ${formatAmount(step.amount)} ${id}`;
    case "sell": return `Swap at most ${formatAmount(step.maxIn)} ${id} for ${usdt(step.amountOut)}`;
    case "repay": return step.all ? "Repay all USDT debt" : `Repay ${usdt(step.amount)}${step.fromWallet ? " from your wallet" : ""}`;
  }
}

function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export function LiveLeverageMarkets({ query, heading, onSelect }: {
  query: Query; heading: RefObject<HTMLHeadingElement | null>; onSelect: (stock: StockId) => void;
}) {
  const data = query.data;
  const account = data?.account ? data : undefined;
  const pinned = account && pinnedStock(account);
  return (
    <>
      <h2 id="simple-heading" tabIndex={-1} ref={heading}>Choose a stock for leveraged borrowing</h2>
      <p>Opening or increasing a leveraged long borrows USDT, swaps it for more of the same stock on {IS_DEMO ? "the demo swap" : "PancakeSwap"} and supplies that stock as collateral.
        {pinned && ` Your account uses ${pinned.id} as collateral, so leverage applies to ${pinned.id}.`}</p>
      <ReadStatus query={query} />
      <table className="simple-table" aria-labelledby="simple-heading">
        <thead><tr><th scope="col">Stock</th><th scope="col">Borrow LTV</th><th scope="col">Leverage now</th>
          <th scope="col">In your wallet</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {STOCKS.map(item => {
            const row = data && liveStock(data, item.id);
            return (
              <tr key={item.id} className="simple-market-row">
                <th scope="row"><button type="button" className="simple-market" onClick={() => onSelect(item.id)}
                  aria-label={`Select ${item.symbol}`}><span className="app-asset"><TokenIcon symbol={item.id} size={28} />{item.symbol}</span>
                  <span aria-hidden="true">→</span></button></th>
                <td>{row ? formatBps(borrowLtv(row)) : "—"}</td>
                <td>{account ? times(currentLeverage(account, item.id)) : "—"}</td>
                <td>{account ? formatAmount(liveStock(account, item.id).wallet) : "—"}</td>
                <td>{row ? statusLabel(row) : "—"}{data && row && borrowGate(data, row) ? " · Gated" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export function LiveLeverageTicket({ id, query, tx, heading, onDone }: {
  id: StockId; query: Query; tx: Transactions; heading: RefObject<HTMLHeadingElement | null>;
  onDone: (receipt: LiveLeverageReceipt) => void;
}) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: bsc.id });
  const batching = useBatching();
  const data = query.data;
  const account = data?.account ? data : undefined;
  const stock = account && liveStock(account, id);

  const [collateral, setCollateral] = useState("");
  const [chosen, setChosen] = useState<number>();
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [stepwise, setStepwise] = useState(false);
  const [message, setMessage] = useState<string>();
  const [progress, setProgress] = useState<{
    steps: LiveStep[]; done: number; before: LiveState; transactions: TxStep[]; tidied?: string;
  }>();

  const swapCode = useBytecode({ address: SWAP.router, chainId: bsc.id, query: { refetchInterval: 20_000 } });
  const swapMissing = swapCode.isSuccess && !swapCode.data;
  const canBatch = batching === "supported";
  const batch = canBatch && !stepwise;
  const parsed = parseTokenAmount(collateral);
  const zero = collateral === "" || /^0+(\.0*)?$/.test(collateral);
  const collateralError = !zero && (parsed === undefined || (!!stock && parsed > stock.wallet));
  const add = collateralError || zero ? 0n : parsed!;

  const current = account ? currentLeverage(account, id) : null;
  // The range ignores eligibility, so an ineligible wallet can pick a target and then request it.
  const furthest = account ? planLive(
    { ...account, stocks: account.stocks.map(item => ({ ...item, eligibleUntil: maxUint256 })) },
    { stock: id, target: LIVE_LEVERAGE.cap, add, batch }, oraclePrices(account, id),
  ).resulting : null;
  const finite = (value: number | null) => value !== null && Number.isFinite(value) ? value : 1;
  const levered = finite(current) > 1.005;
  // Rounded to the nearest step, so an untouched slider plans no change to an existing position.
  const standing = Math.round(finite(current) * 100) / 100;
  const max = Math.min(LIVE_LEVERAGE.cap, Math.max(1, Math.floor(finite(furthest) * 100) / 100, standing));
  // Until the slider moves, an existing position stays where it is and a new one starts at 1.5×.
  const suggested = levered ? standing : Math.min(max, 1.5);
  const target = Math.min(Math.max(1, chosen ?? suggested), max);
  const closing = target <= 1;

  const request = useDebounced(
    JSON.stringify({ target, add: add.toString(), withdrawAll: withdrawAll && closing, batch }), 400);
  const quote = useQuery({
    queryKey: ["blue-leverage-quote", address, id, request, query.dataUpdatedAt],
    enabled: !!account && !!client && !!swapCode.data,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const input = JSON.parse(request) as { target: number; add: string; withdrawAll: boolean; batch: boolean };
      const wanted: LiveRequest = { stock: id, ...input, add: BigInt(input.add) };
      const oracle = oraclePrices(account!, id);
      const quotedAt = Date.now();
      const draft = planLive(account!, wanted, oracle);
      const size = swapSize(draft);
      if (!size) return { plan: draft, quotedAt, price: undefined, request, account: account!.account! };
      const price = await quotePrice(client!, size.side, liveStock(account!, id), size.amount);
      const plan = planLive(account!, wanted, { ...oracle, [size.side]: price });
      return { plan, quotedAt, price, request, account: account!.account! };
    },
  });
  const plan: LivePlan | undefined = quote.data?.plan;
  const latest = JSON.stringify({ target, add: add.toString(), withdrawAll: withdrawAll && closing, batch });
  const upToDate = !!quote.data && quote.data.request === latest && quote.data.account === address && !quote.isError;
  const canRun = !!plan && upToDate && !query.isError && plan.steps.length > 0 && !plan.blocked && !collateralError && !tx.busy;

  /** The reviewed plan, if its quote is still fresh. */
  function reviewed() {
    setMessage(undefined);
    tx.clearFeedback();
    if (!account || !address || !stock || !quote.data || !canRun) return undefined;
    if (Date.now() - quote.data.quotedAt > LIVE_LEVERAGE.quoteSeconds * 1000) {
      void query.refetch();
      void quote.refetch();
      setMessage("The quote expired and is being refreshed. Review the new figures and confirm again.");
      return undefined;
    }
    return { plan: quote.data.plan, state: account, stock, account: address };
  }

  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + LIVE_LEVERAGE.deadlineSeconds);
  const allowanceOf = (token: Address, owner: Address, spender: Address) =>
    client!.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });

  async function finish(mode: "one-click" | "steps", before: LiveState, completed: string[], transactions: TxStep[], stoppedEarly: boolean) {
    const fresh = await query.refetch();
    onDone({
      stock: id, mode, before, after: fresh.data ?? before, completed, transactions, stoppedEarly,
      address: before.account!, timestamp: new Date().toISOString(),
    });
  }

  async function runOneClick() {
    const run = reviewed();
    if (!run) return;
    try {
      const totals = approvalTotals(run.plan.steps, run.stock.address);
      const allowances = new Map(await Promise.all(totals.map(async item =>
        [`${item.token}:${item.spender}`, await allowanceOf(item.token, run.account, item.spender)] as const)));
      const calls = batchCalls(run.plan, run.stock, run.account, deadline(), allowances);
      const result = await tx.sendBatch(calls);
      if (result.ok) await finish("one-click", run.state, run.plan.steps.map(step => describe(step, id)), result.steps, false);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  /** Sends one step from the connected wallet, approving exactly what it spends if the allowance is short. */
  function sendStep(step: LiveStep) {
    return tx.run(async (send, owner) => {
      const spend = stepSpend(step, stock!);
      if (spend && await allowanceOf(spend.token, owner, spend.spender) < spend.amount) {
        const approval = approveCall(spend.token, spend.symbol, spend.spender, spend.amount);
        await send(approval.to, approval.data, approval.label);
      }
      const call = stepCall(step, stock!, owner, deadline());
      await send(call.to, call.data, call.label);
    });
  }

  /** Runs the plan from `from`, one confirmed step at a time. */
  async function runSteps(run: { steps: LiveStep[]; done: number; before: LiveState; transactions: TxStep[] }) {
    let { done, transactions } = run;
    setProgress({ ...run });
    while (done < run.steps.length) {
      const result = await sendStep(run.steps[done]);
      transactions = [...transactions, ...result.steps];
      if (!result.ok) {
        // Nothing confirmed means nothing to tidy up: return to the form with the error.
        if (transactions.length === 0) setProgress(undefined);
        else setProgress({ ...run, done, transactions });
        return;
      }
      done += 1;
      setProgress({ ...run, done, transactions });
    }
    await finish("steps", run.before, run.steps.map(step => describe(step, id)), transactions, false);
  }

  function startSteps() {
    const run = reviewed();
    if (run) void runSteps({ steps: run.plan.steps, done: 0, before: run.state, transactions: [] });
  }

  const tidy = progress && !progress.tidied ? recoveryStep(progress.steps, progress.done) : null;

  async function runTidy() {
    if (!progress || !tidy) return;
    const result = await sendStep(tidy);
    setProgress({
      ...progress, transactions: [...progress.transactions, ...result.steps],
      tidied: result.ok ? describe(tidy, id) : undefined,
    });
  }

  const finishEarly = () => progress && void finish("steps", progress.before,
    [...progress.steps.slice(0, progress.done).map(step => describe(step, id)), ...(progress.tidied ? [progress.tidied] : [])],
    progress.transactions, true);

  const held = account && stock ? position(account, stock) : undefined;
  const sum = (pick: (step: LiveStep) => bigint | undefined) =>
    plan?.steps.reduce((total, step) => total + (pick(step) ?? 0n), 0n) ?? 0n;
  const borrowed = sum(step => step.kind === "borrow" ? step.amount : undefined);
  const bought = sum(step => step.kind === "buy" ? step.amountOut : undefined);
  const soldMax = sum(step => step.kind === "sell" ? step.maxIn : undefined);
  const received = sum(step => step.kind === "sell" ? step.amountOut : undefined);
  const needsEligibility = !!account && !!stock && !isEligible(stock) && target > (current ?? 1) + 0.005;

  return (
    <div className="app-ticket simple-ticket">
      <header className="app-ticket-head">
        <div className="app-asset">
          <TokenIcon symbol={id} size={36} />
          <div>
            <h2 id="simple-heading" tabIndex={-1} ref={heading}>Leveraged borrow</h2>
            <p className="simple-ticket-market">{id} collateral · USDT pool</p>
          </div>
        </div>
        <dl className="app-ticket-rate"><dt>Borrow APR</dt><dd>{data ? formatRate(data.borrowRate) : "—"}</dd></dl>
      </header>

      <div className="app-ticket-body simple-form">
        <ReadStatus query={query} />
        {data && borrowGate(data, liveStock(data, id)) && (
          <div className="dapp-banner" role="status"><strong>New borrowing is gated.</strong> {borrowGate(data, liveStock(data, id))}</div>
        )}

        {swapMissing && (
          <div className="dapp-banner" role="status"><strong>Leverage is not open yet.</strong> The swap contract has not been deployed.</div>
        )}

        {!progress && (
          <>
            <Details rows={[
              ["Leverage now", account ? times(current) : "—"],
              ["Collateral", held ? `${formatAmount(held.collateral)} ${id}` : "—"],
              ["Debt", held ? usdt(held.debt) : "—"],
              ["Market status", data ? `${statusLabel(liveStock(data, id))} · ${formatBps(borrowLtv(liveStock(data, id)))} borrow LTV` : "—"],
            ]} />

            <div>
              <div className="app-amount-heading"><label htmlFor="lev-collateral">Add collateral from your wallet</label>
                <span id="lev-collateral-limit">{stock ? `${formatAmount(stock.wallet)} ${id} in wallet` : "—"}</span></div>
              <div className="app-amount">
                <input id="lev-collateral" inputMode="decimal" autoComplete="off" placeholder="0.00" value={collateral} disabled={tx.busy}
                  onChange={event => { setCollateral(event.target.value); setMessage(undefined); tx.clearFeedback(); }}
                  aria-invalid={collateralError || undefined} aria-describedby="lev-collateral-limit" />
                <span>{id}</span>
                <button type="button" disabled={tx.busy || !stock?.wallet}
                  onClick={() => setCollateral(formatUnits(stock!.wallet, 18))}>Max</button>
              </div>
              {collateralError && <p className="app-message">Enter an amount up to your wallet balance, with up to 18 decimals.</p>}
            </div>

            <div>
              <div className="app-amount-heading"><label htmlFor="lev-target">Target leverage</label>
                <span>{times(target)} · up to {max.toFixed(2)}× now</span></div>
              <input id="lev-target" type="range" className="lev-range" min={1} max={max} step={0.01} value={target}
                disabled={tx.busy || !account} onChange={event => { setChosen(Number(event.target.value)); setMessage(undefined); tx.clearFeedback(); }}
                aria-valuetext={`${target.toFixed(2)} times`} />
              <div className="lev-presets">
                {current !== null && current > 1.005 && (
                  <button type="button" className="btn btn-quiet" disabled={tx.busy} onClick={() => setChosen(1)}>1× · repay all debt</button>)}
                <button type="button" className="btn btn-quiet" disabled={tx.busy || !account} onClick={() => setChosen(max)}>Max ({max.toFixed(2)}×)</button>
              </div>
              {closing && !!held && held.collateral > 0n && (
                <label className="lev-check">
                  <input type="checkbox" checked={withdrawAll} disabled={tx.busy} onChange={event => setWithdrawAll(event.target.checked)} />
                  Close the position: withdraw all collateral after repaying
                </label>
              )}
            </div>

            {plan && account && (
              <Details rows={[
                ["Plan", plan.direction === "increase" ? `Increase · ${plan.rounds} round${plan.rounds === 1 ? "" : "s"} of borrow, swap, supply`
                  : plan.direction === "reduce" ? `Reduce · ${plan.rounds} round${plan.rounds === 1 ? "" : "s"} of withdraw, swap, repay`
                  : plan.direction === "close" ? "Close · repay all debt" + (withdrawAll ? " and withdraw collateral" : "")
                  : plan.steps.length ? "Add collateral" : "No change"],
                ...(borrowed ? [
                  ["USDT to borrow", usdt(borrowed)],
                  ["Stock bought", `${formatAmount(bought)} ${id}`],
                ] as [string, string][] : []),
                ...(received ? [
                  [`${id} sold, at most`, `${formatAmount(soldMax)} ${id}`],
                  ["USDT received", usdt(received)],
                ] as [string, string][] : []),
                ...(quote.data?.price ? [
                  ["Swap quote", `${formatAmount(quote.data.price)} USDT per ${id} · oracle ${formatAmount(oraclePrice(account, liveStock(account, id)))}`],
                  ["Max slippage", `${Number(LIVE_LEVERAGE.slippageBps) / 100}%`],
                ] as [string, string][] : []),
                ["Resulting leverage", times(plan.resulting)],
                ["Resulting debt", usdt(plan.after.debt)],
                ["Resulting collateral", `${formatAmount(plan.after.collateral)} ${id}`],
                ["Health factor", formatHealth(plan.after.healthFactor)],
                ["Liquidation price", plan.after.liquidationPrice === null ? "None" : formatUsd(plan.after.liquidationPrice)],
              ]} />
            )}

            {quote.isError && <p className="app-message" role="alert">No swap quote is available. {errorMessage(quote.error)}{" "}
              <button type="button" className="btn btn-quiet" onClick={() => void quote.refetch()}>Retry</button></p>}
            {plan?.blocked && <p className="app-message" role="status">{plan.blocked}</p>}
            {plan && !plan.blocked && !plan.reachable && (
              <p className="app-message" role="status">{batch ? "One batch stops short of this target. Run it, then repeat, or go step by step."
                : "Limits stop this plan short of the target."}</p>
            )}

            <fieldset className="lev-execution">
              <legend>Execution</legend>
              <p>{BATCHING_TEXT[batching]} {batch ? "Every step runs in one transaction, or none of them do."
                : "Each step is a separate transaction. Completed steps stay in effect if a later one fails."}
                {batch && plan?.steps.length ? ` Calls in this batch: up to ${plan.calls}.` : ""}</p>
              {canBatch && (
                <label className="lev-check">
                  <input type="checkbox" checked={stepwise} disabled={tx.busy} onChange={event => { setStepwise(event.target.checked); setMessage(undefined); tx.clearFeedback(); }} />
                  Go step by step instead
                </label>
              )}
              <WalletAction>
                {needsEligibility && (
                  <button type="button" className="btn app-submit" disabled={tx.busy || query.isError}
                    onClick={() => void tx.requestEligibility(stock!)}>Request {id} eligibility</button>
                )}
                <button type="button" className="btn app-submit" disabled={!canRun || batching === "checking"}
                  onClick={() => batch ? void runOneClick() : startSteps()}>
                  {tx.busy ? "Wallet action in progress" : batch ? "Execute in one click" : "Start step by step"}
                </button>
              </WalletAction>
              {message && <p className="app-message" role="alert">{message}</p>}
              <p className="lev-note">{IS_DEMO ? "Test tokens with no value; transactions cost real BNB gas." : "Real tokens and BNB gas."} The contracts are unaudited. Swaps leave any unspent USDT or {id} in your wallet. Leverage increases losses and the risk of liquidation.</p>
            </fieldset>
          </>
        )}

        {progress && (
          <div className="lev-guided">
            <h3>Step by step</h3>
            <ol>
              {progress.steps.map((step, index) => {
                const done = index < progress.done;
                const active = index === progress.done;
                return (
                  <li key={index} className={done ? "lev-done" : active ? "lev-current" : undefined} aria-current={active ? "step" : undefined}>
                    <span>{done ? "✓" : index + 1}</span> {describe(step, id)}
                  </li>
                );
              })}
            </ol>
            {progress.tidied && <p className="app-message" role="status">Confirmed: {progress.tidied}.</p>}
            {!tx.busy && progress.done < progress.steps.length && (
              <div className="dapp-banner dapp-banner-risk" role="alert">
                <strong>The run stopped at step {progress.done + 1}.</strong> Completed steps stay in effect
                {account ? `. You owe ${usdt(usdtDebt(account))}` : ""}. Check any submitted transaction on BscScan before acting again.
                <div className="lev-actions">
                  {tidy && <button type="button" className="btn" onClick={() => void runTidy()}>{describe(tidy, id)}</button>}
                  {!progress.tidied && (
                    <button type="button" className="btn btn-quiet" onClick={() => void runSteps(progress)}>Retry step {progress.done + 1}</button>)}
                  <button type="button" className="btn btn-quiet" onClick={finishEarly}>Finish here</button>
                </div>
              </div>
            )}
            <p className="lev-note">Limits are checked again at every step, so a price move can stop the plan midway.</p>
          </div>
        )}
        <TxFeedback feedback={tx.feedback} />
      </div>
    </div>
  );
}

export function LiveLeverageSummary({ receipt, heading, onRestart }: {
  receipt: LiveLeverageReceipt; heading: RefObject<HTMLHeadingElement | null>; onRestart: () => void;
}) {
  const { stock: id, before, after } = receipt;
  const was = position(before, liveStock(before, id));
  const now = position(after, liveStock(after, id));
  const moved = `${times(currentLeverage(before, id))} → ${times(currentLeverage(after, id))}`;
  const hashes = [...new Set(receipt.transactions.map(item => item.hash))];
  return (
    <div className="simple-receipt">
      <h2 className="simple-success" id="simple-heading" tabIndex={-1} ref={heading}>
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 12 4 4L19 6" />
        </svg>
        <span>{receipt.stoppedEarly ? "Stopped early" : `Leverage ${moved}`}</span>
      </h2>
      <p>Confirmed on BNB Smart Chain.</p>
      <Details rows={[
        ["Stock", `${id} collateral · USDT pool`],
        ["Execution", receipt.mode === "one-click" ? "One atomic batch" : "Step by step"],
        ["Collateral", `${formatAmount(was.collateral)} → ${formatAmount(now.collateral)} ${id}`],
        ["Debt", `${formatAmount(was.debt)} → ${usdt(now.debt)}`],
        ["Leverage", moved],
        ["Health factor", `${formatHealth(was.healthFactor)} → ${formatHealth(now.healthFactor)}`],
        ["Wallet USDT", `${formatAmount(before.usdt.wallet)} → ${usdt(after.usdt.wallet)}`],
        [`Wallet ${id}`, `${formatAmount(liveStock(before, id).wallet)} → ${formatAmount(liveStock(after, id).wallet)}`],
        ["Wallet", receipt.address],
        ["Confirmed at", receipt.timestamp],
        ...hashes.map((hash, index) => [hashes.length === 1 ? "Transaction" : `Transaction ${index + 1}`,
          <a key={hash} href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer">{`${hash.slice(0, 10)}…${hash.slice(-8)}`}</a>,
        ] as [string, ReactNode]),
      ]} />
      <ol className="lev-steps-done">{receipt.completed.map((line, index) => <li key={index}>{line}</li>)}</ol>
      <button type="button" className="btn" onClick={onRestart}>Start another transaction</button>
    </div>
  );
}
