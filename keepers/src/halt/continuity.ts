// Price-continuity check used to gate clearing. Metric: per-raw-token price = feedPrice * uiMultiplier,
// which is continuous across a correctly applied split (price/8 while multiplier*8).
import type { PublicClient } from "viem";
import { atlasFeedAbi, bStockAbi } from "../abi.js";
import type { AssetRef } from "./types.js";

export interface PricePoint {
  /** per-raw-token price in plain units */
  price: number;
  /** unix ms of the feed's last update */
  timestampMs: number;
}

export interface PriceReader {
  read(asset: AssetRef): Promise<PricePoint>;
}

export interface ContinuityContext {
  /** Wall-clock ms when the current latch began; the price print must be newer than this. */
  latchedSinceMs: number;
  nowMs: number;
}
export interface ContinuityResult {
  ok: boolean;
  detail: string;
}
export type ContinuityCheck = (asset: AssetRef, ctx: ContinuityContext) => Promise<ContinuityResult>;

export class PriceContinuity {
  private readonly ref = new Map<string, number>();
  constructor(
    private readonly reader: PriceReader,
    private readonly bandBps = 500,
    private readonly maxAgeMs = 15 * 60_000,
  ) {}

  /** Record the reference price. Call only while the asset is in a clean (not latched) state. */
  async observe(asset: AssetRef): Promise<void> {
    const p = await this.reader.read(asset);
    if (p.price > 0) this.ref.set(asset.token.toLowerCase(), p.price);
  }

  /** Operator escape hatch: accept the current price as the new reference (e.g. after a genuine post-halt gap). */
  async rebase(asset: AssetRef): Promise<void> {
    await this.observe(asset);
  }

  check: ContinuityCheck = async (asset, ctx) => {
    const ref = this.ref.get(asset.token.toLowerCase());
    if (ref === undefined) return { ok: false, detail: "no reference price recorded" };
    const p = await this.reader.read(asset);
    if (!(p.price > 0)) return { ok: false, detail: `non-positive price ${p.price}` };
    if (p.timestampMs <= ctx.latchedSinceMs) return { ok: false, detail: "no feed print since the latch began" };
    if (ctx.nowMs - p.timestampMs > this.maxAgeMs) return { ok: false, detail: `feed print stale (${Math.round((ctx.nowMs - p.timestampMs) / 1000)}s)` };
    const devBps = (Math.abs(p.price - ref) / ref) * 10_000;
    if (devBps > this.bandBps) return { ok: false, detail: `deviation ${devBps.toFixed(0)}bps > band ${this.bandBps}bps (ref ${ref}, now ${p.price})` };
    return { ok: true, detail: `deviation ${devBps.toFixed(0)}bps within ${this.bandBps}bps` };
  };
}

/** Atlas feed + uiMultiplier. ASSUMPTION (architecture 14.[U]): feed quotes per UI share, so raw = ui * m. */
export function viemPriceReader(
  client: PublicClient,
  feedFor: (a: AssetRef) => `0x${string}`,
  feedQuotesPerUi = true,
): PriceReader {
  return {
    async read(asset) {
      const feed = feedFor(asset);
      const [answer, ts, dec, m] = await Promise.all([
        client.readContract({ address: feed, abi: atlasFeedAbi, functionName: "latestAnswer" }),
        client.readContract({ address: feed, abi: atlasFeedAbi, functionName: "latestTimestamp" }),
        client.readContract({ address: feed, abi: atlasFeedAbi, functionName: "decimals" }),
        client.readContract({ address: asset.token, abi: bStockAbi, functionName: "uiMultiplier" }),
      ]);
      const ui = Number(answer) / 10 ** Number(dec);
      const price = feedQuotesPerUi ? (ui * Number(m)) / 1e18 : ui;
      return { price, timestampMs: Number(ts) * 1000 };
    },
  };
}
