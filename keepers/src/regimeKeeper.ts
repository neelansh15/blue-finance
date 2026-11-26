// Regime keeper: compares computed calendar + halt signals against the on-chain RegimeRegistry and
// calls setOverride / clearOverride. DRY_RUN defaults ON: intended txs are logged, none are sent.
import { pathToFileURL } from "node:url";
import type { PublicClient, WalletClient } from "viem";
import { Regime, conservativeness, blueOracleAbi, moreConservative, regimeName, regimeRegistryAbi, type RegimeName } from "./abi.js";
import { makeClients } from "./chain.js";
import { loadConfig, type KeeperAsset, type KeeperConfig } from "./config.js";
import { HaltCombiner, type CombinedState, type Decision } from "./halt/combiner.js";
import { PriceContinuity, viemPriceReader } from "./halt/continuity.js";
import { BinanceBapiSource } from "./halt/binanceBapi.js";
import { BinanceSpotSource } from "./halt/binanceSpot.js";
import { MultiplierWatcherSource, viemMultiplierReader } from "./halt/multiplierWatcher.js";
import { NasdaqHaltSource } from "./halt/nasdaq.js";
import { sessionRegime } from "./session.js";

export interface OverrideState {
  state: RegimeName;
  expiry: number;
}

export interface OnchainState {
  calendar: RegimeName;
  /** Per-asset override (may be expired or OPEN = none). */
  override: OverrideState;
  /** Global override (asset address(0)); applies to every asset, the keeper only reads it. */
  global?: OverrideState;
  /** Registry flag: may the KEEPER clearOverride? If false, overrides can only expire or be cleared by the admin. */
  keeperCanClear: boolean;
  /** Registry MAX_OVERRIDE in seconds. */
  maxOverrideS: number;
  effective: RegimeName;
}

export type PlannedAction =
  | { kind: "setOverride"; regime: RegimeName; durationS: number; why: string }
  | { kind: "clearOverride"; why: string }
  /** Not a tx: the keeper wants to relax an override but cannot (keeperCanClear is false). */
  | { kind: "wait"; why: string };

export interface PlanInput {
  onchain: OnchainState;
  /** Calendar computed locally, or null when not stable around a boundary (then ignored). */
  computedCalendar: RegimeName | null;
  signal: CombinedState;
  nowS: number;
  durationS: number;
  refreshMarginS: number;
}

const signalRegime = (s: CombinedState): RegimeName | null => (s === "halted" ? "HALTED" : s === "corp_action" ? "CORP_ACTION" : null);
const activeState = (o: OverrideState | undefined, nowS: number): RegimeName | null => (o && o.expiry > nowS && o.state !== "OPEN" ? o.state : null);

/**
 * Pure planner against the real RegimeRegistry rules:
 * - an override can never be OPEN, and only matters when more conservative than max(calendar, global override);
 * - while one is active a new one must be at least as conservative and must not expire earlier (so the duration is
 *   stretched past the current expiry, capped at MAX_OVERRIDE);
 * - relaxing needs clearOverride, which the keeper may only call when keeperCanClear; otherwise we wait for expiry
 *   (or an admin clear) and emit a "wait" note.
 */
