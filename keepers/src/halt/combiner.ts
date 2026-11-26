// Combines halt signals. Invariants (architecture §7):
//  - any non-ok signal can only push conservative (HALTED > CORP_ACTION > ok), latched
//  - clearing needs ALL sources ok (none unknown) AND a passing price-continuity check
//  - unknown never clears; unknown for >= timeout moves to HALTED
import type { ContinuityCheck } from "./continuity.js";
import type { AssetRef, HaltSource, Signal } from "./types.js";

export type CombinedState = "ok" | "halted" | "corp_action";

export interface Decision {
  state: CombinedState;
  reasons: string[];
  signals: Record<string, Signal>;
  /** true on the tick the latch was cleared */
  cleared: boolean;
  /** why clearing is blocked, when latched and every signal looks fine */
  clearBlockedBy?: string;
}

export interface CombinerOpts {
  sources: HaltSource[];
  continuity: ContinuityCheck;
  /** Unknown duration (per source) after which the asset goes HALTED. */
  unknownTimeoutMs: number;
  /** Optional per-source timeout overrides. */
  unknownTimeoutBySource?: Record<string, number>;
  now?: () => number;
}

interface AssetState {
  latched: CombinedState;
  latchedSince: number;
  unknownSince: Map<string, number>;
}

const rank = (s: CombinedState) => (s === "ok" ? 0 : s === "corp_action" ? 1 : 2);

export class HaltCombiner {
  private readonly st = new Map<string, AssetState>();
  private readonly now: () => number;

  constructor(private readonly o: CombinerOpts) {
    this.now = o.now ?? Date.now;
  }

  private get(asset: AssetRef): AssetState {
    const k = asset.token.toLowerCase();
    let s = this.st.get(k);
    if (!s) {
      s = { latched: "ok", latchedSince: 0, unknownSince: new Map() };
      this.st.set(k, s);
    }
    return s;
  }

  /** Restore a latch (e.g. from an on-chain override after a restart). Never clears. */
  seed(asset: AssetRef, state: Exclude<CombinedState, "ok">): void {
    const s = this.get(asset);
    if (rank(state) > rank(s.latched)) this.latch(s, state);
  }

  state(asset: AssetRef): CombinedState {
    return this.get(asset).latched;
  }

  private latch(s: AssetState, to: CombinedState) {
    if (s.latched === "ok") s.latchedSince = this.now();
    s.latched = to;
  }

  async evaluate(asset: AssetRef): Promise<Decision> {
    const s = this.get(asset);
    const now = this.now();
    const signals: Record<string, Signal> = {};
    await Promise.all(
      this.o.sources.map(async (src) => {
        try {
          signals[src.name] = await src.check(asset, now);
        } catch (e) {
          signals[src.name] = { state: "unknown", detail: `source threw: ${e instanceof Error ? e.message : String(e)}` };
        }
      }),
    );

    const reasons: string[] = [];
    let worst: CombinedState = "ok";
    let anyUnknown = false;
    let timedOutSource: string | undefined;
    for (const [name, sig] of Object.entries(signals)) {
      if (sig.state === "unknown") {
        anyUnknown = true;
        const since = s.unknownSince.get(name) ?? now;
        s.unknownSince.set(name, since);
        const limit = this.o.unknownTimeoutBySource?.[name] ?? this.o.unknownTimeoutMs;
        if (now - since >= limit) timedOutSource = timedOutSource ?? name;
      } else {
        s.unknownSince.delete(name);
        if (sig.state !== "ok" && rank(sig.state) > rank(worst)) worst = sig.state;
      }
      if (sig.state !== "ok") reasons.push(`${name}: ${sig.state} (${sig.detail})`);
    }

    // 1. conservative pushes
    if (worst !== "ok" && rank(worst) > rank(s.latched)) this.latch(s, worst);
    if (timedOutSource && s.latched !== "halted") {
      this.latch(s, "halted");
      reasons.push(`${timedOutSource} unknown beyond timeout -> halted`);
    }

    const base = { signals, reasons };
    if (s.latched === "ok") return { ...base, state: "ok", cleared: false };

    // 2. latched: can we clear?
    if (worst !== "ok") return { ...base, state: s.latched, cleared: false, clearBlockedBy: `active signal` };
    if (anyUnknown) return { ...base, state: s.latched, cleared: false, clearBlockedBy: "a source is unknown" };
    try {
      const c = await this.o.continuity(asset, { latchedSinceMs: s.latchedSince, nowMs: now });
      if (!c.ok) {
        return { ...base, state: s.latched, cleared: false, clearBlockedBy: `continuity: ${c.detail}` };
      }
    } catch (e) {
      return { ...base, state: s.latched, cleared: false, clearBlockedBy: `continuity threw: ${e instanceof Error ? e.message : String(e)}` };
    }
    s.latched = "ok";
    s.latchedSince = 0;
    return { ...base, state: "ok", cleared: true };
  }
}
