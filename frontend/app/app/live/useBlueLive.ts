"use client";

// Live reads and wallet transactions shared by the Earn, Borrow, Simplified, Dashboard, Risk and /app pages.

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  BaseError, ContractFunctionRevertedError, decodeFunctionData, encodeFunctionData, getContractError, maxUint256,
  type Address, type Hex, type TransactionReceipt,
} from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { bsc } from "wagmi/chains";
import {
  BLUE, controlsContract, dataProviderContract, poolContract, priceSourceAbi, tokenContract,
  tokenErrorAbi,
} from "../../../src/lib/blue/mainnet";
import { routerContract } from "../../../src/lib/blue/swap";
import type { Call } from "../../../src/lib/blue/live-leverage";
import { readLiveState } from "../../../src/lib/blue/live-state";
import { usdtDebt, type LiveAction, type LiveState, type LiveStock } from "../../../src/lib/blue/live-position";

export const EXPLORER = bsc.blockExplorers.default.url;

export type TxStep = { label: string; hash: Hex };
export type Feedback = { message: string; error?: boolean; hash?: Hex };
export type TxResult = { ok: boolean; steps: TxStep[] };
export type Send = (to: Address, data: Hex, label: string) => Promise<TransactionReceipt>;

const transactionAbi = [
  ...poolContract.abi, ...controlsContract.abi, ...priceSourceAbi, ...tokenContract(BLUE.usdt).abi, ...routerContract.abi, ...tokenErrorAbi,
];

export function errorMessage(error: unknown) {
  if (error instanceof BaseError) {
    const revert = error.walk(cause => cause instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      switch (revert.data?.errorName) {
        case "OneStockRequired": return "Enable the stock you want to borrow against as collateral.";
        case "NewRiskBlocked": return "The stock’s keeper, price or hold checks are blocking this action.";
        case "Ineligible": return "Register eligibility for this wallet and stock.";
        case "StockDebtCapExceeded": return "This amount exceeds the stock’s remaining borrow cap.";
        case "AboveStockLtv": return "This would exceed the borrow limit for the current market status.";
        case "SupplyCapExceeded": return "This amount exceeds the supply cap.";
        case "BorrowCapExceeded": return "This amount exceeds the USDT borrow cap.";
        case "DebtCeilingExceeded": return "This amount exceeds the collateral’s debt ceiling.";
        case "HealthFactorLowerThanLiquidationThreshold": return "This would leave the position below the liquidation threshold.";
        case "CollateralCannotCoverNewBorrow": return "The collateral cannot cover this loan.";
        case "NotEnoughAvailableUserBalance": return "The amount exceeds your supplied balance.";
        case "ReservePaused": return "The reserve is paused.";
        case "ReserveFrozen": return "The reserve is frozen.";
        case "DiscontinuousPrice": return "The latest round is outside the accepted price band. The admin must review it.";
        case "UnusablePrice": return "The source has no usable price round.";
        case "ERC20InsufficientAllowance": return "The token approval does not cover this amount.";
        case "ERC20InsufficientBalance": return "Your wallet does not hold enough of this token.";
        case "InvalidEligibility": return "The eligibility signature has expired or its nonce changed.";
        default: return revert.shortMessage;
      }
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : "The operation failed.";
}

/** The pool and the connected wallet’s positions, refreshed every 20 seconds. */
export function useBlueState() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: bsc.id });
  return useQuery({
    queryKey: ["blue-mainnet", address],
    enabled: !!publicClient,
    queryFn: () => readLiveState(publicClient!, address),
    staleTime: 12_000,
    refetchInterval: 20_000,
  });
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Retries a read that can fail while a public RPC node catches up with a confirmed block. */
async function settled<T>(read: () => Promise<T>, attempts: number): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await pause(1_500);
    }
  }
}

/**
 * Wallet transactions on BNB Smart Chain. Every call is simulated before the wallet is asked to sign, and the
 * next call waits for a successful receipt. Confirmed steps stay in effect if a later step fails.
 */
