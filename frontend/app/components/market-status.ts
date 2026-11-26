// Illustrative regime model used by the landing-page mock UI.
// None of these haircuts are protocol parameters. Real values would come from
// the gap-quantile pipeline described in architecture-v1.md, section 11.

export type Regime = "open" | "extended" | "closed" | "weekend";

export const REGIME_LABEL: Record<Regime, string> = {
  open: "Open",
  extended: "Extended",
  closed: "Closed",
  weekend: "Weekend",
};

export const REGIME_NOTE: Record<Regime, string> = {
  open: "Regular US session. Full borrowing power.",
  extended: "Pre-market or after-hours. Thinner primary price discovery, small haircut.",
  closed: "Overnight. The token still trades, the stock does not. Larger haircut.",
  weekend: "No primary market until Monday pre-market. Largest routine haircut.",
};

/** Illustrative haircut per regime (fraction of collateral value). */
export const ILLUSTRATIVE_HAIRCUT: Record<Regime, number> = {
  open: 0,
  extended: 0.04,
  closed: 0.1,
  weekend: 0.15,
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Steps of 30 minutes across a Monday-to-Sunday week, US Eastern time. */
export const STEPS_PER_DAY = 48;
export const WEEK_STEPS = STEPS_PER_DAY * 7;

/** Regime for a half-hour step (US Eastern), simplified: no holidays or halts. */
export function regimeAt(step: number): Regime {
  const day = Math.floor(step / STEPS_PER_DAY); // 0 = Mon
  const t = (step % STEPS_PER_DAY) / 2; // hour of day, 0..23.5
  const weekday = day <= 4;
  if (!weekday) return "weekend";
  if (day === 4 && t >= 20) return "weekend"; // Friday evening onward
  if (day === 0 && t < 4) return "weekend"; // until Monday pre-market
  if (t >= 9.5 && t < 16) return "open";
  if ((t >= 4 && t < 9.5) || (t >= 16 && t < 20)) return "extended";
  return "closed";
}

/**
 * Illustrative haircut at a step. The haircut ramps in during the last
 * 30 minutes of the regular session instead of stepping at the close.
 */
export function haircutAt(step: number): number {
  const r = regimeAt(step);
  const t = (step % STEPS_PER_DAY) / 2;
  if (r === "open" && t >= 15.5) return ILLUSTRATIVE_HAIRCUT.extended / 2;
  return ILLUSTRATIVE_HAIRCUT[r];
}

export function formatStep(step: number): string {
  const day = DAYS[Math.floor(step / STEPS_PER_DAY)];
  const mins = (step % STEPS_PER_DAY) * 30;
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return `${day} ${hh}:${mm} ET`;
}
