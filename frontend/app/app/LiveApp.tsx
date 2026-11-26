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

export default function LiveApp() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: bsc.id });
  const wallet = useWalletClient({ chainId: bsc.id }).data;
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const [selected, setSelected] = useState<StockId>("TSLAB");
  const [action, setAction] = useState<Action>("Supply USDT");
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (amountNeeded === undefined || amountNeeded === 0n || !address || !publicClient || borrowMessage) return;
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

  function refreshPrice(source: Address, label: string) {
    void run(send => send(source, encodeFunctionData({ abi: priceSourceAbi, functionName: "refresh" }), label));
  }

  return (
    <main id="app-main" tabIndex={-1}>
      <section className="app-masthead">
        <div className="wrap">
          <div className="app-heading">
            <h1>Blue <em>onchain.</em></h1>
            <a href={`${explorer}/address/${BLUE.pool}`}>View pool on BscScan</a>
          </div>
          <p>BNB Smart Chain mainnet. Wallet approvals use real tokens and BNB gas.</p>
          <dl className="app-summary app-summary-overview">
            <div><dt>Available USDT</dt><dd>{display(data?.liquidity)}</dd></div>
            <div><dt>USDT supply cap</dt><dd>{display(data?.caps[1], 0)}</dd></div>
            <div><dt>Your bluUSDT</dt><dd>{address ? display(data?.usdt.reserve[0]) : "—"}</dd></div>
            <div><dt>Your USDT debt</dt><dd>{address ? display(data?.usdt.reserve[2]) : "—"}</dd></div>
          </dl>
          {state.isPending && <p role="status">Loading pool from BNB Smart Chain…</p>}
          {state.isError && <p role="alert">Pool data could not be refreshed. <button type="button" onClick={() => void state.refetch()}>Retry</button></p>}
        </div>
      </section>

      <div className="wrap app-workspace">
        <section className="app-market-panel" aria-labelledby="live-markets">
          <div className="app-section-heading"><h2 id="live-markets">Collateral markets</h2><span>BNB MAINNET</span></div>
          <table className="app-market-ledger">
            <thead><tr><th scope="col">Stock</th><th scope="col">Price</th><th scope="col">Session</th><th scope="col">New loans</th></tr></thead>
            <tbody>{liveStocks.map(item => {
              const market = data?.stocks.find(stock => stock.id === item.id);
              const status = market?.market === undefined ? undefined : MARKET_STATUSES[market.market];
              return <tr key={item.id} data-selected={selected === item.id}>
                <th scope="row">
                  <button className="app-market-select app-asset" type="button" aria-pressed={selected === item.id}
                    onClick={() => { setSelected(item.id); setAmount(""); }} disabled={busy}>
                    <TokenIcon symbol={item.id} size={28} /><span><strong>{item.id}</strong><small className="app-market-name">{item.name}</small></span>
                  </button>
                </th>
                <td>{market?.price === undefined ? "—" : `$${display(market.price, 8)}`}</td>
                <td>{status ? STATUS_LABEL[status] : "—"}</td>
                <td>{!market ? "—" : !market.limits ? "Gated" : data?.liquidity ? "Available" : "No USDT"}</td>
              </tr>;
            })}</tbody>
          </table>
          {address && data && <dl className="app-preview live-preview">
            <div><dt>Active collateral</dt><dd>{activeCollateral?.id ?? "None"}</dd></div>
            <div><dt>Supplied {selected}</dt><dd>{display(stock?.reserve[0])}</dd></div>
            <div><dt>Collateral value</dt><dd>{data.user ? `$${display(data.user[0], 8)}` : "Unavailable"}</dd></div>
            <div><dt>Health factor</dt><dd>{debt === 0n ? "—" : display(data.user?.[5])}</dd></div>
            <div><dt>Stock debt{stock?.limits ? " / cap" : ""}</dt><dd>{display(stock?.debt)}{stock?.limits && ` / ${display(stock.limits[1])}`} USDT</dd></div>
          </dl>}
        </section>

        <section className="app-market-panel live-controls" aria-labelledby="live-manage">
          <div className="app-section-heading"><h2 id="live-manage">Manage position</h2></div>
          <form className="live-form" onSubmit={submit}>
            <label>Action<select value={action} disabled={busy} onChange={event => {
              setAction(event.target.value as Action);
              setAmount("");
              setRepayAll(false);
            }}>{actions.map(item => <option key={item}>{item}</option>)}</select></label>
            {usesCollateral && <p>Selected stock <strong>{selected}</strong></p>}
            <label>Amount ({stockAction ? selected : "USDT"})
              <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount}
                disabled={busy || repayAll} onChange={event => setAmount(event.target.value)} />
            </label>
            {action === "Repay USDT" && <label className="live-checkbox">
              <input type="checkbox" checked={repayAll} disabled={busy} onChange={event => setRepayAll(event.target.checked)} /> Repay entire debt
            </label>}
            {address && <p>Wallet {display(walletAmount)} {stockAction ? selected : "USDT"}
              {(action === "Withdraw USDT" || action === "Withdraw stock") && ` · Supplied ${display(supplied)}`}
              {action === "Repay USDT" && ` · Debt ${display(debt)}`}
            </p>}
            {!address && <p>Connect your wallet using the header.</p>}
            {wrongChain && <button type="button" disabled={switching} onClick={() => switchChain({ chainId: bsc.id })}>Switch to BNB Smart Chain</button>}
            {switchError && <p role="alert">{errorMessage(switchError)}</p>}
            {borrowMessage && <p>{borrowMessage}</p>}
            {amount !== "" && parsed === undefined && !repayAll && <p role="alert">Enter a positive amount, using up to 18 decimal places.</p>}
            <button className="live-primary" type="submit" disabled={!usable || busy || !amountNeeded || !!borrowMessage}>{busy ? "Wallet action in progress" : action}</button>
            {stock && stock.reserve[0] > 0n && !stock.reserve[8] && (
              <button type="button" disabled={!usable || busy} onClick={() => void run(send => send(
                BLUE.pool, encodeFunctionData({ ...poolContract, functionName: "setUserUseReserveAsCollateral", args: [stock.address, true] }), `Enable ${selected} collateral`,
              ))}>Enable {selected} as collateral</button>
            )}
          </form>
          {(isKeeper || canSign) && <details className="live-operator">
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
        </section>
      </div>
      <p className="wrap live-footer">Hackathon deployment with prototype risk limits. <Link href="/app/simulator">Try the simulator</Link> for a pre-funded walkthrough.</p>
    </main>
  );
}
