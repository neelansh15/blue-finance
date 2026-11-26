import type { AssetRef } from "./halt/types.js";

export interface KeeperAsset extends AssetRef {
  /** Atlas (or mock) feed address used for the continuity check. */
  feed?: `0x${string}`;
  /** BlueOracle for this asset; when set the keeper calls its permissionless update() as a heartbeat. */
  oracle?: `0x${string}`;
}

export interface KeeperConfig {
  rpcUrl: string;
  chainId: number;
  registry: `0x${string}`;
  assets: KeeperAsset[];
  privateKey?: `0x${string}`;
  dryRun: boolean;
  pollIntervalMs: number;
  overrideDurationS: number;
  overrideRefreshMarginS: number;
  unknownTimeoutMs: number;
  continuityBandBps: number;
  continuityMaxAgeMs: number;
  calendarGraceMs: number;
  feedQuotesPerUi: boolean;
  multiplierHoldMs: number;
  rebase: string[];
  /** Min time between oracle update() calls per asset. */
  oracleUpdateIntervalMs: number;
}

const isAddr = (s: unknown): s is `0x${string}` => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);

function need(env: Record<string, string | undefined>, k: string): string {
  const v = env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}
const num = (env: Record<string, string | undefined>, k: string, d: number): number => {
  const v = env[k];
  if (v === undefined || v === "") return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad number for ${k}: ${v}`);
  return n;
};

export function parseAssets(json: string): KeeperAsset[] {
  const arr = JSON.parse(json) as unknown;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("ASSETS must be a non-empty JSON array");
  return arr.map((a: Record<string, unknown>, i) => {
    if (!isAddr(a.token)) throw new Error(`ASSETS[${i}].token invalid`);
    if (typeof a.symbol !== "string" || typeof a.ticker !== "string") throw new Error(`ASSETS[${i}] needs symbol and ticker`);
    if (a.feed !== undefined && !isAddr(a.feed)) throw new Error(`ASSETS[${i}].feed invalid`);
    if (a.oracle !== undefined && !isAddr(a.oracle)) throw new Error(`ASSETS[${i}].oracle invalid`);
    return {
      symbol: a.symbol,
      ticker: a.ticker,
      token: a.token,
      spotSymbol: typeof a.spotSymbol === "string" ? a.spotSymbol : undefined,
      feed: a.feed as `0x${string}` | undefined,
      oracle: a.oracle as `0x${string}` | undefined,
    };
  });
}

/** Dry run is ON unless DRY_RUN is exactly "false" (or "0"). */
export function loadConfig(env: Record<string, string | undefined> = process.env): KeeperConfig {
  const registry = need(env, "REGIME_REGISTRY");
  if (!isAddr(registry)) throw new Error("REGIME_REGISTRY invalid");
  const pk = env.KEEPER_PRIVATE_KEY;
  const dryRun = !(env.DRY_RUN === "false" || env.DRY_RUN === "0");
  if (!dryRun && !pk) throw new Error("DRY_RUN=false requires KEEPER_PRIVATE_KEY");
  if (pk && !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("KEEPER_PRIVATE_KEY must be 0x + 64 hex");
  return {
    rpcUrl: need(env, "RPC_URL"),
    chainId: num(env, "CHAIN_ID", 56),
    registry,
    assets: parseAssets(need(env, "ASSETS")),
    privateKey: pk as `0x${string}` | undefined,
    dryRun,
    pollIntervalMs: num(env, "POLL_INTERVAL_MS", 30_000),
    overrideDurationS: num(env, "OVERRIDE_DURATION_S", 3600),
    overrideRefreshMarginS: num(env, "OVERRIDE_REFRESH_MARGIN_S", 600),
    unknownTimeoutMs: num(env, "UNKNOWN_TIMEOUT_MS", 10 * 60_000),
    continuityBandBps: num(env, "CONTINUITY_BAND_BPS", 500),
    continuityMaxAgeMs: num(env, "CONTINUITY_MAX_AGE_MS", 15 * 60_000),
    calendarGraceMs: num(env, "CALENDAR_GRACE_MS", 90_000),
    feedQuotesPerUi: env.FEED_QUOTES_PER_UI !== "false",
    multiplierHoldMs: num(env, "MULTIPLIER_HOLD_MS", 60 * 60_000),
    oracleUpdateIntervalMs: num(env, "ORACLE_UPDATE_INTERVAL_MS", 60_000),
    rebase: (env.REBASE ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