export function useBlueTransactions(refetch: () => Promise<unknown>) {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: bsc.id });
  const wallet = useWalletClient({ chainId: bsc.id }).data;
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const busyRef = useRef(false);
  const ready = !!address && !!wallet && !!publicClient && chainId === bsc.id;

  async function run(task: (send: Send, account: Address) => Promise<void>): Promise<TxResult> {
    const steps: TxStep[] = [];
    if (!address || !wallet || !publicClient || !ready || busyRef.current) return { ok: false, steps };
    const account = address;
    busyRef.current = true;
    setBusy(true);
    setFeedback(undefined);
    let lastHash: Hex | undefined;
    let lastConfirmed = false;
    let ok = false;
    try {
      await task(async (to, data, label) => {
        setFeedback({ message: `Checking ${label}…`, hash: lastHash });
        try {
          await settled(() => publicClient.call({ account, to, data }), steps.length ? 4 : 1);
        } catch (error) {
          if (error instanceof BaseError) {
            const { functionName, args } = decodeFunctionData({ abi: transactionAbi, data });
            throw getContractError(error, { abi: transactionAbi, address: to, sender: account, functionName, args });
          }
          throw error;
        }
        setFeedback({ message: `Approve ${label} in your wallet.`, hash: lastHash });
        lastHash = await wallet.sendTransaction({ account, to, data, chain: bsc });
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
        steps.push({ label, hash: receipt.transactionHash });
        setFeedback({ message: `${label} confirmed.`, hash: receipt.transactionHash });
        return receipt;
      }, account);
      ok = true;
    } catch (error) {
      const reason = lastHash && !lastConfirmed
        ? "The transaction was submitted. Check its status on BscScan before retrying."
        : errorMessage(error);
      const done = steps.length ? ` Already confirmed and still in effect: ${steps.map(step => step.label).join(", ")}.` : "";
      setFeedback({ message: reason + done, error: true, hash: lastHash });
    } finally {
      try {
        await refetch();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    }
    return { ok, steps };
  }

  async function approve(send: Send, account: Address, token: Address, symbol: string, amount: bigint) {
    const contract = tokenContract(token);
    const [balance, allowance] = await Promise.all([
      publicClient!.readContract({ ...contract, functionName: "balanceOf", args: [account] }),
      publicClient!.readContract({ ...contract, functionName: "allowance", args: [account, BLUE.pool] }),
    ]);
    if (amount > balance) throw new Error(`Your wallet does not have enough ${symbol}.`);
    if (allowance < amount) {
      await send(token, encodeFunctionData({ ...contract, functionName: "approve", args: [BLUE.pool, amount] }), `${symbol} approval`);
    }
  }

  const enableCall = (send: Send, stock: LiveStock) => send(BLUE.pool, encodeFunctionData({
    ...poolContract, functionName: "setUserUseReserveAsCollateral", args: [stock.address, true],
  }), `Enable ${stock.id} collateral`);

  /** Approves and supplies a stock, then enables it as collateral when the pool has not done so. */
  async function supplyStock(send: Send, account: Address, stock: LiveStock, amount: bigint) {
    await approve(send, account, stock.address, stock.id, amount);
    const receipt = await send(BLUE.pool, encodeFunctionData({
      ...poolContract, functionName: "supply", args: [stock.address, amount, account, 0],
    }), `Supply ${stock.id}`);
    if (stock.reserve[8]) return;
    const reserve = await settled(() => publicClient!.readContract({
      ...dataProviderContract, functionName: "getUserReserveData", args: [stock.address, account],
      blockNumber: receipt.blockNumber,
    }), 4);
    if (!reserve[8]) await enableCall(send, stock);
  }

  const borrowCall = (send: Send, account: Address, amount: bigint) => send(BLUE.pool, encodeFunctionData({
    ...poolContract, functionName: "borrow", args: [BLUE.usdt, amount, 2n, 0, account],
  }), "Borrow USDT");

  function execute(state: LiveState, action: LiveAction, stock: LiveStock, amount: bigint) {
    return run(async (send, account) => {
      if (state.account !== account) throw new Error("The connected account changed. Review the amounts again.");
      switch (action) {
        case "lend":
          await approve(send, account, BLUE.usdt, "USDT", amount);
          await send(BLUE.pool, encodeFunctionData({ ...poolContract, functionName: "supply", args: [BLUE.usdt, amount, account, 0] }), "Supply USDT");
          return;
        case "redeem": {
          const supplied = state.usdt.reserve[0];
          const all = amount >= supplied && state.liquidity >= supplied;
          await send(BLUE.pool, encodeFunctionData({
            ...poolContract, functionName: "withdraw", args: [BLUE.usdt, all ? maxUint256 : amount, account],
          }), "Withdraw USDT");
          return;
        }
        case "deposit":
          await supplyStock(send, account, stock, amount);
          return;
        case "withdraw": {
          const all = usdtDebt(state) === 0n && amount >= stock.reserve[0];
          await send(BLUE.pool, encodeFunctionData({
            ...poolContract, functionName: "withdraw", args: [stock.address, all ? maxUint256 : amount, account],
          }), `Withdraw ${stock.id}`);
          return;
        }
        case "borrow":
          await borrowCall(send, account, amount);
          return;
        case "repay": {
          const [balance, reserve] = await Promise.all([
            publicClient!.readContract({ ...tokenContract(BLUE.usdt), functionName: "balanceOf", args: [account] }),
            publicClient!.readContract({ ...dataProviderContract, functionName: "getUserReserveData", args: [BLUE.usdt, account] }),
          ]);
          const debt = reserve[2];
          // A full repayment approves a small interest buffer, bounded by the wallet balance.
          const full = amount >= usdtDebt(state) && balance >= debt + debt / 10_000n;
          const buffered = debt + debt / 100n + 1n;
          await approve(send, account, BLUE.usdt, "USDT", full ? (balance < buffered ? balance : buffered) : amount);
          await send(BLUE.pool, encodeFunctionData({
            ...poolContract, functionName: "repay", args: [BLUE.usdt, full ? maxUint256 : amount, 2n, account],
          }), "Repay USDT");
        }
      }
    });
  }

  /** The guided borrow: optionally supply collateral, make sure it is enabled, then borrow. */
  function supplyAndBorrow(state: LiveState, stock: LiveStock, collateral: bigint, amount: bigint) {
    return run(async (send, account) => {
      if (state.account !== account) throw new Error("The connected account changed. Review the amounts again.");
      if (collateral > 0n) await supplyStock(send, account, stock, collateral);
      else if (!stock.reserve[8]) await enableCall(send, stock);
      await borrowCall(send, account, amount);
    });
  }

  const enableCollateral = (stock: LiveStock) => run(async send => { await enableCall(send, stock); });

  /** Asks the eligibility service for a signature, then registers it from the borrower’s wallet. */
  function requestEligibility(stock: LiveStock) {
    return run(async (send, account) => {
      setFeedback({ message: "Requesting eligibility for this wallet and stock…" });
      const response = await fetch("/api/blue/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, stock: stock.address }),
        signal: AbortSignal.timeout(18_000),
      });
      const signed = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(signed?.error ?? "Eligibility is temporarily unavailable.");
      if (typeof signed?.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signed.signature) ||
          typeof signed.expiry !== "string" || !/^\d{1,16}$/.test(signed.expiry)) {
        throw new Error("The signer returned an invalid response.");
      }
      await send(BLUE.controls, encodeFunctionData({
        ...controlsContract, functionName: "registerEligibility",
        args: [stock.address, BigInt(signed.expiry), signed.signature as Hex],
      }), "Register eligibility");
    });
  }

  /**
   * Sends calls as one atomic EIP-5792 batch from the connected account: all of them take effect, or none.
   * The whole sequence is simulated first, so a call that would revert never reaches the wallet.
   */
  async function sendBatch(calls: Call[]): Promise<TxResult> {
    const steps: TxStep[] = [];
    if (!address || !wallet || !publicClient || !ready || busyRef.current) return { ok: false, steps };
    const account = address;
    busyRef.current = true;
    setBusy(true);
    let submitted = false;
    let settledOnchain = false;
    let ok = false;
    try {
      setFeedback({ message: "Simulating the whole batch…" });
      const [block] = await publicClient.simulateBlocks({
        blocks: [{ calls: calls.map(({ to, data }) => ({ account, to, data })) }],
      });
      const failed = block.calls.findIndex(call => call.status !== "success");
      if (failed >= 0) {
        const revert = new ContractFunctionRevertedError({ abi: transactionAbi, data: block.calls[failed].data, functionName: calls[failed].label });
        throw new Error(`The simulation failed at “${calls[failed].label}”, so nothing was sent. ${errorMessage(revert)}`);
      }
      setFeedback({ message: `Approve the batch of ${calls.length} calls in your wallet.` });
      const { id } = await wallet.sendCalls({
        account, chain: bsc, forceAtomic: true, calls: calls.map(({ to, data }) => ({ to, data })),
      });
      submitted = true;
      setFeedback({ message: "Waiting for the batch to confirm…" });
      const result = await wallet.waitForCallsStatus({ id, timeout: 120_000 });
      settledOnchain = result.status !== "pending";
      for (const receipt of result.receipts ?? []) steps.push({ label: "Batch", hash: receipt.transactionHash });
      if (result.status !== "success" || result.receipts?.some(receipt => receipt.status !== "success")) {
        throw new Error("The batch reverted, so your position is unchanged.");
      }
      ok = true;
      setFeedback({ message: "Batch confirmed.", hash: steps.at(-1)?.hash });
    } catch (error) {
      const reason = submitted && !settledOnchain
        ? "The batch was submitted. Check your wallet’s activity before trying again."
        : errorMessage(error);
      setFeedback({ message: reason, error: true, hash: steps.at(-1)?.hash });
    } finally {
      try {
        await refetch();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    }
    return { ok, steps };
  }

  const clearFeedback = () => { if (!busyRef.current) setFeedback(undefined); };

  return { ready, busy, feedback, setFeedback, clearFeedback, run, sendBatch, execute, supplyAndBorrow, enableCollateral, requestEligibility };
}
