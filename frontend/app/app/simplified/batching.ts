"use client";

// Wallet batching support and shared formatting for leveraged borrowing.

import { useEffect } from "react";
import { useAccount, useCapabilities } from "wagmi";
import { bsc } from "wagmi/chains";

export type Batching = "checking" | "supported" | "unsupported" | "unavailable" | "wrong-chain";

export const times = (value: number | null) =>
  value === null ? "–" : Number.isFinite(value) ? `${value.toFixed(2)}×` : "No equity";

export function useBatching(): Batching {
  const { address, chainId } = useAccount();
  // Asked for every chain: a wallet may report nothing for BNB Chain, which is an answer rather than a failure.
  const caps = useCapabilities({ query: { retry: false, enabled: !!address } });
  const { refetch } = caps;
  useEffect(() => { if (address) void refetch(); }, [address, chainId, refetch]);
  if (caps.isPending) return "checking";
  if (caps.isError) return "unavailable";
  const raw = (caps.data as Record<number, { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } }>)[bsc.id];
  const supported = raw?.atomic?.status === "supported" || raw?.atomic?.status === "ready" || raw?.atomicBatch?.supported === true;
  if (!supported) return "unsupported";
  return chainId === bsc.id ? "supported" : "wrong-chain";
}

export const BATCHING_TEXT: Record<Batching, string> = {
  checking: "Checking your wallet…",
  supported: "Your wallet can batch calls atomically on BNB Chain.",
  unsupported: "Your wallet does not report atomic batching on BNB Chain.",
  unavailable: "Your wallet did not answer the batching check.",
  "wrong-chain": "Your wallet can batch calls, but it is not on BNB Chain.",
};
