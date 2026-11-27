// Turns the risk API's categories into what the keeper may do. It can only tighten: a stricter market status for a
// limited time, or a pause on new borrowing. Silence, errors and stale or simulated data all mean "no action".

/** How far to tighten, in increasing order. */
export const RiskLevel = { none: 0, closed: 1, weekend: 2, pause: 3 } as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

const CATEGORY_LEVEL: Record<string, RiskLevel> = {
  LOW: RiskLevel.none,
  MODERATE: RiskLevel.none,
  ELEVATED: RiskLevel.closed,
  HIGH: RiskLevel.weekend,
  CRITICAL: RiskLevel.pause,
};

/** MarketStatus values the calendar takes for a tightening level. */
export const LEVEL_STATUS: Partial<Record<RiskLevel, number>> = { [RiskLevel.closed]: 2, [RiskLevel.weekend]: 3 };

export interface RiskReading {
  aliases: string[];
  category: string;
  score: number | undefined;
  confidence: number | undefined;
  simulated: boolean;
  /** Evidence time, ms. */
  asOfMs: number;
}

/** Reads `/risk/overview`. Entries that are unavailable or malformed are dropped; only `simulated: false` counts as real. */
export function parseOverview(body: unknown): RiskReading[] {
  const assets = (body as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) throw new Error("risk overview has no assets list");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return assets.flatMap((a: Record<string, unknown> | null) => {
    if (!a || a.status !== "available" || typeof a.category !== "string" || !Array.isArray(a.aliases)) return [];
    const asOfMs = typeof a.as_of === "string" ? Date.parse(a.as_of) : Number.NaN;
    if (!Number.isFinite(asOfMs)) return [];
    return [
      {
        aliases: a.aliases.filter((x): x is string => typeof x === "string"),
        category: a.category,
        score: num(a.risk_score),
        confidence: num(a.confidence),
        simulated: a.simulated !== false,
        asOfMs,
      },
    ];
  });
}

export interface RiskPolicy {
  /** Consecutive readings that must all reach a level before the keeper acts on it. */
  confirmations: number;
  /** Older evidence is ignored, and so is a run of readings with a longer gap in it. */
  maxAgeMs: number;
  allowSimulated: boolean;
}

/** Clock difference tolerated between the API and this machine. */
const FUTURE_SKEW_MS = 60_000;

export class RiskTracker {
  private readonly runs = new Map<string, { asOfMs: number; level: RiskLevel }[]>();
  /** Assets whose pause has already been sent onchain. */
  readonly paused = new Set<string>();

  constructor(private readonly policy: RiskPolicy) {}

  /** Records a reading for `symbol`. Returns why it does not count, or undefined if it does. */
  add(symbol: string, r: RiskReading, nowMs: number): string | undefined {
    const reject = (why: string) => {
      this.runs.delete(symbol);
      return why;
    };
    if (r.simulated && !this.policy.allowSimulated) return reject("simulated data");
    if (nowMs - r.asOfMs > this.policy.maxAgeMs) return reject("stale evidence");
    if (r.asOfMs - nowMs > FUTURE_SKEW_MS) return reject("evidence dated in the future");
    const level = CATEGORY_LEVEL[r.category];
    if (level === undefined) return reject(`unknown category ${r.category}`);
    let run = this.runs.get(symbol) ?? [];
    const last = run[run.length - 1];
    // The same evidence served twice is one reading.
    if (last && r.asOfMs <= last.asOfMs) return undefined;
    if (last && r.asOfMs - last.asOfMs > this.policy.maxAgeMs) run = [];
    this.runs.set(symbol, [...run, { asOfMs: r.asOfMs, level }].slice(-this.policy.confirmations));
    return undefined;
  }

  /** The level every one of the last `confirmations` readings reached, if the newest is still fresh. */
  level(symbol: string, nowMs: number): RiskLevel {
    const run = this.runs.get(symbol);
    if (!run || run.length < this.policy.confirmations) return RiskLevel.none;
    if (nowMs - run[run.length - 1]!.asOfMs > this.policy.maxAgeMs) return RiskLevel.none;
    return Math.min(...run.map((x) => x.level)) as RiskLevel;
  }
}
