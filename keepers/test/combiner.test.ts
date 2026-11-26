import { beforeEach, describe, expect, it } from "vitest";
import { HaltCombiner } from "../src/halt/combiner.js";
import type { ContinuityResult } from "../src/halt/continuity.js";
import { ASSET, FakeSource } from "./helpers.js";

const MIN = 60_000;
let t: number;
let nasdaq: FakeSource, bapi: FakeSource, spot: FakeSource, mult: FakeSource;
let cont: ContinuityResult;
let contCalls: number;
let ctxSeen: { latchedSinceMs: number; nowMs: number } | undefined;
let c: HaltCombiner;

beforeEach(() => {
  t = 1_000_000;
  nasdaq = new FakeSource("nasdaq");
  bapi = new FakeSource("bapi");
  spot = new FakeSource("spot");
  mult = new FakeSource("multiplier");
  cont = { ok: true, detail: "fine" };
  contCalls = 0;
  c = new HaltCombiner({
    sources: [nasdaq, bapi, spot, mult],
    continuity: async (_a, ctx) => {
      contCalls++;
      ctxSeen = ctx;
      return cont;
    },
    unknownTimeoutMs: 10 * MIN,
    now: () => t,
  });
});

describe("pushing conservative", () => {
  it("all ok -> ok, continuity not consulted", async () => {
    const d = await c.evaluate(ASSET);
    expect(d.state).toBe("ok");
    expect(contCalls).toBe(0);
  });
  it.each([
    ["nasdaq", "halted"],
    ["bapi", "halted"],
    ["spot", "halted"],
    ["bapi", "corp_action"],
    ["multiplier", "corp_action"],
  ] as const)("a single %s=%s signal latches it", async (name, state) => {
    ({ nasdaq, bapi, spot, mult }[name === "multiplier" ? "mult" : name] as FakeSource).set(state);
    const d = await c.evaluate(ASSET);
    expect(d.state).toBe(state);
    expect(d.reasons.join()).toContain(name);
  });
  it("halted beats corp_action when both present", async () => {
    nasdaq.set("halted");
    mult.set("corp_action");
    expect((await c.evaluate(ASSET)).state).toBe("halted");
  });
  it("corp_action escalates to halted later but halted never de-escalates to corp_action", async () => {
    mult.set("corp_action");
    expect((await c.evaluate(ASSET)).state).toBe("corp_action");
    nasdaq.set("halted");
    expect((await c.evaluate(ASSET)).state).toBe("halted");
    nasdaq.set("ok");
    const d = await c.evaluate(ASSET);
    expect(d.state).toBe("halted");
  });
  it("a throwing source is treated as unknown (does not crash)", async () => {
    nasdaq.fail();
    const d = await c.evaluate(ASSET);
    expect(d.signals.nasdaq!.state).toBe("unknown");
    expect(d.state).toBe("ok");
  });
});

describe("clearing", () => {
  beforeEach(async () => {
    nasdaq.set("halted");
    await c.evaluate(ASSET);
    t += MIN;
  });
  it("stays latched while any source still non-ok", async () => {
    nasdaq.set("ok");
    bapi.set("halted");
    const d = await c.evaluate(ASSET);
    expect(d.state).toBe("halted");
    expect(contCalls).toBe(0);
  });
  it("all sources ok but continuity fails -> stays latched", async () => {
    nasdaq.set("ok");
    cont = { ok: false, detail: "gap" };
    const d = await c.evaluate(ASSET);
    expect(d.state).toBe("halted");
    expect(d.clearBlockedBy).toContain("continuity: gap");
  });
  it("continuity that throws does not clear", async () => {
    nasdaq.set("ok");
    const c2 = new HaltCombiner({
      sources: [nasdaq],
      continuity: async () => {
        throw new Error("rpc down");
      },
      unknownTimeoutMs: 10 * MIN,
      now: () => t,
    });
    c2.seed(ASSET, "halted");
    const d = await c2.evaluate(ASSET);
    expect(d.state).toBe("halted");
    expect(d.clearBlockedBy).toContain("rpc down");
  });
  it("one source unknown (even with others ok and continuity ok) never clears", async () => {
    nasdaq.set("ok");
    spot.set("unknown");
    const d = await c.evaluate(ASSET);
    expect(d.state).toBe("halted");
    expect(d.cleared).toBe(false);
    expect(contCalls).toBe(0);
  });
  it("all ok + continuity ok -> cleared, with the latch time passed to continuity", async () => {
    nasdaq.set("ok");
    const d = await c.evaluate(ASSET);
    expect(d.state).toBe("ok");
    expect(d.cleared).toBe(true);
    expect(ctxSeen!.latchedSinceMs).toBe(1_000_000);
    expect(ctxSeen!.nowMs).toBe(1_000_000 + MIN);
    expect((await c.evaluate(ASSET)).cleared).toBe(false);
  });
  it("after clear, a new signal latches again", async () => {
    nasdaq.set("ok");
    await c.evaluate(ASSET);
    bapi.set("corp_action");
    expect((await c.evaluate(ASSET)).state).toBe("corp_action");
  });
  it("corp_action clears the same way", async () => {
    nasdaq.set("ok");
    await c.evaluate(ASSET); // cleared
    mult.set("corp_action");
    await c.evaluate(ASSET);
    mult.set("ok");
    cont = { ok: false, detail: "price not settled" };
    expect((await c.evaluate(ASSET)).state).toBe("corp_action");
    cont = { ok: true, detail: "settled" };
    expect((await c.evaluate(ASSET)).state).toBe("ok");
  });
});

