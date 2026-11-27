import { describe, expect, it } from "vitest";
import { ASSETS, DEFAULT_KEEPER, combine, loadBlueConfig, planStock, planTighten, pollRisk, tick, type Call, type Chain, type Deps, type PlanInput } from "../src/blueKeeper.js";
import { RiskLevel, RiskTracker, parseOverview, type RiskReading } from "../src/riskPolicy.js";
import type { Signal } from "../src/halt/types.js";

const sig = (state: Signal["state"]): Signal => ({ state, detail: "" });
const input = (o: Partial<PlanInput> = {}): PlanInput => ({
  health: "ok",
  state: { status: 0, override: { state: 0, expiry: 0 } },
  pricesReady: true,
  lastReportS: undefined,
  nowS: 10_000,
  reportIntervalS: 300,
  overrideDurationS: 3600,
  overrideMarginS: 600,
  ...o,
});

describe("combine", () => {
  it("lets a halt or corporate action win and never treats unknown as ok", () => {
    expect(combine([sig("ok"), sig("ok")])).toBe("ok");
    expect(combine([sig("unknown"), sig("halted")])).toBe("halted");
    expect(combine([sig("ok"), sig("corp_action")])).toBe("halted");
    expect(combine([sig("ok"), sig("unknown")])).toBe("unknown");
    expect(combine([])).toBe("unknown");
  });
});

describe("planStock", () => {
  it("reports on the first tick and then once per interval", () => {
    expect(planStock(input())).toEqual({ kind: "report" });
    expect(planStock(input({ lastReportS: 9_800 }))).toBeNull();
    expect(planStock(input({ lastReportS: 9_700 }))).toEqual({ kind: "report" });
  });
  it("withholds the heartbeat when it cannot vouch for the stock", () => {
    expect(planStock(input({ health: "unknown" }))?.kind).toBe("skip");
    expect(planStock(input({ pricesReady: false }))?.kind).toBe("skip");
    expect(planStock(input({ state: { status: 4, override: { state: 4, expiry: 20_000 } } }))?.kind).toBe("skip");
  });
  it("sets a halt and renews it only near expiry", () => {
    expect(planStock(input({ health: "halted" }))).toEqual({ kind: "halt", durationS: 3600 });
    expect(planStock(input({ health: "halted", state: { status: 4, override: { state: 4, expiry: 12_000 } } }))).toBeNull();
    expect(planStock(input({ health: "halted", state: { status: 4, override: { state: 4, expiry: 10_500 } } }))?.kind).toBe("halt");
  });
});

describe("loadBlueConfig", () => {
  it("defaults to a dry run with the chosen keeper wallet", () => {
    expect(loadBlueConfig({})).toMatchObject({ dryRun: true, keeper: DEFAULT_KEEPER, riskApiUrl: undefined });
    expect(loadBlueConfig({ DRY_RUN: "yes" }).dryRun).toBe(true);
  });
  it("refuses live mode without a key and a heartbeat that could lapse", () => {
    expect(() => loadBlueConfig({ DRY_RUN: "false" })).toThrow(/KEEPER_PRIVATE_KEY/);
    expect(() => loadBlueConfig({ REPORT_INTERVAL_S: "590" })).toThrow(/heartbeat/);
  });
});

function harness(o: { dryRun?: boolean; missing?: string[]; signal?: Signal["state"]; refuse?: string } = {}) {
  const sent: Call[] = [];
  const events: string[] = [];
  const usable = new Set<string>();
  const chain: Chain = {
    stockState: async () => ({ status: 0, override: { state: 0, expiry: 0 } }),
    usable: async (s) => usable.has(s),
    missingRoles: async () => o.missing ?? [],
    simulate: async (c) => {
      if (c.functionName === o.refuse) throw new Error("refused");
    },
    send: async (c) => {
      sent.push(c);
      if (c.functionName === "refresh") usable.add(c.address);
      return "0xhash";
    },
    roleHolder: async () => DEFAULT_KEEPER,
  };
  const deps: Deps = {
    cfg: { ...loadBlueConfig({}), dryRun: o.dryRun ?? false },
    chain,
    sources: [{ name: "fake", check: async () => sig(o.signal ?? "ok") }],
    assets: ASSETS.slice(0, 1),
    lastReport: new Map(),
    log: (e) => events.push(e),
    nowMs: () => 10_000_000,
  };
  return { deps, sent, events };
}

