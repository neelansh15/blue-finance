import { describe, expect, it } from "vitest";
import type { RegimeName } from "../src/abi.js";
import { loadConfig } from "../src/config.js";
import { HaltCombiner } from "../src/halt/combiner.js";
import { heartbeatOracle, planActions, stableCalendar, tickAsset, type KeeperChain, type OnchainState, type PlanInput, type PlannedAction } from "../src/regimeKeeper.js";
import { ASSET, FakeSource } from "./helpers.js";

const NOW = 1_000_000;
const st = (calendar: RegimeName, ov: RegimeName = "OPEN", expiry = 0, extra: Partial<OnchainState> = {}): OnchainState => ({
  calendar,
  override: { state: ov, expiry },
  global: { state: "OPEN", expiry: 0 },
  keeperCanClear: true,
  maxOverrideS: 30 * 86400,
  effective: calendar,
  ...extra,
});
const base = (o: Partial<PlanInput>): PlanInput => ({
  onchain: st("OPEN"),
  computedCalendar: "OPEN",
  signal: "ok",
  nowS: NOW,
  durationS: 3600,
  refreshMarginS: 600,
  ...o,
});

describe("planActions", () => {
  it("nothing to do when calendar matches and no signal", () => expect(planActions(base({}))).toEqual([]));
  it("halt signal -> setOverride HALTED", () => {
    const a = planActions(base({ signal: "halted" }));
    expect(a).toMatchObject([{ kind: "setOverride", regime: "HALTED", durationS: 3600 }]);
  });
  it("corp_action signal -> CORP_ACTION", () => {
    expect(planActions(base({ signal: "corp_action" }))).toMatchObject([{ kind: "setOverride", regime: "CORP_ACTION" }]);
  });
  it("signal on a WEEKEND calendar still overrides (HALTED > WEEKEND)", () => {
    expect(planActions(base({ onchain: st("WEEKEND"), computedCalendar: "WEEKEND", signal: "halted" }))).toMatchObject([{ regime: "HALTED" }]);
  });
  it("local calendar more conservative than chain (e.g. holiday not set on-chain) -> push it", () => {
    const a = planActions(base({ onchain: st("OPEN"), computedCalendar: "WEEKEND" }));
    expect(a).toMatchObject([{ kind: "setOverride", regime: "WEEKEND" }]);
  });
  it("local calendar less conservative than chain -> never relaxes", () => {
    expect(planActions(base({ onchain: st("WEEKEND"), computedCalendar: "OPEN" }))).toEqual([]);
  });
  it("unstable calendar (null) is ignored", () => {
    expect(planActions(base({ computedCalendar: null }))).toEqual([]);
  });
  it("active override and signal cleared -> clearOverride", () => {
    expect(planActions(base({ onchain: st("OPEN", "HALTED", NOW + 1000) }))).toMatchObject([{ kind: "clearOverride" }]);
  });
  it("expired override is not cleared", () => {
    expect(planActions(base({ onchain: st("OPEN", "HALTED", NOW - 1) }))).toEqual([]);
  });
  it("same override still far from expiry -> idempotent", () => {
    expect(planActions(base({ signal: "halted", onchain: st("OPEN", "HALTED", NOW + 3000) }))).toEqual([]);
  });
  it("same override near expiry -> refresh", () => {
    expect(planActions(base({ signal: "halted", onchain: st("OPEN", "HALTED", NOW + 100) }))).toMatchObject([{ kind: "setOverride", regime: "HALTED" }]);
  });
  it("escalate CORP_ACTION -> HALTED is a single set", () => {
    expect(planActions(base({ signal: "halted", onchain: st("OPEN", "CORP_ACTION", NOW + 3000) }))).toMatchObject([{ kind: "setOverride", regime: "HALTED" }]);
  });
  it("de-escalate HALTED -> CORP_ACTION is clear then set", () => {
    const a = planActions(base({ signal: "corp_action", onchain: st("OPEN", "HALTED", NOW + 3000) }));
    expect(a.map((x) => x.kind)).toEqual(["clearOverride", "setOverride"]);
  });
  it("OPEN-state override is treated as none", () => {
    expect(planActions(base({ onchain: st("OPEN", "OPEN", NOW + 3000) }))).toEqual([]);
  });
});

describe("stableCalendar", () => {
  it("null within grace after a boundary, regime otherwise", () => {
    const open = Date.parse("2026-06-02T13:30:00Z");
    expect(stableCalendar(open + 30_000, 90_000)).toBeNull();
    expect(stableCalendar(open + 120_000, 90_000)).toBe("OPEN");
  });
});

