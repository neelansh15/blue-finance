"use client";

import { useModal } from "connectkit";
import type { ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { bsc } from "wagmi/chains";
import { EXPLORER, errorMessage, type Feedback } from "./useBlueLive";

export function TxFeedback({ feedback }: { feedback: Feedback | undefined }) {
  return (
    <p className="app-feedback" role={feedback?.error ? "alert" : "status"} style={{ overflowWrap: "anywhere" }}>
      {feedback && <>{feedback.message} {feedback.hash && (
        <a href={`${EXPLORER}/tx/${feedback.hash}`} target="_blank" rel="noopener noreferrer">View on BscScan</a>
      )}</>}
    </p>
  );
}

/** Renders the action once a wallet is connected on BNB Smart Chain, and the way to get there until then. */
export function WalletAction({ children, className = "btn app-submit" }: { children: ReactNode; className?: string }) {
  const { isConnected, isConnecting, isReconnecting, chainId } = useAccount();
  const { setOpen } = useModal();
  const { switchChain, isPending, error } = useSwitchChain();
  if (!isConnected) {
    return <button className={className} type="button" disabled={isConnecting || isReconnecting} onClick={() => setOpen(true)}>
      {isConnecting || isReconnecting ? "Connecting…" : "Connect wallet"}
    </button>;
  }
  if (chainId !== bsc.id) {
    return <>
      <button className={className} type="button" disabled={isPending} onClick={() => switchChain({ chainId: bsc.id })}>
        Switch to BNB Smart Chain
      </button>
      {error && <p className="app-message" role="alert">{errorMessage(error)}</p>}
    </>;
  }
  return <>{children}</>;
}

/** Loading and failure state for the onchain reads. */
export function ReadStatus({ query }: { query: { isPending: boolean; isError: boolean; refetch: () => unknown } }) {
  if (query.isError) {
    return <p className="app-message" role="alert">Pool data could not be refreshed.{" "}
      <button type="button" className="btn btn-quiet" onClick={() => void query.refetch()}>Retry</button></p>;
  }
  return query.isPending ? <p role="status">Loading the pool from BNB Smart Chain…</p> : null;
}
