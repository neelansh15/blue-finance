"use client";

// Leveraged borrowing in Simplified Mode (architecture-v3.md, section 6). Simulated: no transaction is sent.
// One-click needs a wallet that can batch calls atomically on BNB Chain (EIP-5792). Without it, the user is
// guided through each borrow, swap and supply, and completed steps stay in effect if a later one fails.

import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { useAccount, useCapabilities } from "wagmi";
import { bsc } from "wagmi/chains";
import TokenIcon from "../../components/TokenIcon";
import CorpActionBanner from "../components/CorpActionBanner";
import { health, ltv, money, percent, quantity } from "../format";
import {
  actionLimits, borrowLtv, CENTS_PER_USDT, parseAmount, poolMetrics, positionMetrics, STATUS_LABEL, stockStatus,
  STOCKS, TOKENS_PER_UNIT, type PoolState, type StockId,
} from "../markets";
import type { BlueClient } from "../../../src/lib/blue/client";
import {
  LEVERAGE, currentLeverage, describeStep, executeAtomically, executeStep, maxLeverage, planLeverage,
  type LeveragePlan, type LeverageStep,
} from "../../../src/lib/blue/leverage";

export type LeverageReceipt = {
  stock: StockId;
  mode: "one-click" | "guided";
  before: PoolState;
  after: PoolState;
  completed: string[];
  stoppedEarly: boolean;
  address: string;
  timestamp: string;
};

type Batching = "checking" | "supported" | "unsupported" | "unavailable" | "wrong-chain";
type BatchingOverride = "detected" | "supported" | "unsupported";

const usdt = (cents: number) => `${quantity.format(cents / CENTS_PER_USDT)} USDT`;
const tokens = (units: number, stock: StockId) => `${quantity.format(units / TOKENS_PER_UNIT)} ${stock}`;
const times = (value: number | null) =>
  value === null ? "–" : Number.isFinite(value) ? `${value.toFixed(2)}×` : "No equity";
const isSwap = (step: LeverageStep) => step.kind === "buy" || step.kind === "sell";

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="app-preview">{rows.map(([label, value]) => (
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
  ))}</dl>;
}

/** Checks the wallet's atomic batching capability on BNB Chain, again whenever the account or network changes. */
function useBatching(): Batching {
  const { address, chainId } = useAccount();
  const caps = useCapabilities({ chainId: bsc.id, query: { retry: false, enabled: !!address } });
  const { refetch } = caps;
  useEffect(() => { if (address) void refetch(); }, [address, chainId, refetch]);
  if (caps.isPending) return "checking";
  if (caps.isError) return "unavailable";
  const raw = caps.data as { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } } | undefined;
  const supported = raw?.atomic?.status === "supported" || raw?.atomic?.status === "ready" || raw?.atomicBatch?.supported === true;
  if (!supported) return "unsupported";
  return chainId === bsc.id ? "supported" : "wrong-chain";
}

const BATCHING_TEXT: Record<Batching, string> = {
  checking: "Checking your wallet…",
  supported: "Your wallet can batch calls atomically on BNB Chain.",
  unsupported: "Your wallet does not report atomic batching on BNB Chain.",
  unavailable: "Your wallet did not answer the batching check.",
  "wrong-chain": "Your wallet can batch calls, but it is not on BNB Chain.",
};

