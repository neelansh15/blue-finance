"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import {
  BaseError, ContractFunctionRevertedError, decodeFunctionData, encodeFunctionData, formatUnits, getContractError, isAddressEqual, maxUint256, zeroAddress,
  type Address, type Hex,
} from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { bsc } from "wagmi/chains";
import TokenIcon from "../components/TokenIcon";
import {
  BLUE, controlsContract, eligibilityDomain, eligibilityTypes, liveStocks, parseTokenAmount,
  poolContract, priceSourceAbi, tokenContract,
} from "../../src/lib/blue/mainnet";
import { readLiveState } from "../../src/lib/blue/live-state";
import { MARKET_STATUSES, STATUS_LABEL, type StockId } from "./markets";

const actions = ["Supply USDT", "Withdraw USDT", "Supply stock", "Withdraw stock", "Borrow USDT", "Repay USDT"] as const;
type Action = typeof actions[number];
type View = "pool" | "earn" | "borrow" | "dashboard" | "risk";

const views: Record<View, { title: string; initial: Action; actions: readonly Action[] }> = {
  pool: { title: "Blue onchain", initial: "Supply USDT", actions },
  earn: { title: "Earn with USDT", initial: "Supply USDT", actions: ["Supply USDT", "Withdraw USDT"] },
  borrow: { title: "Borrow against stocks", initial: "Supply stock", actions: ["Supply stock", "Borrow USDT", "Repay USDT", "Withdraw stock"] },
  dashboard: { title: "Your portfolio", initial: "Supply USDT", actions },
  risk: { title: "Pool risk", initial: "Supply USDT", actions: [] },
};

type Feedback = { message: string; error?: boolean; hash?: Hex };

const transactionAbi = [...poolContract.abi, ...controlsContract.abi, ...priceSourceAbi, ...tokenContract(BLUE.usdt).abi];
const explorer = bsc.blockExplorers.default.url;
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

function display(value: bigint | undefined, decimals = 18) {
  if (value === undefined) return "Unavailable";
  if (value > 0n && value < 10n ** BigInt(Math.max(0, decimals - 6))) return "<0.000001";
  return number.format(Number(formatUnits(value, decimals)));
}

