// Market status schedule for the landing-page explorer. Mirrors MarketCalendar.sol
// (US Eastern time) without holidays, early closes or halts, and uses the prototype
// borrowing discounts from protocol/script/BlueV3Deployment.sol.
//
// The borrowing discount lowers borrowing power only (and withdrawals while in debt).
// Health factor and liquidation always use the 62.5% liquidation threshold.

/** Scheduled market status. Lowercase values double as CSS class suffixes (band-open, pill-open). */
export type SessionStatus = "open" | "extended" | "closed" | "weekend";

export const BASE_LTV = 0.5;
export const LIQUIDATION_THRESHOLD = 0.625;

export const STATUS_LABEL: Record<SessionStatus, string> = {
  open: "Open",
  extended: "Extended",
  closed: "Closed",
  weekend: "Weekend",
};

export const STATUS_NOTE: Record<SessionStatus, string> = {
  open: "Regular US session. Full borrowing power: 50% borrow LTV.",
  extended: "Pre-market or after-hours. 4% borrowing discount: 48% borrow LTV.",
  closed: "Weekday overnight, including Sunday from 8pm. The token trades, the stock does not. 10% discount: 45% borrow LTV.",
  weekend: "Friday 8pm until Sunday 8pm, and exchange holidays. 15% discount: 42.5% borrow LTV.",
};

/** Borrowing discount per market status (fraction of base borrowing power). */
export const BORROWING_DISCOUNT: Record<SessionStatus, number> = {
  open: 0,
  extended: 0.04,
  closed: 0.1,
  weekend: 0.15,
};

export const borrowLtvFor = (status: SessionStatus) => BASE_LTV * (1 - BORROWING_DISCOUNT[status]);

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Steps of 30 minutes across a Monday-to-Sunday week, US Eastern time. */
export const STEPS_PER_DAY = 48;
export const WEEK_STEPS = STEPS_PER_DAY * 7;

/** Market status for a half-hour step (US Eastern), following MarketCalendar.sol without holidays. */
export function statusAt(step: number): SessionStatus {
  const day = Math.floor(step / STEPS_PER_DAY); // 0 = Mon
  const t = (step % STEPS_PER_DAY) / 2; // hour of day, 0..23.5
  if (day === 5) return "weekend"; // Saturday
  if (day === 6) return t < 20 ? "weekend" : "closed"; // Sunday: overnight session from 8pm
  if (t < 4) return "closed";
  if (t < 9.5) return "extended";
  if (t < 16) return "open";
  if (t < 20) return "extended";
  return day === 4 ? "weekend" : "closed"; // Friday evening starts the weekend
}

/** Borrowing discount at a step. Changes only at status boundaries, as on-chain. */
export function discountAt(step: number): number {
  return BORROWING_DISCOUNT[statusAt(step)];
}

export function formatStep(step: number): string {
  const day = DAYS[Math.floor(step / STEPS_PER_DAY)];
  const mins = (step % STEPS_PER_DAY) * 30;
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return `${day} ${hh}:${mm} ET`;
}