describe("loadConfig", () => {
  const env = {
    RPC_URL: "http://x",
    REGIME_REGISTRY: "0x0000000000000000000000000000000000000001",
    ASSETS: JSON.stringify([{ symbol: "TSLAB", ticker: "TSLA", token: ASSET.token }]),
  };
  it("dry run defaults ON and needs no key", () => {
    const c = loadConfig(env);
    expect(c.dryRun).toBe(true);
    expect(c.assets[0]!.symbol).toBe("TSLAB");
  });
  it("DRY_RUN=false requires a key", () => {
    expect(() => loadConfig({ ...env, DRY_RUN: "false" })).toThrow(/KEEPER_PRIVATE_KEY/);
    expect(loadConfig({ ...env, DRY_RUN: "false", KEEPER_PRIVATE_KEY: "0x" + "11".repeat(32) }).dryRun).toBe(false);
  });
  it("rejects bad inputs", () => {
    expect(() => loadConfig({ ...env, ASSETS: "[]" })).toThrow();
    expect(() => loadConfig({ ...env, REGIME_REGISTRY: "nope" })).toThrow();
    expect(() => loadConfig({ ...env, KEEPER_PRIVATE_KEY: "abc" })).toThrow();
  });
});

describe("tickAsset", () => {
  const mk = (dryRun: boolean, state: OnchainState) => {
    const sent: PlannedAction[] = [];
    const oracleUpdates: string[] = [];
    const logs: string[] = [];
    const chain: KeeperChain = {
      readState: async () => state,
      send: async (a) => {
        sent.push(a);
        return "0xhash";
      },
      readOracle: async () => ({ price: 1n, frozen: false, frozenSince: 0 }),
      updateOracle: async () => {
        oracleUpdates.push("u");
        return "0xorc";
      },
    };
    const nasdaq = new FakeSource("nasdaq");
    const combiner = new HaltCombiner({ sources: [nasdaq], continuity: async () => ({ ok: true, detail: "" }), unknownTimeoutMs: 600_000 });
    const deps = {
      cfg: { dryRun, overrideDurationS: 3600, overrideRefreshMarginS: 600, calendarGraceMs: 90_000 },
      chain,
      combiner,
      log: (e: string) => logs.push(e),
      nowMs: () => Date.parse("2026-06-02T15:00:00Z"), // Tuesday, OPEN
    };
    return { sent, logs, nasdaq, deps, combiner, oracleUpdates };
  };
  it("dry run logs intended tx but sends nothing", async () => {
    const t = mk(true, st("OPEN"));
    t.nasdaq.set("halted");
    const a = await tickAsset(t.deps, ASSET);
    expect(a).toMatchObject([{ kind: "setOverride", regime: "HALTED" }]);
    expect(t.sent).toEqual([]);
    expect(t.logs).toContain("dry_run_tx");
  });
  it("live mode sends", async () => {
    const t = mk(false, st("OPEN"));
    t.nasdaq.set("halted");
    await tickAsset(t.deps, ASSET);
    expect(t.sent).toHaveLength(1);
  });
  it("seeds latch from an active on-chain HALTED override so a restart cannot clear it blindly", async () => {
    const t = mk(true, st("OPEN", "HALTED", Math.floor(Date.parse("2026-06-02T15:00:00Z") / 1000) + 3000));
    await tickAsset(t.deps, ASSET); // sources ok, continuity ok -> may clear legitimately
    expect(t.combiner.state(ASSET)).toBe("ok");
    const t2 = mk(true, st("OPEN", "HALTED", Math.floor(Date.parse("2026-06-02T15:00:00Z") / 1000) + 3000));
    t2.nasdaq.set("unknown");
    const a = await tickAsset(t2.deps, ASSET);
    expect(t2.combiner.state(ASSET)).toBe("halted");
    expect(a).toEqual([]); // keeps override, unknown does not clear
  });
});