describe("tick", () => {
  it("refreshes both prices and then reports", async () => {
    const h = harness();
    await tick(h.deps);
    expect(h.sent.map((c) => c.functionName)).toEqual(["refresh", "refresh", "report"]);
  });
  it("sends nothing in a dry run", async () => {
    const h = harness({ dryRun: true });
    await tick(h.deps);
    expect(h.sent).toEqual([]);
    expect(h.events.filter((e) => e === "dry_run_tx")).toHaveLength(3);
  });
  it("sends nothing live until the wallet holds every role", async () => {
    const h = harness({ missing: ["controls.keeper"] });
    await tick(h.deps);
    expect(h.sent).toEqual([]);
  });
  it("halts with HALTED only, and falls back to an unhealthy report", async () => {
    const h = harness({ signal: "corp_action" });
    await tick(h.deps);
    expect(h.sent.at(-1)).toMatchObject({ functionName: "setOverride", args: [ASSETS[0]!.token, 4, 3600n] });
    const refused = harness({ signal: "halted", refuse: "setOverride" });
    await tick(refused.deps);
    expect(refused.sent.at(-1)).toMatchObject({ functionName: "report", args: [ASSETS[0]!.token, false] });
  });
});

const NOW = 10_000_000;
const reading = (category: string, o: Partial<RiskReading> = {}): RiskReading => ({
  aliases: ["TSLAB"],
  category,
  score: 50,
  confidence: 0.9,
  simulated: false,
  asOfMs: NOW,
  ...o,
});
const tracker = (confirmations = 3, allowSimulated = false) => new RiskTracker({ confirmations, maxAgeMs: 900_000, allowSimulated });
const feed = (t: RiskTracker, ...categories: string[]) =>
  categories.forEach((c, i) => t.add("TSLAB", reading(c, { asOfMs: NOW - (categories.length - 1 - i) * 1000 }), NOW));

describe("RiskTracker", () => {
  it("acts only on the level that every recent reading reached", () => {
    const t = tracker();
    feed(t, "CRITICAL", "CRITICAL");
    expect(t.level("TSLAB", NOW)).toBe(RiskLevel.none);
    const mixed = tracker();
    feed(mixed, "CRITICAL", "ELEVATED", "HIGH");
    expect(mixed.level("TSLAB", NOW)).toBe(RiskLevel.closed);
    const calm = tracker();
    feed(calm, "HIGH", "HIGH", "HIGH", "MODERATE");
    expect(calm.level("TSLAB", NOW)).toBe(RiskLevel.none);
  });
  it("counts repeated evidence once", () => {
    const t = tracker(2);
    t.add("TSLAB", reading("HIGH"), NOW);
    t.add("TSLAB", reading("HIGH"), NOW);
    expect(t.level("TSLAB", NOW)).toBe(RiskLevel.none);
  });
  it("ignores simulated, stale, future and unknown readings, and forgets old ones", () => {
    const t = tracker(1);
    expect(t.add("TSLAB", reading("HIGH", { simulated: true }), NOW)).toBe("simulated data");
    expect(t.add("TSLAB", reading("HIGH", { asOfMs: NOW - 901_000 }), NOW)).toBe("stale evidence");
    expect(t.add("TSLAB", reading("HIGH", { asOfMs: NOW + 120_000 }), NOW)).toMatch(/future/);
    expect(t.add("TSLAB", reading("SEVERE"), NOW)).toMatch(/unknown category/);
    expect(t.level("TSLAB", NOW)).toBe(RiskLevel.none);
    t.add("TSLAB", reading("HIGH"), NOW);
    expect(t.level("TSLAB", NOW)).toBe(RiskLevel.weekend);
    expect(t.level("TSLAB", NOW + 901_000)).toBe(RiskLevel.none);
  });
});

describe("parseOverview", () => {
  const row = { status: "available", category: "HIGH", aliases: ["TSLAB"], as_of: "2026-11-27T00:00:00+00:00", simulated: false };
  it("treats anything but simulated: false as simulated and drops unusable rows", () => {
    const out = parseOverview({ assets: [row, { ...row, simulated: undefined }, { ...row, status: "unavailable" }, { ...row, as_of: "x" }, null] });
    expect(out.map((r) => r.simulated)).toEqual([false, true]);
    expect(() => parseOverview({})).toThrow(/assets/);
  });
});