function errorMessage(error: unknown) {
  if (error instanceof BaseError) {
    const revert = error.walk(cause => cause instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      switch (revert.data?.errorName) {
        case "OneStockRequired": return "Enable the stock you want to borrow against as collateral.";
        case "NewRiskBlocked": return "The stock’s keeper or price checks are blocking this action.";
        case "Ineligible": return "Register eligibility for this wallet and stock.";
        case "StockDebtCapExceeded": return "This amount exceeds the stock’s remaining borrow cap.";
        case "DiscontinuousPrice": return "The latest round is outside the accepted price band. The admin must review it.";
        case "UnusablePrice": return "The source has no usable price round.";
        case "InvalidEligibility": return "The eligibility signature has expired or its nonce changed.";
        default: return revert.shortMessage;
      }
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : "The operation failed.";
}

export default function LiveApp({ view = "pool", onBack }: { view?: View; onBack?: () => void }) {
  const config = views[view];
  const isEarn = view === "earn";
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: bsc.id });
  const wallet = useWalletClient({ chainId: bsc.id }).data;
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const [selected, setSelected] = useState<StockId>("TSLAB");
  const [action, setAction] = useState<Action>(config.initial);
  const [amount, setAmount] = useState("");
  const [repayAll, setRepayAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<Feedback>();

  const state = useQuery({
    queryKey: ["blue-mainnet", address],
    enabled: !!publicClient,
    queryFn: () => readLiveState(publicClient!, address),
    staleTime: 12_000,
    refetchInterval: 20_000,
  });
  const data = state.data;
  const stock = data?.stocks.find(item => item.id === selected);
  const stockAddress = liveStocks.find(item => item.id === selected)!.address;
  const stockAction = action === "Supply stock" || action === "Withdraw stock";
  const usesCollateral = stockAction || action === "Borrow USDT";
  const asset = stockAction ? stockAddress : BLUE.usdt;
  const parsed = parseTokenAmount(amount);
  const walletAmount = stockAction ? stock?.wallet : data?.usdt.wallet;
  const supplied = stockAction ? stock?.reserve[0] : data?.usdt.reserve[0];
  const debt = data?.usdt.reserve[2] ?? 0n;
  const shared = data?.sharedReserve;
  const supplyRate = shared ? `${display(shared.supplyRate, 25)}%` : "—";
  const borrowRate = shared ? `${display(shared.borrowRate, 25)}%` : "—";
  const totalLiquidity = data && shared ? data.liquidity + shared.borrowed : 0n;
  const utilisation = shared ? `${totalLiquidity > 0n ? display(shared.borrowed * 10_000n / totalLiquidity, 2) : "0"}%` : "—";
  const earnMax = isEarn && data && address
    ? action === "Supply USDT" ? data.usdt.wallet
      : data.usdt.reserve[0] < data.liquidity ? data.usdt.reserve[0] : data.liquidity
    : undefined;
  const earnAmountError = earnMax !== undefined && parsed !== undefined && parsed > earnMax;
  const showStockSelection = usesCollateral || view === "risk";
  const ticketSymbol = usesCollateral ? selected : "USDT";
  const wrongChain = !!address && chainId !== bsc.id;
  const usable = !!wallet && !wrongChain && !!data && !state.isError;
  const eligible = (stock?.eligibleUntil ?? 0n) > BigInt(Math.floor(Date.now() / 1000));
  const activeCollateral = data?.stocks.find(item => item.reserve[8]);
  const pinned = data?.debtStock !== undefined && data.debtStock !== zeroAddress;
  const canSign = !!address && !!data && isAddressEqual(address, data.signer);
  const isKeeper = !!address && !!data && isAddressEqual(address, data.keeper);
  const amountNeeded = action === "Repay USDT" && repayAll ? debt : parsed;
  const borrowMessage = action === "Borrow USDT" && data
    ? data.liquidity === 0n ? "The USDT reserve needs liquidity."
      : !stock?.reserve[8] || (pinned && !isAddressEqual(data.debtStock, stockAddress)) ? "Supply and enable the selected stock as collateral."
      : !eligible ? "This wallet needs eligibility for the selected stock."
      : !stock.limits ? "New borrowing is gated. Check the stock and USDT prices and the keeper recovery window."
      : undefined
    : undefined;

  async function run(task: (send: (to: Address, encoded: Hex, label: string) => Promise<void>) => Promise<void>) {
    if (!address || !wallet || !publicClient || !usable || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFeedback(undefined);
    let lastHash: Hex | undefined;
    let lastConfirmed = false;
    try {
      await task(async (to, encoded, label) => {
        setFeedback({ message: `Checking ${label}…`, hash: lastHash });
        try {
          await publicClient.call({ account: address, to, data: encoded });
        } catch (error) {
          if (error instanceof BaseError) {
            const { functionName, args } = decodeFunctionData({ abi: transactionAbi, data: encoded });
            throw getContractError(error, { abi: transactionAbi, address: to, sender: address, functionName, args });
          }
          throw error;
        }
        setFeedback({ message: `Approve ${label} in your wallet.`, hash: lastHash });
        lastHash = await wallet.sendTransaction({ account: address, to, data: encoded, chain: bsc });
        lastConfirmed = false;
        setFeedback({ message: `Waiting for ${label} to confirm…`, hash: lastHash });
        let cancelled = false;
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: lastHash,
          onReplaced: replacement => {
            cancelled = replacement.reason !== "repriced";
            lastHash = replacement.transaction.hash;
          },
        });
        lastConfirmed = true;
        if (cancelled || receipt.status !== "success") throw new Error(`${label} was cancelled or reverted.`);
        setFeedback({ message: `${label} confirmed.`, hash: receipt.transactionHash });
      });
    } catch (error) {
      setFeedback({
        message: lastHash && !lastConfirmed ? "The transaction was submitted. Check its status on BscScan before retrying." : errorMessage(error),
        error: true,
        hash: lastHash,
      });
    } finally {
      await state.refetch();
      busyRef.current = false;
      setBusy(false);
    }
  }

  function selectAction(next: Action) {
    setAction(next);
    setAmount("");
    setRepayAll(false);
    setFeedback(undefined);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (amountNeeded === undefined || amountNeeded === 0n || !address || !publicClient || borrowMessage || earnAmountError) return;
    const account = address;
    const client = publicClient;
    await run(async send => {
      const token = tokenContract(asset);
      const amount = action === "Repay USDT" && repayAll ? maxUint256 : amountNeeded;
      if (action === "Supply USDT" || action === "Supply stock" || action === "Repay USDT") {
        const [balance, allowance] = await Promise.all([
          client.readContract({ ...token, functionName: "balanceOf", args: [account] }),
          client.readContract({ ...token, functionName: "allowance", args: [account, BLUE.pool] }),
        ]);
        if (amountNeeded > balance) throw new Error("Your wallet does not have enough tokens.");
        // For a full repayment, allow a small interest buffer, bounded by the wallet balance.
        const buffered = amountNeeded + amountNeeded / 100n + 1n;
        const required = amount === maxUint256 ? (balance < buffered ? balance : buffered) : amount;
        if (allowance < required) {
          await send(asset, encodeFunctionData({ ...token, functionName: "approve", args: [BLUE.pool, required] }), "token approval");
        }
      }
      const encoded = action === "Supply USDT" || action === "Supply stock"
        ? encodeFunctionData({ ...poolContract, functionName: "supply", args: [asset, amount, account, 0] })
        : action === "Withdraw USDT" || action === "Withdraw stock"
          ? encodeFunctionData({ ...poolContract, functionName: "withdraw", args: [asset, amount, account] })
          : action === "Repay USDT"
            ? encodeFunctionData({ ...poolContract, functionName: "repay", args: [BLUE.usdt, amount, 2n, account] })
            : encodeFunctionData({ ...poolContract, functionName: "borrow", args: [BLUE.usdt, amount, 2n, 0, account] });
      await send(BLUE.pool, encoded, action);
      setAmount("");
    });
  }

  function signEligibility() {
    if (!address || !wallet || !publicClient || !canSign) return;
    const account = address;
    const client = publicClient;
    const signingWallet = wallet;
    void run(async send => {
      const [nonce, block] = await Promise.all([
        client.readContract({ ...controlsContract, functionName: "nonces", args: [account] }),
        client.getBlock(),
      ]);
      const expiry = block.timestamp + 7_200n;
      setFeedback({ message: "Sign the eligibility message in your wallet." });
      const signature = await signingWallet.signTypedData({
        account, domain: eligibilityDomain, types: eligibilityTypes, primaryType: "Eligibility",
        message: { account, pool: BLUE.pool, stock: stockAddress, nonce, expiry },
      });
      await send(BLUE.controls, encodeFunctionData({
        ...controlsContract, functionName: "registerEligibility", args: [stockAddress, expiry, signature],
      }), "Register eligibility");
    });
  }

  function requestEligibility() {
    if (!address) return;
    void run(async send => {
      setFeedback({ message: "Requesting eligibility for this wallet and stock…" });
      const response = await fetch("/api/blue/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: address, stock: stockAddress }),
        signal: AbortSignal.timeout(18_000),
      });
      const signed = await response.json();
      if (!response.ok) throw new Error(signed.error ?? "Eligibility is temporarily unavailable.");
      if (typeof signed?.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signed.signature) ||
          typeof signed.expiry !== "string" || !/^\d{1,16}$/.test(signed.expiry)) {
        throw new Error("The signer returned an invalid response.");
      }
      await send(BLUE.controls, encodeFunctionData({
        ...controlsContract, functionName: "registerEligibility",
        args: [stockAddress, BigInt(signed.expiry), signed.signature as Hex],
      }), "Register eligibility");
    });
  }

  function refreshPrice(source: Address, label: string) {
    void run(send => send(source, encodeFunctionData({ abi: priceSourceAbi, functionName: "refresh" }), label));
  }

  return (
    <main id="app-main" tabIndex={-1}>
      <section className="app-masthead">
        <div className="wrap">
          {onBack && <button type="button" className="btn dashboard-secondary" onClick={onBack}>Back to actions</button>}
          <div className="app-heading">
            <h1>{view === "pool" ? <>Blue <em>onchain.</em></> : config.title}</h1>
            <a href={`${explorer}/address/${BLUE.pool}`}>View pool on BscScan</a>
          </div>
          {isEarn ? <dl className="app-summary app-summary-pair">
            <div><dt>Your bluUSDT</dt><dd>{address ? display(data?.usdt.reserve[0]) : "—"}</dd></div>
            <div><dt>Wallet USDT</dt><dd>{address ? display(data?.usdt.wallet) : "—"}</dd></div>
          </dl> : <dl className="app-summary app-summary-overview">
            <div><dt>Available USDT</dt><dd>{display(data?.liquidity)}</dd></div>
            <div><dt>USDT supply cap</dt><dd>{display(data?.caps[1], 0)}</dd></div>
            <div><dt>Your bluUSDT</dt><dd>{address ? display(data?.usdt.reserve[0]) : "—"}</dd></div>
            <div><dt>Your USDT debt</dt><dd>{address ? display(data?.usdt.reserve[2]) : "—"}</dd></div>
          </dl>}
          {state.isPending && <p role="status">Loading pool from BNB Smart Chain…</p>}
          {state.isError && <p role="alert">Pool data could not be refreshed. <button type="button" onClick={() => void state.refetch()}>Retry</button></p>}
        </div>
      </section>

      <div className="wrap app-workspace">
        {isEarn ? <section className="app-market-panel" aria-labelledby="shared-usdt">
          <div className="app-section-heading">
            <h2 id="shared-usdt">USDT pool</h2>
            <span className="app-unit">One shared reserve</span>
          </div>
          <table className="app-market-ledger">
            <thead><tr>
              <th scope="col">Asset</th><th scope="col">Supply APR</th><th scope="col">Borrow APR</th>
              <th scope="col" className="app-market-liquidity">Available</th>
            </tr></thead>
            <tbody><tr>
              <th scope="row"><span className="app-asset">
                <TokenIcon symbol="USDT" size={32} /><span><strong>USDT</strong><small className="app-market-name">Receive bluUSDT</small></span>
              </span></th>
              <td>{supplyRate}</td><td>{borrowRate}</td><td className="app-market-liquidity">{display(data?.liquidity)}</td>
            </tr></tbody>
          </table>
          <dl className="app-preview live-preview">
            <div><dt>Utilisation</dt><dd>{utilisation}</dd></div>
            <div><dt>Total supplied</dt><dd>{display(shared?.supplied)} USDT</dd></div>
            <div><dt>Total borrowed</dt><dd>{display(shared?.borrowed)} USDT</dd></div>
            <div><dt>Available liquidity</dt><dd>{display(data?.liquidity)} USDT</dd></div>
            <div><dt>Supply cap</dt><dd>{display(data?.caps[1], 0)} USDT</dd></div>
          </dl>
          <p className="live-preview">Borrowers across all five stock markets draw from this pool.</p>
        </section> : <section className="app-market-panel" aria-labelledby="live-markets">
          <div className="app-section-heading"><h2 id="live-markets">Collateral markets</h2><span>BNB MAINNET</span></div>
          <table className="app-market-ledger">
            <thead><tr><th scope="col">Stock</th><th scope="col">Price</th><th scope="col">Session</th><th scope="col">New loans</th></tr></thead>
            <tbody>{liveStocks.map(item => {
              const market = data?.stocks.find(stock => stock.id === item.id);
              const status = market?.market === undefined ? undefined : MARKET_STATUSES[market.market];
              const assetLabel = <><TokenIcon symbol={item.id} size={28} /><span><strong>{item.id}</strong><small className="app-market-name">{item.name}</small></span></>;
              return <tr key={item.id} data-selected={showStockSelection && selected === item.id}>
                <th scope="row">
                  {showStockSelection ? <button className="app-market-select app-asset" type="button" aria-pressed={selected === item.id}
                    onClick={() => { setSelected(item.id); setAmount(""); }} disabled={busy}>{assetLabel}</button>
                    : <span className="app-asset">{assetLabel}</span>}
                </th>
                <td>{market?.price === undefined ? "—" : `$${display(market.price, 8)}`}</td>
                <td>{status ? STATUS_LABEL[status] : "—"}</td>
                <td>{!market ? "—" : !market.limits ? "Gated" : data?.liquidity ? "Available" : "No USDT"}</td>
              </tr>;
            })}</tbody>
          </table>
          {address && data && <dl className="app-preview live-preview">
            <div><dt>Active collateral</dt><dd>{activeCollateral?.id ?? "None"}</dd></div>
            {showStockSelection && <div><dt>Supplied {selected}</dt><dd>{display(stock?.reserve[0])}</dd></div>}
            <div><dt>Collateral value</dt><dd>{data.user ? `$${display(data.user[0], 8)}` : "Unavailable"}</dd></div>
            <div><dt>Health factor</dt><dd>{debt === 0n ? "—" : display(data.user?.[5])}</dd></div>
            {showStockSelection && <div><dt>Stock debt{stock?.limits ? " / cap" : ""}</dt><dd>{display(stock?.debt)}{stock?.limits && ` / ${display(stock.limits[1])}`} USDT</dd></div>}
          </dl>}
        </section>}

        {config.actions.length > 0 && <section className="app-ticket live-controls" aria-labelledby="live-manage">
          <header className="app-ticket-head">
            <div className="app-asset"><TokenIcon symbol={ticketSymbol} size={36} />
              <h2 id="live-manage">{usesCollateral ? `${selected} / USDT` : "USDT pool"}</h2>
            </div>
            <dl className="app-ticket-rate">
              <dt>{view === "borrow" || action === "Borrow USDT" || action === "Repay USDT" ? "Borrow APR" : "Supply APR"}</dt>
              <dd>{view === "borrow" || action === "Borrow USDT" || action === "Repay USDT" ? borrowRate : supplyRate}</dd>
            </dl>
          </header>
          <form className="live-form" onSubmit={submit}>
            <fieldset className="market-action-picker app-action-rail live-action-rail">
              <legend className="sr-only">{isEarn ? "Earn action" : "Position action"}</legend>
              <div className="market-action-pair">
                {config.actions.map(next => <label key={next}>
                  <input type="radio" name="live-action" checked={action === next} disabled={busy} onChange={() => selectAction(next)} />
                  <span>{isEarn ? next.replace(" USDT", "") : next}</span>
                </label>)}
              </div>
            </fieldset>
            <div>
              <div className="app-amount-heading">
                <label htmlFor="live-amount">Amount</label>
                {isEarn && earnMax !== undefined && <span>{display(earnMax)} USDT {action === "Withdraw USDT" ? "withdrawable" : "in wallet"}</span>}
              </div>
              <div className="app-amount">
                <input id="live-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount}
                  disabled={busy || repayAll} onChange={event => setAmount(event.target.value)} />
                <span aria-hidden="true">{stockAction ? selected : "USDT"}</span>
                {isEarn && <button type="button" disabled={busy || !earnMax} onClick={() => {
                  if (earnMax) setAmount(formatUnits(earnMax, 18));
                }}>Max</button>}
              </div>
            </div>
            {action === "Repay USDT" && <label className="live-checkbox">
              <input type="checkbox" checked={repayAll} disabled={busy} onChange={event => setRepayAll(event.target.checked)} /> Repay entire debt
            </label>}
            {address && !isEarn && <p>Wallet {display(walletAmount)} {stockAction ? selected : "USDT"}
              {(action === "Withdraw USDT" || action === "Withdraw stock") && ` · Supplied ${display(supplied)}`}
              {action === "Repay USDT" && ` · Debt ${display(debt)}`}
            </p>}
            {!address && <p>Connect your wallet using the header.</p>}
            {wrongChain && <button type="button" disabled={switching} onClick={() => switchChain({ chainId: bsc.id })}>Switch to BNB Smart Chain</button>}
            {switchError && <p role="alert">{errorMessage(switchError)}</p>}
            {borrowMessage && <p>{borrowMessage}</p>}
            {action === "Borrow USDT" && address && !eligible && (
              <button type="button" disabled={!usable || busy} onClick={requestEligibility}>Request {selected} eligibility</button>
            )}
            {amount !== "" && parsed === undefined && !repayAll && <p role="alert">Enter a positive amount, using up to 18 decimal places.</p>}
            {earnAmountError && <p role="alert">Enter at most {display(earnMax)} USDT.</p>}
            {isEarn && address && data && <div className="app-position-preview">
              <p>Current position</p>
              <dl className="app-preview"><div><dt>bluUSDT balance</dt><dd>{display(data.usdt.reserve[0])}</dd></div></dl>
            </div>}
            <button className="btn app-submit" type="submit" disabled={!usable || busy || !amountNeeded || !!borrowMessage || earnAmountError}>{busy ? "Wallet action in progress" : action}</button>
            {usesCollateral && stock && stock.reserve[0] > 0n && !stock.reserve[8] && (
              <button type="button" disabled={!usable || busy} onClick={() => void run(send => send(
                BLUE.pool, encodeFunctionData({ ...poolContract, functionName: "setUserUseReserveAsCollateral", args: [stock.address, true] }), `Enable ${selected} collateral`,
              ))}>Enable {selected} as collateral</button>
            )}
          </form>
          {usesCollateral && (isKeeper || canSign) && <details className="live-operator">
            <summary>Demo operator · {selected}</summary>
            <p>Refresh both sources when their rounds change. After confirming the stock is healthy, report it every 5–8 minutes for at least 30 minutes.</p>
            {isKeeper && <>
              <p>{selected} round {stock?.sourceReady ? "ready" : "needs refresh"} · USDT round {data?.usdt.sourceReady ? "ready" : "needs refresh"}</p>
              <div className="live-buttons">
                <button type="button" disabled={!usable || busy} onClick={() => refreshPrice(liveStocks.find(item => item.id === selected)!.source, `Refresh ${selected} price`)}>Refresh {selected}</button>
                <button type="button" disabled={!usable || busy} onClick={() => refreshPrice(BLUE.usdtSource, "Refresh USDT price")}>Refresh USDT</button>
                <button type="button" disabled={!usable || busy} onClick={() => void run(send => send(
                  BLUE.controls, encodeFunctionData({ ...controlsContract, functionName: "report", args: [stockAddress, true] }), `Report ${selected} healthy`,
                ))}>Report healthy</button>
              </div>
            </>}
            {canSign && <button type="button" disabled={!usable || busy} onClick={signEligibility}>{eligible ? "Renew my eligibility" : "Register my eligibility"}</button>}
          </details>}
          {feedback && <div className="live-feedback" role={feedback.error ? "alert" : "status"}>
            {feedback.message} {feedback.hash && <a href={`${explorer}/tx/${feedback.hash}`}>View transaction</a>}
          </div>}
        </section>}
        {view === "risk" && <section className="app-market-panel live-controls" aria-labelledby="live-risk">
          <div className="app-section-heading"><h2 id="live-risk">Borrowing checks</h2></div>
          <dl className="app-preview live-preview">
            <div><dt>Selected stock</dt><dd>{selected}</dd></div>
            <div><dt>Stock price ready</dt><dd>{stock?.sourceReady === undefined ? "Unavailable" : stock.sourceReady ? "Yes" : "No"}</dd></div>
            <div><dt>USDT price ready</dt><dd>{data?.usdt.sourceReady === undefined ? "Unavailable" : data.usdt.sourceReady ? "Yes" : "No"}</dd></div>
            <div><dt>Active loan-to-value limit</dt><dd>{stock?.limits ? `${display(stock.limits[0], 2)}%` : "Gated"}</dd></div>
            <div><dt>Stock debt cap</dt><dd>{stock?.limits ? `${display(stock.limits[1])} USDT` : "Gated"}</dd></div>
          </dl>
          <p className="live-preview"><Link href="/app/simulator/risk">Open the advisory risk simulator</Link></p>
        </section>}
      </div>
      <div className="wrap live-footer">
        {view !== "risk" && <><Link href="/app/risk">Pool risk</Link><span aria-hidden="true"> · </span></>}
        <Link href="/app/simulator">Simulator</Link>
      </div>
    </main>
  );
}
