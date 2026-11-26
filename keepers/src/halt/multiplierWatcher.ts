// On-chain UIMultiplierUpdated watcher. Polling getLogs (robust on public RPCs) behind a tiny reader interface.
import type { PublicClient } from "viem";
import { bStockAbi } from "../abi.js";
import { errMsg } from "./http.js";
import { corpAction, ok, unknown, type AssetRef, type HaltSource, type Signal } from "./types.js";

export interface MultiplierEvent {
  oldMultiplier: bigint;
  newMultiplier: bigint;
  /** unix seconds */
  effectiveAt: bigint;
  blockNumber: bigint;
}

export interface MultiplierReader {
  getBlockNumber(): Promise<bigint>;
  getEvents(token: `0x${string}`, fromBlock: bigint, toBlock: bigint): Promise<MultiplierEvent[]>;
  uiMultiplier(token: `0x${string}`): Promise<bigint>;
}

export function viemMultiplierReader(client: PublicClient): MultiplierReader {
  return {
    getBlockNumber: () => client.getBlockNumber(),
    async getEvents(token, fromBlock, toBlock) {
      const logs = await client.getContractEvents({ address: token, abi: bStockAbi, eventName: "UIMultiplierUpdated", fromBlock, toBlock });
      return logs.map((l) => ({
        oldMultiplier: l.args.oldMultiplier!,
        newMultiplier: l.args.newMultiplier!,
        effectiveAt: l.args.effectiveAt!,
        blockNumber: l.blockNumber,
      }));
    },
    uiMultiplier: (token) => client.readContract({ address: token, abi: bStockAbi, functionName: "uiMultiplier" }),
  };
}

export interface MultiplierWatcherOpts {
  /** On first poll, scan this many blocks back. */
  lookbackBlocks?: bigint;
  /** getLogs chunk size. */
  chunkBlocks?: bigint;
  /** Keep reporting corp_action this long after effectiveAt (continuity check still gates clearing). */
  holdAfterEffectiveMs?: number;
}

interface PerAsset {
  cursor: bigint | null;
  lastMultiplier: bigint | null;
  /** corp-action active until this wall-clock ms */
  activeUntil: number;
  detail: string;
}

export class MultiplierWatcherSource implements HaltSource {
  readonly name = "multiplier";
  private readonly st = new Map<string, PerAsset>();
  private readonly lookback: bigint;
  private readonly chunk: bigint;
  private readonly hold: number;

  constructor(private readonly reader: MultiplierReader, opts: MultiplierWatcherOpts = {}) {
    this.lookback = opts.lookbackBlocks ?? 20_000n;
    this.chunk = opts.chunkBlocks ?? 5_000n;
    this.hold = opts.holdAfterEffectiveMs ?? 60 * 60_000;
  }

  async check(asset: AssetRef, nowMs: number): Promise<Signal> {
    const key = asset.token.toLowerCase();
    const s = this.st.get(key) ?? { cursor: null, lastMultiplier: null, activeUntil: 0, detail: "" };
    this.st.set(key, s);
    try {
      const head = await this.reader.getBlockNumber();
      let from = s.cursor ?? (head > this.lookback ? head - this.lookback : 0n);
      while (from <= head) {
        const to = from + this.chunk - 1n > head ? head : from + this.chunk - 1n;
        for (const ev of await this.reader.getEvents(asset.token, from, to)) {
          // Event fires at schedule time; effectiveAt may be days ahead (or already past on a lookback).
          const until = Number(ev.effectiveAt) * 1000 + this.hold;
          if (until > s.activeUntil) {
            s.activeUntil = until;
            s.detail = `UIMultiplierUpdated ${ev.oldMultiplier}->${ev.newMultiplier} effectiveAt=${ev.effectiveAt} (block ${ev.blockNumber})`;
          }
        }
        from = to + 1n;
      }
      s.cursor = head + 1n;

      // Safety net for missed logs: effective multiplier changed since our last read.
      const m = await this.reader.uiMultiplier(asset.token);
      if (s.lastMultiplier !== null && m !== s.lastMultiplier) {
        s.activeUntil = Math.max(s.activeUntil, nowMs + this.hold);
        s.detail = `uiMultiplier() changed ${s.lastMultiplier}->${m}`;
      }
      s.lastMultiplier = m;
    } catch (e) {
      return unknown(`multiplier watcher failed: ${errMsg(e)}`);
    }
    return nowMs < s.activeUntil ? corpAction(s.detail) : ok(`no recent multiplier update (m=${s.lastMultiplier})`);
  }
}