export function planActions(i: PlanInput): PlannedAction[] {
  const sig = signalRegime(i.signal);
  const g = activeState(i.onchain.global, i.nowS);
  let floor: RegimeName = i.onchain.calendar;
  if (g && conservativeness(g) > conservativeness(floor)) floor = g;
  let desired: RegimeName = floor;
  const reasons: string[] = [];
  if (i.computedCalendar && conservativeness(i.computedCalendar) > conservativeness(desired)) {
    desired = i.computedCalendar;
    reasons.push(`local calendar ${i.computedCalendar} more conservative than on-chain ${floor}`);
  }
  if (sig && conservativeness(sig) > conservativeness(desired)) {
    desired = moreConservative(desired, sig);
    reasons.push(`halt signal ${i.signal}`);
  }
  const target: RegimeName | null = conservativeness(desired) > conservativeness(floor) ? desired : null;

  const o = i.onchain.override;
  const cur = activeState(o, i.nowS);
  const maxS = i.onchain.maxOverrideS;
  // New expiry must be >= current expiry; +60 s covers block time drift. Capped at MAX_OVERRIDE (always enough, see registry).
  const durFor = (): number => Math.min(maxS, Math.max(Math.min(i.durationS, maxS), cur ? o.expiry - i.nowS + 60 : 0));
  const canClear = i.onchain.keeperCanClear;

  if (!target) {
    if (!cur) return [];
    return canClear
      ? [{ kind: "clearOverride", why: "no signal or calendar gap needs an override" }]
      : [{ kind: "wait", why: `${o.state} override no longer needed but keeperCanClear=false; expires at ${o.expiry} or admin must clear` }];
  }
  const why = reasons.join("; ");
  if (!cur) return [{ kind: "setOverride", regime: target, durationS: durFor(), why }];
  const cmp = conservativeness(cur) - conservativeness(target);
  if (cmp < 0) return [{ kind: "setOverride", regime: target, durationS: durFor(), why: `escalate ${cur}->${target}: ${why}` }];
  if (cmp > 0) {
    if (!canClear) {
      return [{ kind: "wait", why: `${cur} override more conservative than needed (${target}) but keeperCanClear=false; expires at ${o.expiry} or admin must clear` }];
    }
    return [
      { kind: "clearOverride", why: `de-escalate ${cur}->${target}` },
      { kind: "setOverride", regime: target, durationS: Math.min(i.durationS, maxS), why },
    ];
  }
  if (o.expiry - i.nowS < i.refreshMarginS) return [{ kind: "setOverride", regime: target, durationS: durFor(), why: `refresh expiring ${target}` }];
  return [];
}

/** Computed calendar, but only if it is the same now and `graceMs` ago (avoids flapping at session boundaries vs. chain clock). */
export function stableCalendar(nowMs: number, graceMs: number): RegimeName | null {
  const a = sessionRegime(nowMs);
  return a === sessionRegime(nowMs - graceMs) ? a : null;
}

export interface OracleStatus {
  price: bigint;
  frozen: boolean;
  frozenSince: number;
}

