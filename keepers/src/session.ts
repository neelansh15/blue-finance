// US equity session regime from a timestamp. Pure; uses Intl for America/New_York (handles DST).
import type { RegimeName } from "./abi.js";

export type CalendarRegime = Extract<RegimeName, "OPEN" | "EXTENDED" | "CLOSED" | "WEEKEND">;

/** Full-day US market holidays (NYSE/Nasdaq), yyyy-mm-dd in ET. WEEKEND until 20:00 ET, then see sessionRegime. */
export const HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** Early-close days: regular session ends 13:00 ET. */
export const EARLY_CLOSES: ReadonlySet<string> = new Set([
  "2026-11-27", "2026-12-24",
  "2027-11-26",
]);

/** Minutes after midnight ET. */
const PRE_OPEN = 4 * 60;
const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;
const POST_END = 20 * 60;
const EARLY_CLOSE = 13 * 60;
// Early-close days: post-market 13:00-17:00 (matches INTERFACES.md Changes).
const EARLY_POST_END = 17 * 60;

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

export interface EtParts {
  date: string; // yyyy-mm-dd
  minutes: number; // minutes since 00:00 ET
  weekday: number; // 0=Sun..6=Sat
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function etParts(ts: Date | number): EtParts {
  const d = typeof ts === "number" ? new Date(ts) : ts;
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: hour * 60 + Number(p.minute),
    weekday: WD[p.weekday!]!,
  };
}

export interface SessionTables {
  holidays: ReadonlySet<string>;
  earlyCloses: ReadonlySet<string>;
}
const DEFAULT_TABLES: SessionTables = { holidays: HOLIDAYS, earlyCloses: EARLY_CLOSES };

const nextDate = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** Mirror of RegimeRegistry.calendarRegimeAt (protocol-old/src/RegimeRegistry.sol):
 *  Sat WEEKEND; Sun WEEKEND until 20:00, then CLOSED (WEEKEND if Monday is a holiday); holiday WEEKEND until 20:00;
 *  weekday 00:00-04:00 CLOSED, 04:00-09:30 EXTENDED, 09:30-16:00 OPEN, 16:00-20:00 EXTENDED (early close: 13:00 / 17:00);
 *  after postEnd (and after a holiday's 20:00): WEEKEND if Friday or the next day is a holiday, else CLOSED.
 *  Timestamp in ms or Date (UTC instant). */
export function sessionRegime(ts: Date | number, tables: SessionTables = DEFAULT_TABLES): CalendarRegime {
  const { date, minutes: m, weekday: wd } = etParts(ts);
  const overnightAfter = (): CalendarRegime => (wd === 5 || tables.holidays.has(nextDate(date)) ? "WEEKEND" : "CLOSED");
  if (wd === 6) return "WEEKEND";
  if (wd === 0) {
    if (m < POST_END) return "WEEKEND";
    return tables.holidays.has(nextDate(date)) ? "WEEKEND" : "CLOSED";
  }
  if (tables.holidays.has(date)) return m < POST_END ? "WEEKEND" : overnightAfter();
  const early = tables.earlyCloses.has(date);
  const close = early ? EARLY_CLOSE : CLOSE;
  const postEnd = early ? EARLY_POST_END : POST_END;
  if (m < PRE_OPEN) return "CLOSED";
  if (m < OPEN) return "EXTENDED";
  if (m < close) return "OPEN";
  if (m < postEnd) return "EXTENDED";
  return overnightAfter();
}