describe("planTighten", () => {
  const risky = (o: Partial<PlanInput> = {}) => planTighten(input({ risk: RiskLevel.weekend, ...o }));
  it("sets a stricter status only when nothing already covers it", () => {
    expect(risky()).toEqual({ status: 3, durationS: 3600 });
    expect(risky({ state: { status: 3, override: { state: 0, expiry: 0 } } })).toBeNull();
    expect(risky({ state: { status: 3, override: { state: 3, expiry: 12_000 } } })).toBeNull();
    expect(risky({ state: { status: 3, override: { state: 3, expiry: 10_500 } } })).toEqual({ status: 3, durationS: 3600 });
    expect(risky({ health: "halted" })).toBeNull();
    expect(planTighten(input())).toBeNull();
  });
});

describe("loadBlueConfig risk settings", () => {
  const on = { RISK_ACTIONS: "true", RISK_API_URL: "https://risk.example" };
  it("is log only by default and keeps simulated scores off the live pool", () => {
    expect(loadBlueConfig({ RISK_API_URL: "https://risk.example" }).risk).toBeUndefined();
    expect(loadBlueConfig(on).risk).toEqual({ confirmations: 3, maxAgeMs: 900_000, allowSimulated: false });
    expect(() => loadBlueConfig({ ...on, RISK_ALLOW_SIMULATED: "true" })).toThrow(/demo pool only/);
    expect(loadBlueConfig({ ...on, RISK_ALLOW_SIMULATED: "true", BLUE_DEPLOYMENT: "demo" }).risk?.allowSimulated).toBe(true);
    expect(() => loadBlueConfig({ RISK_ACTIONS: "true" })).toThrow(/RISK_API_URL/);
  });
});

describe("tick with risk actions", () => {
  const withRisk = (category: string) => {
    const h = harness();
    h.deps.risk = tracker(1);
    h.deps.risk.add("TSLAB", reading(category), NOW);
    return h;
  };
  it("tightens the status and keeps reporting", async () => {
    const h = withRisk("HIGH");
    await tick(h.deps);
    expect(h.sent.map((c) => c.functionName)).toEqual(["refresh", "refresh", "setOverride", "report"]);
    expect(h.sent[2]!.args).toEqual([ASSETS[0]!.token, 3, 3600n]);
  });
  it("pauses once on critical risk and resumes when it passes", async () => {
    const h = withRisk("CRITICAL");
    await tick(h.deps);
    await tick(h.deps);
    const reports = () => h.sent.filter((c) => c.functionName === "report").map((c) => c.args![1]);
    expect(reports()).toEqual([false]);
    h.deps.risk!.add("TSLAB", reading("LOW", { asOfMs: NOW + 1000 }), NOW);
    await tick(h.deps);
    expect(reports()).toEqual([false, true]);
  });
});

describe("market status in a demo pool", () => {
  it("asks about the real bStock while acting on the pool's own token", async () => {
    const h = harness();
    const standIn = "0x000000000000000000000000000000000000dEaD";
    const asked: string[] = [];
    h.deps.assets = [{ ...ASSETS[0]!, token: standIn }];
    h.deps.sources = [{ name: "fake", check: async (a) => (asked.push(a.token), sig("ok")) }];
    await tick(h.deps);
    expect(asked).toEqual([ASSETS[0]!.listedToken]);
    expect(h.sent.at(-1)).toMatchObject({ functionName: "report", args: [standIn, true] });
  });
});

describe("pollRisk", () => {
  const deps = () => {
    const events: [string, Record<string, unknown> | undefined][] = [];
    return { events, d: { assets: ASSETS.slice(0, 1), risk: tracker(1), log: (e: string, x?: Record<string, unknown>) => void events.push([e, x]), nowMs: () => NOW } };
  };
  const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("records a real reading and says why a simulated one is ignored", async () => {
    const row = { status: "available", category: "HIGH", aliases: ["TSLAB"], as_of: new Date(NOW).toISOString() };
    const real = deps();
    await pollRisk(real.d, "https://risk.example", respond({ assets: [{ ...row, simulated: false }] }));
    expect(real.d.risk.level("TSLAB", NOW)).toBe(RiskLevel.weekend);
    const fake = deps();
    await pollRisk(fake.d, "https://risk.example", respond({ assets: [{ ...row, simulated: true }] }));
    expect(fake.d.risk.level("TSLAB", NOW)).toBe(RiskLevel.none);
    expect(fake.events[0]![1]).toMatchObject({ ignored: "simulated data" });
  });
  it("logs an outage without throwing", async () => {
    const h = deps();
    await pollRisk(h.d, "https://risk.example", respond({}, 503));
    expect(h.events[0]![0]).toBe("risk_api_unavailable");
  });
});