describe("unknown handling", () => {
  it("unknown below timeout keeps ok state", async () => {
    bapi.set("unknown");
    expect((await c.evaluate(ASSET)).state).toBe("ok");
    t += 9 * MIN;
    expect((await c.evaluate(ASSET)).state).toBe("ok");
  });
  it("unknown at timeout -> halted", async () => {
    bapi.set("unknown");
    await c.evaluate(ASSET);
    t += 10 * MIN;
    const d = await c.evaluate(ASSET);
    expect(d.state).toBe("halted");
    expect(d.reasons.join()).toContain("beyond timeout");
  });
  it("a recovery in between resets the unknown timer", async () => {
    bapi.set("unknown");
    await c.evaluate(ASSET);
    t += 9 * MIN;
    bapi.set("ok");
    await c.evaluate(ASSET);
    t += 9 * MIN;
    bapi.set("unknown");
    expect((await c.evaluate(ASSET)).state).toBe("ok");
    t += 9 * MIN;
    expect((await c.evaluate(ASSET)).state).toBe("ok");
  });
  it("timeout-halt clears once all sources recover and continuity passes", async () => {
    spot.set("unknown");
    await c.evaluate(ASSET);
    t += 11 * MIN;
    expect((await c.evaluate(ASSET)).state).toBe("halted");
    spot.set("ok");
    t += MIN;
    const d = await c.evaluate(ASSET);
    expect(d.state).toBe("ok");
    expect(d.cleared).toBe(true);
  });
  it("unknown timeout escalates a latched corp_action to halted", async () => {
    mult.set("corp_action");
    await c.evaluate(ASSET);
    mult.set("ok");
    spot.set("unknown");
    await c.evaluate(ASSET);
    t += 10 * MIN;
    expect((await c.evaluate(ASSET)).state).toBe("halted");
  });
  it("unknown never clears a halt no matter how long", async () => {
    nasdaq.set("halted");
    await c.evaluate(ASSET);
    nasdaq.set("unknown");
    for (let i = 0; i < 5; i++) {
      t += 30 * MIN;
      expect((await c.evaluate(ASSET)).state).toBe("halted");
    }
  });
  it("per-source timeout override", async () => {
    const c2 = new HaltCombiner({
      sources: [spot],
      continuity: async () => ({ ok: true, detail: "" }),
      unknownTimeoutMs: 10 * MIN,
      unknownTimeoutBySource: { spot: MIN },
      now: () => t,
    });
    spot.set("unknown");
    await c2.evaluate(ASSET);
    t += MIN;
    expect((await c2.evaluate(ASSET)).state).toBe("halted");
  });
});

describe("seed and isolation", () => {
  it("seeded latch does not clear without continuity", async () => {
    c.seed(ASSET, "halted");
    cont = { ok: false, detail: "no ref" };
    expect((await c.evaluate(ASSET)).state).toBe("halted");
    cont = { ok: true, detail: "" };
    expect((await c.evaluate(ASSET)).state).toBe("ok");
  });
  it("seed cannot downgrade", async () => {
    nasdaq.set("halted");
    await c.evaluate(ASSET);
    c.seed(ASSET, "corp_action");
    expect(c.state(ASSET)).toBe("halted");
  });
  it("assets are independent", async () => {
    const other = { ...ASSET, token: "0x0000000000000000000000000000000000000002" as const };
    nasdaq.set("halted");
    await c.evaluate(ASSET);
    expect(c.state(other)).toBe("ok");
  });
});
