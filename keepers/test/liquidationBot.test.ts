import { describe, expect, it } from "vitest";
import {
  LiquidationBot,
  isHealthy,
  liquidationIncentiveFactor,
  loadBotConfig,
  marketId,
  planLiquidation,
  toAssetsUp,
  type BotChain,
  type BotDeps,
  type LiquidationPlan,
  type MarketParams,
  type MarketState,
  type Position,
} from "../src/liquidationBot.js";

type A = `0x${string}`;
const E = 10n ** 18n;
const addr = (n: number): A => `0x${n.toString(16).padStart(40, "0")}`;
const params: MarketParams = { loanToken: addr(1), collateralToken: addr(2), oracle: addr(3), irm: addr(4), lltv: 8n * 10n ** 17n };
const market: MarketState = { totalBorrowAssets: 1000n * E, totalBorrowShares: 1000n * E * 10n ** 6n };
const sharesFor = (assets: bigint) => assets * 10n ** 6n;
const P1 = 10n ** 36n; // 1 collateral = 1 loan
const planCfg = { minProfit: 0n, dustBorrow: 0n, maxRepay: 0n };
const pos = (collateral: bigint, debt: bigint): Position => ({ collateral, borrowShares: sharesFor(debt) });

describe("morpho math", () => {
  it("LIF for 80% LLTV is 1/(1-0.3*0.2) and capped at 1.15", () => {
    expect(liquidationIncentiveFactor(8n * 10n ** 17n)).toBe((E * E) / (E - (3n * 10n ** 17n * 2n * 10n ** 17n) / E));
    expect(liquidationIncentiveFactor(10n ** 17n)).toBe(1_150_000_000_000_000_000n);
  });
  it("health boundary: exactly at maxBorrow is healthy, one wei over is not", () => {
    expect(isHealthy(pos(100n * E, 80n * E), market, P1, params.lltv)).toBe(true);
    expect(isHealthy(pos(100n * E, 81n * E), market, P1, params.lltv)).toBe(false);
    expect(isHealthy({ collateral: 0n, borrowShares: 0n }, market, P1, params.lltv)).toBe(true);
  });
  it("price drop makes a healthy position unhealthy", () => {
    const p = pos(100n * E, 70n * E);
    expect(isHealthy(p, market, P1, params.lltv)).toBe(true);
    expect(isHealthy(p, market, P1 / 2n, params.lltv)).toBe(false);
  });
  it("marketId is a deterministic 32 byte hash sensitive to every field", () => {
    expect(marketId(params)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(marketId(params)).toBe(marketId({ ...params }));
    expect(marketId({ ...params, lltv: params.lltv + 1n })).not.toBe(marketId(params));
  });
});

describe("planLiquidation", () => {
  const b = addr(10);
  it("healthy -> skip", () => expect(planLiquidation(b, pos(100n * E, 50n * E), market, P1, params, planCfg)).toMatchObject({ action: "skip", reason: "healthy" }));
  it("unhealthy -> full repay by shares with positive profit", () => {
    const r = planLiquidation(b, pos(100n * E, 90n * E), market, P1, params, planCfg);
    expect(r.action).toBe("liquidate");
    if (r.action !== "liquidate") return;
    expect(r.plan.repaidShares).toBe(sharesFor(90n * E));
    expect(r.plan.seizedAssets).toBe(0n);
    expect(r.plan.repayAssets).toBe(toAssetsUp(sharesFor(90n * E), market));
    expect(r.plan.profit).toBeGreaterThan(5n * E);
    expect(r.plan.profit).toBeLessThan(6n * E);
    expect(r.plan.health).toBeLessThan(1);
  });
  it("bad debt: seizes all collateral by assets", () => {
    const r = planLiquidation(b, pos(60n * E, 90n * E), market, P1, params, planCfg);
    expect(r.action).toBe("liquidate");
    if (r.action !== "liquidate") return;
    expect(r.plan.seizedAssets).toBe(60n * E);
    expect(r.plan.repaidShares).toBe(0n);
  });
  it("dust and min profit thresholds", () => {
    expect(planLiquidation(b, pos(100n * E, 90n * E), market, P1, params, { ...planCfg, dustBorrow: 100n * E })).toMatchObject({ reason: "dust" });
    expect(planLiquidation(b, pos(100n * E, 90n * E), market, P1, params, { ...planCfg, minProfit: 10n * E })).toMatchObject({ reason: "unprofitable" });
  });
  it("maxRepay and available balance cap -> partial liquidation by seized assets within the cap", () => {
    const r = planLiquidation(b, pos(100n * E, 90n * E), market, P1, params, { ...planCfg, maxRepay: 30n * E });
    expect(r.action).toBe("liquidate");
    if (r.action !== "liquidate") return;
    expect(r.plan.repaidShares).toBe(0n);
    expect(r.plan.repayAssets).toBeLessThanOrEqual(30n * E);
    expect(r.plan.repayAssets).toBeGreaterThan(29n * E);
    const r2 = planLiquidation(b, pos(100n * E, 90n * E), market, P1, params, planCfg, 20n * E);
    expect(r2.action === "liquidate" && r2.plan.repayAssets <= 20n * E).toBe(true);
    expect(planLiquidation(b, pos(100n * E, 90n * E), market, P1, params, planCfg, 0n)).toMatchObject({ reason: "no_repay_funds" });
  });
  it("zero price is never acted on", () => expect(planLiquidation(b, pos(100n * E, 90n * E), market, 0n, params, planCfg)).toMatchObject({ reason: "zero_price" }));
});

interface FakeOpts {
  dryRun?: boolean;
  frozen?: boolean | Error;
  price?: bigint;
  positions?: Record<string, Position>;
  borrowEvents?: { block: bigint; who: A }[];
  head?: bigint;
  balance?: bigint;
  simFails?: boolean;
  seed?: A[];
  whenFrozen?: boolean;
  swapper?: A;
}
function fake(o: FakeOpts = {}) {
  const calls = { sent: [] as LiquidationPlan[], sims: 0, ranges: [] as [bigint, bigint][] };
  const logs: { e: string; d?: Record<string, unknown> }[] = [];
  const chain: BotChain = {
    headBlock: async () => o.head ?? 100n,
    borrowersBetween: async (from, to) => {
      calls.ranges.push([from, to]);
      return (o.borrowEvents ?? []).filter((x) => x.block >= from && x.block <= to).map((x) => x.who);
    },
    market: async () => market,
    position: async (u) => o.positions?.[u.toLowerCase()] ?? { borrowShares: 0n, collateral: 0n },
    oraclePrice: async () => o.price ?? P1,
    oracleFrozen: async () => {
      if (o.frozen instanceof Error) throw o.frozen;
      return o.frozen ?? false;
    },
    loanBalance: async () => o.balance ?? 1000n * E,
    simulate: async () => {
      calls.sims++;
      if (o.simFails) throw new Error("would revert");
    },
    send: async (p) => (calls.sent.push(p), "0xhash"),
  };
  const deps: BotDeps = {
    cfg: {
      market: params,
      seedBorrowers: o.seed ?? [],
      fromBlock: 0n,
      logChunk: 40n,
      lookback: 1000n,
      dryRun: o.dryRun ?? true,
      minProfit: 0n,
      dustBorrow: 0n,
      maxRepay: 0n,
      liquidateWhenFrozen: o.whenFrozen ?? false,
      swapper: o.swapper,
    },
    chain,
    log: (e, d) => logs.push({ e, d }),
  };
  return { bot: new LiquidationBot(deps), calls, logs };
}
const U1 = addr(0xa1);
const U2 = addr(0xa2);
const bad = pos(100n * E, 90n * E);
const good = pos(100n * E, 10n * E);

describe("LiquidationBot", () => {
  it("dry run (default) logs the liquidation and never simulates or sends", async () => {
    const f = fake({ seed: [U1], positions: { [U1]: bad } });
    const out = await f.bot.tick();
    expect(out).toMatchObject([{ borrower: U1, result: "dry_run" }]);
    expect(f.calls.sent).toEqual([]);
    expect(f.calls.sims).toBe(0);
    expect(f.logs.some((l) => l.e === "dry_run_liquidation")).toBe(true);
  });
  it("live: simulates then sends only the unhealthy position", async () => {
    const f = fake({ dryRun: false, seed: [U1, U2], positions: { [U1]: bad, [U2]: good } });
    const out = await f.bot.tick();
    expect(out.filter((x) => x.result === "sent").map((x) => x.borrower)).toEqual([U1]);
    expect(f.calls.sims).toBe(1);
    expect(f.calls.sent).toHaveLength(1);
  });
  it("live: failed simulation prevents the send", async () => {
    const f = fake({ dryRun: false, seed: [U1], positions: { [U1]: bad }, simFails: true });
    expect(await f.bot.tick()).toMatchObject([{ result: "sim_failed" }]);
    expect(f.calls.sent).toEqual([]);
  });
  it("frozen oracle: nothing happens, even live", async () => {
    const f = fake({ dryRun: false, frozen: true, seed: [U1], positions: { [U1]: bad } });
    expect(await f.bot.tick()).toEqual([]);
    expect(f.calls.sent).toEqual([]);
    expect(f.logs.some((l) => l.e === "oracle_frozen_skip")).toBe(true);
  });
  it("unknown frozen state (isFrozen reverts) also skips", async () => {
    const f = fake({ dryRun: false, frozen: new Error("no isFrozen"), seed: [U1], positions: { [U1]: bad } });
    expect(await f.bot.tick()).toEqual([]);
    expect(f.calls.sent).toEqual([]);
  });
  it("liquidateWhenFrozen=true overrides the freeze guard", async () => {
    const f = fake({ dryRun: false, frozen: true, whenFrozen: true, seed: [U1], positions: { [U1]: bad } });
    expect(await f.bot.tick()).toMatchObject([{ result: "sent" }]);
  });
  it("discovers borrowers from Borrow events in chunks and only rescans new blocks", async () => {
    const f = fake({ head: 100n, borrowEvents: [{ block: 5n, who: U1 }, { block: 95n, who: U2 }], positions: { [U1]: bad, [U2]: bad } });
    await f.bot.tick();
    expect(f.calls.ranges).toEqual([[0n, 39n], [40n, 79n], [80n, 100n]]);
    expect([...f.bot.borrowers].sort()).toEqual([U1, U2]);
    f.calls.ranges.length = 0;
    await f.bot.tick();
    expect(f.calls.ranges).toEqual([]); // head did not move: nothing to scan
  });
  it("drops borrowers whose debt is gone", async () => {
    const f = fake({ seed: [U1], positions: {} });
    await f.bot.tick();
    expect(f.bot.borrowers.size).toBe(0);
  });
  it("pre-funded balance is spent across positions, no overdraft", async () => {
    const f = fake({ dryRun: false, seed: [U1, U2], positions: { [U1]: bad, [U2]: bad }, balance: 100n * E });
    const out = await f.bot.tick();
    expect(out.filter((x) => x.result === "sent")).toHaveLength(1);
    expect(out.some((x) => x.reason === "insufficient_balance")).toBe(true);
  });
  it("swap mode ignores the pre-funded balance", async () => {
    const f = fake({ dryRun: false, seed: [U1], positions: { [U1]: bad }, balance: 0n, swapper: addr(0x55) });
    expect(await f.bot.tick()).toMatchObject([{ result: "sent" }]);
  });
});

describe("loadBotConfig", () => {
  const env = {
    RPC_URL: "http://x",
    MARKET_PARAMS: JSON.stringify({ loanToken: addr(1), collateralToken: addr(2), oracle: addr(3), irm: addr(4), lltv: "800000000000000000" }),
    LIQUIDATOR: addr(9),
  };
  it("defaults: dry run ON, Morpho BSC, thresholds zero, frozen guard on", () => {
    const c = loadBotConfig(env);
    expect(c.dryRun).toBe(true);
    expect(c.morpho).toBe("0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a");
    expect(c.liquidateWhenFrozen).toBe(false);
    expect(c.market.lltv).toBe(8n * 10n ** 17n);
  });
  it("live needs a key; seeds and thresholds parse; bad input rejected", () => {
    expect(() => loadBotConfig({ ...env, DRY_RUN: "false" })).toThrow(/PRIVATE_KEY/);
    const c = loadBotConfig({ ...env, DRY_RUN: "false", KEEPER_PRIVATE_KEY: "0x" + "11".repeat(32), SEED_BORROWERS: `${addr(5)}, ${addr(6)}`, MIN_PROFIT: "1000", LIQUIDATE_WHEN_FROZEN: "true" });
    expect(c.dryRun).toBe(false);
    expect(c.seedBorrowers).toHaveLength(2);
    expect(c.minProfit).toBe(1000n);
    expect(c.liquidateWhenFrozen).toBe(true);
    expect(() => loadBotConfig({ ...env, SEED_BORROWERS: "nope" })).toThrow();
    expect(() => loadBotConfig({ ...env, MARKET_PARAMS: "{}" })).toThrow();
  });
});