export interface KeeperChain {
  readState(asset: KeeperAsset): Promise<OnchainState>;
  /** Only setOverride / clearOverride are sent; "wait" is never a tx. */
  send(action: PlannedAction, asset: KeeperAsset): Promise<string>;
  readOracle(oracle: `0x${string}`): Promise<OracleStatus>;
  /** BlueOracle.update(), permissionless. */
  updateOracle(oracle: `0x${string}`): Promise<string>;
}

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export function viemKeeperChain(registry: `0x${string}`, pub: PublicClient, wallet: WalletClient | undefined): KeeperChain {
  return {
    async readState(asset) {
      const [cal, ov, glob, eff, kcc, max] = await Promise.all([
        pub.readContract({ address: registry, abi: regimeRegistryAbi, functionName: "calendarRegime" }),
        pub.readContract({ address: registry, abi: regimeRegistryAbi, functionName: "overrideOf", args: [asset.token] }),
        pub.readContract({ address: registry, abi: regimeRegistryAbi, functionName: "overrideOf", args: [ZERO] }),
        pub.readContract({ address: registry, abi: regimeRegistryAbi, functionName: "regime", args: [asset.token] }),
        pub.readContract({ address: registry, abi: regimeRegistryAbi, functionName: "keeperCanClear" }),
        pub.readContract({ address: registry, abi: regimeRegistryAbi, functionName: "MAX_OVERRIDE" }),
      ]);
      return {
        calendar: regimeName(cal),
        override: { state: regimeName(ov[0]), expiry: Number(ov[1]) },
        global: { state: regimeName(glob[0]), expiry: Number(glob[1]) },
        keeperCanClear: kcc,
        maxOverrideS: Number(max),
        effective: regimeName(eff),
      };
    },
    async readOracle(oracle) {
      const [price, frozen, since] = await Promise.all([
        pub.readContract({ address: oracle, abi: blueOracleAbi, functionName: "price" }),
        pub.readContract({ address: oracle, abi: blueOracleAbi, functionName: "isFrozen" }),
        pub.readContract({ address: oracle, abi: blueOracleAbi, functionName: "frozenSince" }),
      ]);
      return { price, frozen, frozenSince: Number(since) };
    },
    async updateOracle(oracle) {
      if (!wallet?.account) throw new Error("no wallet configured");
      const hash = await wallet.writeContract({ address: oracle, abi: blueOracleAbi, functionName: "update", account: wallet.account, chain: wallet.chain });
      await pub.waitForTransactionReceipt({ hash });
      return hash;
    },
    async send(action, asset) {
      if (!wallet?.account) throw new Error("no wallet configured");
      if (action.kind === "wait") throw new Error("wait is not a transaction");
      const hash =
        action.kind === "setOverride"
          ? await wallet.writeContract({
              address: registry,
              abi: regimeRegistryAbi,
              functionName: "setOverride",
              args: [asset.token, Regime[action.regime], BigInt(action.durationS)],
              account: wallet.account,
              chain: wallet.chain,
            })
          : await wallet.writeContract({
              address: registry,
              abi: regimeRegistryAbi,
              functionName: "clearOverride",
              args: [asset.token],
              account: wallet.account,
              chain: wallet.chain,
            });
      await pub.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

export type Logger = (event: string, data?: Record<string, unknown>) => void;
export const jsonLogger: Logger = (event, data) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

export interface TickDeps {
  cfg: Pick<KeeperConfig, "dryRun" | "overrideDurationS" | "overrideRefreshMarginS" | "calendarGraceMs"> & Partial<Pick<KeeperConfig, "oracleUpdateIntervalMs">>;
  /** Last oracle update time per oracle (ms), enables the throttle. Absent = update every tick. */
  lastOracleUpdate?: Map<string, number>;
  chain: KeeperChain;
  combiner: HaltCombiner;
  /** Record continuity reference while clean. */
  observe?: (asset: KeeperAsset) => Promise<void>;
  log: Logger;
  nowMs: () => number;
}

const seededKeys = new WeakMap<HaltCombiner, Set<string>>();

export async function tickAsset(d: TickDeps, asset: KeeperAsset): Promise<PlannedAction[]> {
  const nowMs = d.nowMs();
  const onchain = await d.chain.readState(asset);
  const key = asset.token.toLowerCase();
  const done = seededKeys.get(d.combiner) ?? new Set<string>();
  seededKeys.set(d.combiner, done);
  if (!done.has(key)) {
    done.add(key);
    if (onchain.override.expiry > nowMs / 1000) {
      if (onchain.override.state === "HALTED") d.combiner.seed(asset, "halted");
      else if (onchain.override.state === "CORP_ACTION") d.combiner.seed(asset, "corp_action");
    }
  }
  if (d.combiner.state(asset) === "ok" && d.observe) {
    try {
      await d.observe(asset);
    } catch (e) {
      d.log("continuity_observe_failed", { asset: asset.symbol, error: String(e) });
    }
  }
  const decision: Decision = await d.combiner.evaluate(asset);
  const computed = stableCalendar(nowMs, d.cfg.calendarGraceMs);
  const exact = sessionRegime(nowMs);
  if (exact !== onchain.calendar && computed === exact) {
    d.log("calendar_mismatch", { asset: asset.symbol, local: exact, onchain: onchain.calendar });
  }
  const actions = planActions({
    onchain,
    computedCalendar: computed,
    signal: decision.state,
    nowS: Math.floor(nowMs / 1000),
    durationS: d.cfg.overrideDurationS,
    refreshMarginS: d.cfg.overrideRefreshMarginS,
  });
  d.log("tick", {
    asset: asset.symbol,
    onchain,
    decision: decision.state,
    cleared: decision.cleared,
    clearBlockedBy: decision.clearBlockedBy,
    reasons: decision.reasons,
    actions,
  });
  for (const a of actions) {
    if (a.kind === "wait") {
      d.log("override_wait", { asset: asset.symbol, why: a.why });
      continue;
    }
    if (d.cfg.dryRun) {
      d.log("dry_run_tx", { asset: asset.symbol, ...a });
    } else {
      try {
        const hash = await d.chain.send(a, asset);
        d.log("tx_sent", { asset: asset.symbol, hash, ...a });
      } catch (e) {
        d.log("tx_failed", { asset: asset.symbol, error: String(e), ...a });
        break; // do not continue a clear+set sequence after a failure
      }
    }
  }
  await heartbeatOracle(d, asset);
  return actions;
}

/** Oracle update() is permissionless and idempotent; call it periodically so freezes and unfreezes are recorded. */
export async function heartbeatOracle(d: TickDeps, asset: KeeperAsset): Promise<"skipped" | "dry_run" | "sent" | "failed"> {
  const oracle = asset.oracle;
  if (!oracle) return "skipped";
  const now = d.nowMs();
  const key = oracle.toLowerCase();
  const every = d.cfg.oracleUpdateIntervalMs ?? 0;
  const last = d.lastOracleUpdate?.get(key);
  if (last !== undefined && now - last < every) return "skipped";
  d.lastOracleUpdate?.set(key, now);
  try {
    const before = await d.chain.readOracle(oracle);
    if (d.cfg.dryRun) {
      d.log("dry_run_tx", { asset: asset.symbol, kind: "oracleUpdate", oracle, frozen: before.frozen, price: before.price });
      return "dry_run";
    }
    const hash = await d.chain.updateOracle(oracle);
    const after = await d.chain.readOracle(oracle);
    d.log("oracle_updated", { asset: asset.symbol, oracle, hash, wasFrozen: before.frozen, frozen: after.frozen, price: after.price });
    return "sent";
  } catch (e) {
    d.log("oracle_update_failed", { asset: asset.symbol, oracle, error: String(e) });
    return "failed";
  }
}

export async function main(env = process.env): Promise<void> {
  const cfg = loadConfig(env);
  const { publicClient, walletClient } = makeClients(cfg.rpcUrl, cfg.chainId, cfg.privateKey);
  const log = jsonLogger;
  const feedFor = (a: { token: `0x${string}`; symbol: string }) => {
    const f = cfg.assets.find((x) => x.token.toLowerCase() === a.token.toLowerCase())?.feed;
    if (!f) throw new Error(`no feed configured for ${a.symbol}`);
    return f;
  };
  const continuity = new PriceContinuity(viemPriceReader(publicClient, feedFor, cfg.feedQuotesPerUi), cfg.continuityBandBps, cfg.continuityMaxAgeMs);
  const combiner = new HaltCombiner({
    sources: [
      new NasdaqHaltSource(),
      new BinanceBapiSource(),
      new BinanceSpotSource(),
      new MultiplierWatcherSource(viemMultiplierReader(publicClient), { holdAfterEffectiveMs: cfg.multiplierHoldMs }),
    ],
    continuity: continuity.check,
    unknownTimeoutMs: cfg.unknownTimeoutMs,
  });
  for (const sym of cfg.rebase) {
    const a = cfg.assets.find((x) => x.symbol === sym);
    if (a) {
      await continuity.rebase(a);
      log("rebased", { asset: sym });
    }
  }
  const chain = viemKeeperChain(cfg.registry, publicClient, walletClient);
  log("start", { dryRun: cfg.dryRun, registry: cfg.registry, assets: cfg.assets.map((a) => a.symbol), pollMs: cfg.pollIntervalMs });
  let stop = false;
  process.on("SIGINT", () => (stop = true));
  process.on("SIGTERM", () => (stop = true));
  const deps: TickDeps = { cfg, chain, combiner, lastOracleUpdate: new Map(), observe: (a) => continuity.observe(a), log, nowMs: Date.now };
  while (!stop) {
    for (const a of cfg.assets) {
      try {
        await tickAsset(deps, a);
      } catch (e) {
        log("tick_error", { asset: a.symbol, error: String(e) });
      }
    }
    await new Promise((r) => setTimeout(r, cfg.pollIntervalMs));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