describe("planActions against the final registry rules", () => {
  it("never plans an OPEN override", () => {
    for (const sig of ["ok", "halted", "corp_action"] as const) {
      for (const cal of ["OPEN", "EXTENDED", "CLOSED", "WEEKEND"] as const) {
        const a = planActions(base({ onchain: st(cal), computedCalendar: "OPEN", signal: sig }));
        for (const x of a) if (x.kind === "setOverride") expect(x.regime).not.toBe("OPEN");
      }
    }
  });
  it("a global override at least as conservative as the need suppresses the asset override", () => {
    const g = { global: { state: "HALTED" as RegimeName, expiry: NOW + 5000 } };
    expect(planActions(base({ onchain: st("OPEN", "OPEN", 0, g), signal: "halted" }))).toEqual([]);
    expect(planActions(base({ onchain: st("OPEN", "OPEN", 0, g), signal: "corp_action" }))).toEqual([]);
  });
  it("a less conservative global override does not suppress it", () => {
    const g = { global: { state: "WEEKEND" as RegimeName, expiry: NOW + 5000 } };
    expect(planActions(base({ onchain: st("OPEN", "OPEN", 0, g), signal: "halted" }))).toMatchObject([{ kind: "setOverride", regime: "HALTED" }]);
  });
  it("expired global override is ignored", () => {
    const g = { global: { state: "HALTED" as RegimeName, expiry: NOW - 1 } };
    expect(planActions(base({ onchain: st("OPEN", "OPEN", 0, g), signal: "halted" }))).toMatchObject([{ kind: "setOverride" }]);
  });
  it("escalation stretches the duration so the new expiry is not earlier than the current one", () => {
    const a = planActions(base({ signal: "halted", durationS: 3600, onchain: st("OPEN", "CORP_ACTION", NOW + 86400) }));
    expect(a).toMatchObject([{ kind: "setOverride", regime: "HALTED", durationS: 86400 + 60 }]);
  });
  it("duration is capped at MAX_OVERRIDE", () => {
    const a = planActions(base({ signal: "halted", durationS: 3600, onchain: st("OPEN", "OPEN", 0, { maxOverrideS: 1800 }) }));
    expect(a).toMatchObject([{ durationS: 1800 }]);
  });
  it("keeperCanClear=false: never clears, waits instead (signal gone)", () => {
    const a = planActions(base({ onchain: st("OPEN", "HALTED", NOW + 1000, { keeperCanClear: false }) }));
    expect(a).toMatchObject([{ kind: "wait" }]);
  });
  it("keeperCanClear=false: de-escalation HALTED -> CORP_ACTION waits, no clear/set", () => {
    const a = planActions(base({ signal: "corp_action", onchain: st("OPEN", "HALTED", NOW + 3000, { keeperCanClear: false }) }));
    expect(a.map((x) => x.kind)).toEqual(["wait"]);
  });
  it("keeperCanClear=false: escalation and refresh still work", () => {
    const c = { keeperCanClear: false };
    expect(planActions(base({ signal: "halted", onchain: st("OPEN", "CORP_ACTION", NOW + 3000, c) }))).toMatchObject([{ kind: "setOverride", regime: "HALTED" }]);
    expect(planActions(base({ signal: "halted", onchain: st("OPEN", "HALTED", NOW + 100, c) }))).toMatchObject([{ kind: "setOverride", regime: "HALTED" }]);
  });
});

describe("tickAsset wait and oracle heartbeat", () => {
  const ORACLE = "0x00000000000000000000000000000000000000aa" as const;
  const asset = { ...ASSET, oracle: ORACLE };
  const mkTick = (dryRun: boolean, onchain: OnchainState, last?: Map<string, number>) => {
    const sent: PlannedAction[] = [];
    const logs: { e: string; d?: Record<string, unknown> }[] = [];
    let updates = 0;
    const now = Date.parse("2026-06-02T15:00:00Z");
    const chain: KeeperChain = {
      readState: async () => onchain,
      send: async (a) => (sent.push(a), "0xh"),
      readOracle: async () => ({ price: 5n, frozen: true, frozenSince: 1 }),
      updateOracle: async () => (updates++, "0xu"),
    };
    const combiner = new HaltCombiner({ sources: [new FakeSource("n")], continuity: async () => ({ ok: true, detail: "" }), unknownTimeoutMs: 600_000 });
    const deps = {
      cfg: { dryRun, overrideDurationS: 3600, overrideRefreshMarginS: 600, calendarGraceMs: 90_000, oracleUpdateIntervalMs: 60_000 },
      chain,
      combiner,
      lastOracleUpdate: last,
      log: (e: string, d?: Record<string, unknown>) => logs.push({ e, d }),
      nowMs: () => now,
    };
    return { sent, logs, deps, updates: () => updates, now };
  };
  it("dry run: oracle update is logged, not sent", async () => {
    const t = mkTick(true, st("OPEN"));
    expect(await heartbeatOracle(t.deps, asset)).toBe("dry_run");
    expect(t.updates()).toBe(0);
    expect(t.logs.some((l) => l.e === "dry_run_tx" && l.d?.kind === "oracleUpdate")).toBe(true);
  });
  it("live: update() is sent once and throttled within the interval", async () => {
    const last = new Map<string, number>();
    const t = mkTick(false, st("OPEN"), last);
    await tickAsset(t.deps, asset);
    expect(t.updates()).toBe(1);
    await tickAsset(t.deps, asset);
    expect(t.updates()).toBe(1);
    last.set(ORACLE.toLowerCase(), t.now - 61_000);
    await tickAsset(t.deps, asset);
    expect(t.updates()).toBe(2);
  });
  it("no oracle configured: skipped", async () => {
    const t = mkTick(false, st("OPEN"));
    expect(await heartbeatOracle(t.deps, ASSET)).toBe("skipped");
  });
  it("update failure is logged, tick does not throw", async () => {
    const t = mkTick(false, st("OPEN"));
    t.deps.chain.updateOracle = async () => {
      throw new Error("revert");
    };
    expect(await heartbeatOracle(t.deps, asset)).toBe("failed");
    expect(t.logs.some((l) => l.e === "oracle_update_failed")).toBe(true);
  });
  it("wait action is logged and never sent, even live", async () => {
    const nowS = Math.floor(Date.parse("2026-06-02T15:00:00Z") / 1000);
    const t = mkTick(false, st("OPEN", "HALTED", nowS + 3000, { keeperCanClear: false }));
    const a = await tickAsset(t.deps, ASSET);
    expect(a.map((x) => x.kind)).toEqual(["wait"]);
    expect(t.sent).toEqual([]);
    expect(t.logs.some((l) => l.e === "override_wait")).toBe(true);
  });
});