export function LeverageMarkets({ state, heading, onSelect }: {
  state: PoolState; heading: RefObject<HTMLHeadingElement | null>; onSelect: (stock: StockId) => void;
}) {
  const own = state.account.stock;
  return (
    <>
      <h2 id="simple-heading" tabIndex={-1} ref={heading}>Choose a stock to lever</h2>
      <p>Opening or increasing a leveraged long borrows USDT, swaps it for more of the same stock and supplies that stock as collateral.
        {own && ` Your account uses ${own} as collateral, so leverage applies to ${own}.`}</p>
      <table className="simple-table" aria-labelledby="simple-heading">
        <thead><tr><th scope="col">Stock</th><th scope="col">Borrow LTV</th><th scope="col">Leverage now</th>
          <th scope="col">Max leverage</th><th scope="col">Status</th></tr></thead>
        <tbody>{STOCKS.map(item => {
          const status = stockStatus(state, item.id);
          const locked = !!own && own !== item.id;
          const held = state.account.wallet[item.id];
          // A new position starts from the stock already in the wallet.
          const max = maxLeverage(state, item.id, own === item.id ? 0 : held);
          return (
            <tr key={item.id} className="simple-market-row">
              <th scope="row">
                <button className="simple-market" type="button" disabled={locked} onClick={() => onSelect(item.id)}
                  aria-label={locked ? `${item.symbol} unavailable: one collateral stock per account` : `Select ${item.symbol}`}>
                  <span className="app-asset"><TokenIcon symbol={item.id} size={28} />{item.symbol}</span><span aria-hidden="true">→</span>
                </button>
              </th>
              <td>{ltv(borrowLtv(status))}</td>
              <td>{own === item.id ? times(currentLeverage(state)) : "–"}</td>
              <td>{locked ? "Other stock in use" : `${max.toFixed(2)}×`}</td>
              <td>{STATUS_LABEL[status]}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </>
  );
}

export function LeverageTicket({ state, client, stock, address, heading, onDone }: {
  state: PoolState; client: BlueClient; stock: StockId; address: string;
  heading: RefObject<HTMLHeadingElement | null>; onDone: (receipt: LeverageReceipt) => void;
}) {
  const detected = useBatching();
  const { address: walletAddress } = useAccount();
  const [override, setOverride] = useState<BatchingOverride>("detected");
  const batching: Batching = override === "detected" ? detected : override;
  const oneClick = batching === "supported";

  const hasPosition = state.account.stock === stock;
  const walletTokens = state.account.wallet[stock];
  const [collateral, setCollateral] = useState(hasPosition ? "" : String(walletTokens / TOKENS_PER_UNIT));
  const added = parseAmount(collateral, TOKENS_PER_UNIT);
  const collateralError = collateral !== "" && (added < 0 || added > walletTokens);
  const addTokens = collateralError ? 0 : added;

  const now = currentLeverage(state);
  const max = maxLeverage(state, stock, addTokens);
  const [target, setTarget] = useState(() => Math.min(max, Math.max(1.5, now ?? 1)));
  const clamped = Math.min(Math.max(1, target), max);
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [quotedAt, setQuotedAt] = useState(() => Date.now());
  const [failSwap, setFailSwap] = useState(false);
  const [message, setMessage] = useState<string>();
  const [guided, setGuided] = useState<{ plan: LeveragePlan; before: PoolState; done: string[]; failed?: string; repaid?: string }>();

  const plan = useMemo(
    () => planLeverage(state, stock, clamped, addTokens, withdrawAll && clamped <= 1, quotedAt),
    [state, stock, clamped, addTokens, withdrawAll, quotedAt],
  );
  const after = positionMetrics(plan.after);
  const status = stockStatus(state, stock);
  const buys = plan.steps.filter(step => step.kind === "buy");
  const sells = plan.steps.filter(step => step.kind === "sell");
  const borrowed = plan.steps.reduce((sum, step) => sum + (step.kind === "borrow" ? step.cents : 0), 0);
  const nothingToDo = plan.direction === "none" && !plan.blocked;
  const canRun = plan.steps.length > 0 && !plan.blocked && !collateralError;

  function runOneClick() {
    setMessage(undefined);
    // Recheck before submitting: account, chain, stock permission, quote expiry and the slippage bound.
    if (walletAddress !== address) { setMessage("The connected account changed. Review the plan again."); return; }
    if (!oneClick) { setMessage("One-click needs atomic batching on BNB Chain. Use the guided steps instead."); return; }
    if (Date.now() - plan.quotedAt > LEVERAGE.quoteSeconds * 1000) {
      setQuotedAt(Date.now());
      setMessage("The quote expired and has been refreshed. Review the new figures and confirm again.");
      return;
    }
    const fresh = planLeverage(client.getState(), stock, clamped, addTokens, withdrawAll && clamped <= 1, plan.quotedAt);
    if (fresh.blocked || fresh.steps.length !== plan.steps.length) {
      setMessage(fresh.blocked ?? "Limits changed since the preview. Review the plan again.");
      return;
    }
    const before = client.getState();
    const result = executeAtomically(before, fresh, failSwap);
    if (!result.ok) { setMessage(result.message); return; }
    client.commit(result.state);
    onDone({ stock, mode: "one-click", before, after: result.state, completed: fresh.steps.map(step => describeStep(step, stock)),
      stoppedEarly: false, address, timestamp: new Date().toISOString() });
  }

  function startGuided() {
    setMessage(undefined);
    setGuided({ plan, before: client.getState(), done: [] });
  }

  function confirmStep() {
    if (!guided) return;
    const step = guided.plan.steps[guided.done.length];
    const firstSwap = isSwap(step) && !guided.plan.steps.slice(0, guided.done.length).some(isSwap);
    const result = executeStep(client.getState(), stock, step, failSwap && firstSwap);
    if (!result.ok) { setGuided({ ...guided, failed: result.message }); return; }
    client.commit(result.state);
    const done = [...guided.done, describeStep(step, stock)];
    if (done.length === guided.plan.steps.length) {
      onDone({ stock, mode: "guided", before: guided.before, after: result.state, completed: done, stoppedEarly: false,
        address, timestamp: new Date().toISOString() });
    } else setGuided({ ...guided, done });
  }

  function stopGuided() {
    if (!guided) return;
    onDone({ stock, mode: "guided", before: guided.before, after: client.getState(),
      completed: guided.repaid ? [...guided.done, guided.repaid] : guided.done,
      stoppedEarly: true, address, timestamp: new Date().toISOString() });
  }

  function repayWithBorrowed() {
    const current = client.getState();
    const cents = Math.min(current.account.usdt, current.account.debt, guided?.before ? current.account.debt - guided.before.account.debt : 0);
    if (cents <= 0) return;
    const result = executeStep(current, stock, { kind: "repay", cents });
    if (result.ok) {
      client.commit(result.state);
      setGuided(g => g && { ...g, repaid: `Repaid ${usdt(cents)} with the borrowed USDT.` });
    }
  }

  const live = client.getState();
  const outstanding = guided ? live.account.debt - guided.before.account.debt : 0;

  return (
    <div className="app-ticket simple-ticket">
      <header className="app-ticket-head">
        <div className="app-asset">
          <TokenIcon symbol={stock} size={36} />
          <div>
            <h2 id="simple-heading" tabIndex={-1} ref={heading}>Leveraged borrow</h2>
            <p className="simple-ticket-market">{stock} collateral · USDT pool</p>
          </div>
        </div>
        <dl className="app-ticket-rate"><dt>Borrow APR</dt><dd>{percent(poolMetrics(state).borrowApr)}</dd></dl>
      </header>

      <div className="app-ticket-body simple-form">
        <CorpActionBanner state={state} stock={stock} />

        {!guided && (
          <>
            <Details rows={[
              ["Leverage now", times(now)],
              ["Collateral", tokens(state.account.stock === stock ? state.account.collateral : 0, stock)],
              ["Debt", usdt(state.account.stock === stock ? state.account.debt : 0)],
              ["Market status", `${STATUS_LABEL[status]} · ${ltv(borrowLtv(status))} borrow LTV`],
            ]} />

            <div>
              <div className="app-amount-heading"><label htmlFor="lev-collateral">Add collateral from your wallet</label>
                <span id="lev-collateral-limit">{tokens(walletTokens, stock)} in wallet</span></div>
              <div className="app-amount">
                <input id="lev-collateral" inputMode="decimal" placeholder="0.00" value={collateral}
                  onChange={event => setCollateral(event.target.value)} aria-invalid={collateralError || undefined}
                  aria-describedby="lev-collateral-limit" />
                <span>{stock}</span>
                <button type="button" disabled={!walletTokens} onClick={() => setCollateral(String(walletTokens / TOKENS_PER_UNIT))}>Max</button>
              </div>
              {collateralError && <p className="app-message">Enter an amount up to your wallet balance, with up to four decimals.</p>}
            </div>

            <div>
              <div className="app-amount-heading"><label htmlFor="lev-target">Target leverage</label>
                <span>{times(clamped)} · up to {max.toFixed(2)}× now</span></div>
              <input id="lev-target" type="range" className="lev-range" min={1} max={Math.max(1, max)} step={0.01}
                value={clamped} onChange={event => setTarget(Number(event.target.value))}
                aria-valuetext={`${clamped.toFixed(2)} times`} />
              <div className="lev-presets">
                {now !== null && Number.isFinite(now) && now > 1.005 && (
                  <button type="button" className="btn btn-quiet" onClick={() => setTarget(1)}>1× · repay all debt</button>)}
                <button type="button" className="btn btn-quiet" onClick={() => setTarget(max)}>Max ({max.toFixed(2)}×)</button>
              </div>
              {clamped <= 1 && hasPosition && (
                <label className="lev-check">
                  <input type="checkbox" checked={withdrawAll} onChange={event => setWithdrawAll(event.target.checked)} />
                  Close the position: withdraw all collateral after repaying
                </label>
              )}
            </div>

            <Details rows={[
              ["Plan", plan.direction === "increase" ? `Increase · ${plan.rounds} round${plan.rounds === 1 ? "" : "s"} of borrow, swap, supply`
                : plan.direction === "reduce" ? `Reduce · ${plan.rounds} round${plan.rounds === 1 ? "" : "s"} of withdraw, swap, repay`
                : plan.direction === "close" ? "Close · repay all debt" + (withdrawAll ? " and withdraw collateral" : "")
                : "No change"],
              ...(buys.length ? [
                ["USDT to borrow", usdt(borrowed)],
                ["Estimated swap output", tokens(buys.reduce((sum, step) => sum + (step.kind === "buy" ? step.expectedTokens : 0), 0), stock)],
                ["Minimum received", tokens(buys.reduce((sum, step) => sum + (step.kind === "buy" ? step.minTokens : 0), 0), stock)],
              ] as [string, string][] : []),
              ...(sells.length ? [
                [`${stock} to sell`, tokens(sells.reduce((sum, step) => sum + (step.kind === "sell" ? step.tokens : 0), 0), stock)],
                ["Estimated swap output", usdt(sells.reduce((sum, step) => sum + (step.kind === "sell" ? step.expectedCents : 0), 0))],
              ] as [string, string][] : []),
              ["Resulting leverage", times(currentLeverage(plan.after))],
              ["Resulting debt", usdt(plan.after.account.debt)],
              ["Resulting collateral", tokens(plan.after.account.collateral, stock)],
              ["Health factor", health(after.healthFactor)],
              ["Estimated liquidation price", after.liquidationPrice === null ? "None" : money(after.liquidationPrice)],
              ["Quote", `${money(plan.quotePrice)} per ${stock} · ${percent(LEVERAGE.swapFee, 1)} swap fee · ${percent(LEVERAGE.slippage, 1)} max slippage`],
            ]} />

            {plan.blocked && <p className="app-message" role="status">{plan.blocked}</p>}
            {!plan.blocked && !plan.reachable && <p className="app-message" role="status">Limits stop this plan short of the target.</p>}
            {nothingToDo && <p className="app-message">Move the target to preview a change.</p>}
            {status === "HALTED" || status === "CORP_ACTION" ? (
              <p className="app-message">During a halt or corporate action, withdrawing while in debt is blocked and repayment may need wallet USDT.</p>
            ) : null}

            <fieldset className="lev-execution">
              <legend>Execution</legend>
              <p>{BATCHING_TEXT[batching]} {oneClick ? "Every step runs as one action, or none of them do."
                : "You can still go step by step: borrow, swap, supply. Completed steps stay in effect if a later one fails."}</p>
              <label>Wallet batching (demo)
                <select value={override} onChange={event => setOverride(event.target.value as BatchingOverride)}>
                  <option value="detected">Detected from wallet</option>
                  <option value="supported">Simulate supported</option>
                  <option value="unsupported">Simulate unsupported</option>
                </select>
              </label>
              <label className="lev-check">
                <input type="checkbox" checked={failSwap} onChange={event => setFailSwap(event.target.checked)} />
                Simulate a failed swap (demo)
              </label>
              <div className="lev-actions">
                {oneClick && <button type="button" className="btn app-submit" disabled={!canRun} onClick={runOneClick}>Execute in one click (simulated)</button>}
                <button type="button" className={oneClick ? "btn btn-quiet" : "btn app-submit"} disabled={!canRun} onClick={startGuided}>
                  {oneClick ? "Go step by step instead" : "Start guided steps"}
                </button>
              </div>
              {message && <p className="app-message" role="alert">{message}</p>}
              <p className="lev-note">Every borrow passes the pool’s stock controls and must fit the borrow limit at that point in the sequence. Targets beyond {LEVERAGE.maxRounds} rounds would need a helper contract or flash loan, which the prototype does not offer.</p>
            </fieldset>
          </>
        )}

        {guided && (
          <div className="lev-guided">
            <h3>Guided steps</h3>
            <ol>
              {guided.plan.steps.map((step, index) => {
                const done = index < guided.done.length;
                const current = index === guided.done.length;
                return (
                  <li key={index} className={done ? "lev-done" : current ? "lev-current" : undefined} aria-current={current ? "step" : undefined}>
                    <span>{done ? "✓" : index + 1}</span> {describeStep(step, stock)}
                  </li>
                );
              })}
            </ol>
            {guided.failed ? (
              <div className="dapp-banner dapp-banner-risk" role="alert">
                <strong>{guided.failed}</strong>{" "}
                {guided.repaid ? `${guided.repaid} You owe ${usdt(live.account.debt)} and hold ${usdt(live.account.usdt)} in your wallet.`
                  : outstanding > 0
                  ? `Completed steps stay in effect. You now owe ${usdt(live.account.debt)} in total, ${usdt(outstanding)} of it from this flow, and hold ${usdt(live.account.usdt)} in your wallet.`
                  : "Completed steps stay in effect."}
                <div className="lev-actions">
                  {!guided.repaid && outstanding > 0 && live.account.usdt > 0 && (
                    <button type="button" className="btn" onClick={repayWithBorrowed}>Repay with the borrowed USDT</button>)}
                  <button type="button" className="btn btn-quiet" onClick={stopGuided}>Finish here</button>
                </div>
              </div>
            ) : (
              <div className="lev-actions">
                <button type="button" className="btn app-submit" onClick={confirmStep}>
                  Confirm step {guided.done.length + 1} of {guided.plan.steps.length} in wallet (simulated)
                </button>
                <button type="button" className="btn btn-quiet" onClick={stopGuided}>Stop after completed steps</button>
              </div>
            )}
            <p className="lev-note">Each step is a separate transaction. Limits are checked again at every step, so a price move can stop the plan midway.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function LeverageSummary({ receipt, heading, onRestart }: {
  receipt: LeverageReceipt; heading: RefObject<HTMLHeadingElement | null>; onRestart: () => void;
}) {
  const { stock, before, after } = receipt;
  const beforeMetrics = positionMetrics(before);
  const afterMetrics = positionMetrics(after);
  const limits = actionLimits(after, stock);
  return (
    <div className="simple-receipt">
      <h2 className="simple-success" id="simple-heading" tabIndex={-1} ref={heading}>
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 12 4 4L19 6" />
        </svg>
        <span>{receipt.stoppedEarly ? `Stopped after ${receipt.completed.length} step${receipt.completed.length === 1 ? "" : "s"}` : `Leverage ${times(currentLeverage(before))} → ${times(currentLeverage(after))}`}</span>
      </h2>
      <p>Simulated {receipt.mode === "one-click" ? "one-click batch" : "guided transactions"}. Your demo position was updated.</p>
      <Details rows={[
        ["Stock", `${stock} collateral · USDT pool`],
        ["Execution", receipt.mode === "one-click" ? "One atomic batch" : `${receipt.completed.length} separate step${receipt.completed.length === 1 ? "" : "s"}`],
        ["Collateral", `${tokens(before.account.stock === stock ? before.account.collateral : 0, stock)} → ${tokens(after.account.collateral, stock)}`],
        ["Debt", `${usdt(before.account.debt)} → ${usdt(after.account.debt)}`],
        ["Leverage", `${times(currentLeverage(before))} → ${times(currentLeverage(after))}`],
        ["Health factor", `${health(beforeMetrics.healthFactor)} → ${health(afterMetrics.healthFactor)}`],
        ["Can still borrow", usdt(limits.borrow.max)],
        ["Wallet", receipt.address],
        ["Executed at", receipt.timestamp],
        ["Transaction Hash", "Unavailable for simulated transactions"],
      ]} />
      {receipt.completed.length > 0 && (
        <ol className="lev-steps-done">{receipt.completed.map((line, index) => <li key={index}>{line}</li>)}</ol>
      )}
      <button type="button" className="btn" onClick={onRestart}>Start another transaction</button>
    </div>
  );
}
