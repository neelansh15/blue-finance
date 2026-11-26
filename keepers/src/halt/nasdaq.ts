// Nasdaq Trader trade-halt RSS. Terms forbid polling more than once per minute: enforced here.
import { XMLParser } from "fast-xml-parser";
import { errMsg, fetchText, defaultFetch } from "./http.js";
import { halted, ok, unknown, type AssetRef, type FetchLike, type HaltSource, type Signal } from "./types.js";

export const NASDAQ_HALT_URL = "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts";

export interface NasdaqHalt {
  symbol: string;
  haltDate: string; // MM/DD/YYYY
  haltTime: string;
  reasonCode: string;
  market: string;
  resumptionDate: string;
  resumptionQuoteTime: string;
  resumptionTradeTime: string;
}

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v).trim());

/** Tolerant parse: strips BOM, ignores namespaces, a single <item> or none, missing fields. Throws if not RSS at all. */
export function parseNasdaqHalts(xml: string): NasdaqHalt[] {
  const clean = xml.replace(/^﻿/, "").trim();
  if (!/<rss[\s>]|<channel[\s>]/i.test(clean)) throw new Error("not an RSS document");
  const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => name === "item",
  });
  const doc = parser.parse(clean) as { rss?: { channel?: { item?: Record<string, unknown>[] } } };
  const items = doc.rss?.channel?.item ?? [];
  const out: NasdaqHalt[] = [];
  for (const it of items) {
    const symbol = str(it.IssueSymbol) || str(it.title);
    if (!symbol) continue;
    out.push({
      symbol: symbol.toUpperCase(),
      haltDate: str(it.HaltDate),
      haltTime: str(it.HaltTime),
      reasonCode: str(it.ReasonCode),
      market: str(it.Market),
      resumptionDate: str(it.ResumptionDate),
      resumptionQuoteTime: str(it.ResumptionQuoteTime),
      resumptionTradeTime: str(it.ResumptionTradeTime),
    });
  }
  return out;
}

/** Sortable key from MM/DD/YYYY + HH:MM:SS(.mmm) */
function haltKey(h: NasdaqHalt): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(h.haltDate);
  const d = m ? `${m[3]}${m[1]!.padStart(2, "0")}${m[2]!.padStart(2, "0")}` : "00000000";
  return `${d}${h.haltTime}`;
}

/** Decide the state for one ticker from parsed items. Latest halt entry wins; resumption trade time set => resumed. */
const easternClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function hasResumed(halt: NasdaqHalt, nowMs: number): boolean {
  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(halt.resumptionDate);
  const time = /^(\d{1,2}):(\d{2}):(\d{2})(\.\d+)?$/.exec(halt.resumptionTradeTime);
  if (!date || !time) return false;
  const parts = Object.fromEntries(easternClock.formatToParts(nowMs).map(part => [part.type, part.value]));
  const current = `${parts.year}${parts.month}${parts.day}${parts.hour}:${parts.minute}:${parts.second}`;
  const resumes = `${date[3]}${date[1]!.padStart(2, "0")}${date[2]!.padStart(2, "0")}${time[1]!.padStart(2, "0")}:${time[2]}:${time[3]}`;
  return current > resumes || (current === resumes && nowMs % 1000 >= Number(time[4] ?? 0) * 1_000);
}

export function nasdaqSignalFor(items: NasdaqHalt[], ticker: string, nowMs = Date.now()): Signal {
  const mine = items.filter((i) => i.symbol === ticker.toUpperCase()).sort((a, b) => haltKey(a).localeCompare(haltKey(b)));
  const last = mine[mine.length - 1];
  if (!last) return ok("no halt entry on Nasdaq feed");
  if (hasResumed(last, nowMs)) {
    return ok(`resumed ${last.resumptionDate} ${last.resumptionTradeTime} (halt ${last.reasonCode} ${last.haltDate} ${last.haltTime})`);
  }
  return halted(`Nasdaq halt ${last.reasonCode} since ${last.haltDate} ${last.haltTime}, trading has not resumed`);
}

export class NasdaqHaltSource implements HaltSource {
  readonly name = "nasdaq";
  private cache: { at: number; items: NasdaqHalt[] | null; error?: string } | null = null;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly fetchFn: FetchLike = defaultFetch,
    private readonly minIntervalMs = 60_000,
    private readonly url = NASDAQ_HALT_URL,
  ) {}

  /** Refresh at most once per minIntervalMs (failures count too, so we never hammer). */
  private async refresh(nowMs: number): Promise<void> {
    if (this.cache && nowMs - this.cache.at < this.minIntervalMs) return;
    if (!this.inflight) {
      this.inflight = (async () => {
        try {
          const xml = await fetchText(this.fetchFn, this.url);
          this.cache = { at: nowMs, items: parseNasdaqHalts(xml) };
        } catch (e) {
          this.cache = { at: nowMs, items: null, error: errMsg(e) };
        } finally {
          this.inflight = null;
        }
      })();
    }
    await this.inflight;
  }

  async check(asset: AssetRef, nowMs: number): Promise<Signal> {
    await this.refresh(nowMs);
    const c = this.cache!;
    if (!c.items) return unknown(`Nasdaq RSS fetch failed: ${c.error}`);
    return nasdaqSignalFor(c.items, asset.ticker, nowMs);
  }

  /** Whole feed, for the smoke test. */
  async items(nowMs: number): Promise<NasdaqHalt[] | null> {
    await this.refresh(nowMs);
    return this.cache!.items;
  }
}
