// Keeper for the Blue Aave pool on BNB Chain. DRY_RUN defaults ON: intended txs are logged, none are sent.
//
// It only ever sends StockPriceSource.refresh(), StockBorrowControls.report() and MarketCalendar.setOverride().
// It never calls suspend() and never sets CORP_ACTION, because both stop liquidations; a person decides those.
// Risk API scores are only logged unless RISK_ACTIONS=true, and then they can only tighten (see riskPolicy.ts).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { BaseError, ContractFunctionRevertedError, parseAbi, type Address } from "viem";
import { makeClients } from "./chain.js";
import { BinanceBapiSource } from "./halt/binanceBapi.js";
import { NasdaqHaltSource } from "./halt/nasdaq.js";
import type { AssetRef, HaltSource, Signal } from "./halt/types.js";
import { LEVEL_STATUS, RiskLevel, RiskTracker, parseOverview, type RiskPolicy } from "./riskPolicy.js";

interface DemoDeployment {
  controls: Address;
  calendar: Address;
  usdtSource: Address;
  stocks: Record<string, [token: Address, source: Address]>;
}

/** BLUE_DEPLOYMENT=demo watches the demo pool recorded by protocol/script/deploy-demo.sh instead of the live one. */
function loadDemo(): DemoDeployment | undefined {
  if (process.env.BLUE_DEPLOYMENT !== "demo") return undefined;
  const file = new URL("../../frontend/src/lib/blue/demo-deployment.json", import.meta.url);
  const demo = JSON.parse(readFileSync(file, "utf8")) as DemoDeployment | null;
  if (!demo) throw new Error("no demo pool is recorded yet: run protocol/script/deploy-demo.sh first");
  return demo;
}

const demo = loadDemo();

export const BLUE: Record<"controls" | "calendar" | "usdtSource", Address> = demo ?? {
  controls: "0x9F80DEe6652798855133358a382264986C2A5d4D",
  calendar: "0x33CcEcEDA8f2f47BdE9f234FF025977aeB292B17",
  usdtSource: "0xe3329b970Acf9545496786B77aa73639E3F4b489",
};

/** The wallet appointed as keeper and guardian. */
export const DEFAULT_KEEPER: Address = "0x68c09dcC4d11D7974BA3E8e96D69CED9C31e733A";

export interface BlueAsset extends AssetRef {
  source: Address;
  /** The real bStock, used for market status. In the demo pool `token` is a stand-in Binance does not know. */
  listedToken: Address;
}

const asset = (symbol: string, ticker: string, listedToken: Address, source: Address): BlueAsset => {
  const stand = demo?.stocks[symbol];
  return { symbol, ticker, token: stand?.[0] ?? listedToken, listedToken, source: stand?.[1] ?? source };
};

export const ASSETS: BlueAsset[] = [
  asset("TSLAB", "TSLA", "0x5b1910eAaD6450E50f816082Aa078C41F10C292f", "0x2162Ba3A993BC8442CEE02340693D1818bbB6826"),
  asset("NVDAB", "NVDA", "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", "0xE28c1AFf5549CBAD6e7Dfb09C7446CC8EDA6Cb3D"),
  asset("QQQB", "QQQ", "0x205812CdBed920aFf76C6580abD681a46D11efc7", "0xC0a4c6fb4dF398c64B48b19898e5BE1375a83c67"),
  asset("SPCXB", "SPCX", "0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1", "0x57569eEDA113AF59BFcEfd549610AF6692fD0772"),
  asset("GOOGLB", "GOOGL", "0x3F53De71c126BdaBAe20f9cD64848d317f6C3238", "0x289Ae6026ae1a9E02fC4dC964861e72473E5f28e"),
];

export const controlsAbi = parseAbi([
  "function keeper() view returns (address)",
  "function report(address stock, bool healthy)",
  "function riskLimits(address stock) view returns (uint256 ltv, uint256 cap)",
  "error Unauthorized()",
  "error UnknownStock()",
  "error NewRiskBlocked(address stock)",
]);
export const calendarAbi = parseAbi([
  "function isKeeper(address) view returns (bool)",
  "function status(address asset) view returns (uint8)",
  "function overrideOf(address asset) view returns (uint8 state, uint64 expiry)",
  "function setOverride(address asset, uint8 state, uint64 duration)",
  "error Unauthorized()",
  "error InvalidDuration()",
  "error NotMoreConservative()",
]);
export const sourceAbi = parseAbi([
  "function reporter() view returns (address)",
  "function suspended() view returns (bool)",
  "function usableForBorrow() view returns (bool)",
  "function refresh()",
  "error Unauthorized()",
  "error InvalidRound()",
  "error UnusablePrice()",
  "error DiscontinuousPrice()",
]);

/** MarketStatus.HALTED. Statuses from here up block borrowing. */
export const HALTED = 4;

export type Health = "ok" | "halted" | "unknown";

/** A halt or corporate action from any source wins; otherwise any unknown source means we cannot vouch. */
export function combine(signals: Signal[]): Health {
  if (signals.some((s) => s.state === "halted" || s.state === "corp_action")) return "halted";
  if (signals.length === 0 || signals.some((s) => s.state === "unknown")) return "unknown";
  return "ok";
}

export interface StockState {
  /** Effective calendar status, 0..5. */
  status: number;
  override: { state: number; expiry: number };
}

export interface PlanInput {
  health: Health;
  state: StockState;
  /** Stock and USDT sources are both usable for borrowing, or will be after a planned refresh. */
  pricesReady: boolean;
  lastReportS: number | undefined;
  nowS: number;
  reportIntervalS: number;
  overrideDurationS: number;
  overrideMarginS: number;
  /** Confirmed risk level; absent when the API may not act. */
  risk?: RiskLevel;
  /** The pause for this risk episode is already onchain. */
  paused?: boolean;
}

export type StockAction =
  | { kind: "halt"; durationS: number }
  | { kind: "report" }
  /** report(false) once, then no heartbeat while the risk stays critical. */
  | { kind: "pause" }
  /** Not a tx: why no heartbeat goes out, so borrowing closes when the last one lapses. */
  | { kind: "skip"; why: string };

export function planStock(i: PlanInput): StockAction | null {
  if (i.health === "halted") {
    const { state, expiry } = i.state.override;
    const covered = state >= HALTED && expiry - i.nowS > i.overrideMarginS;
    return covered ? null : { kind: "halt", durationS: i.overrideDurationS };
  }
  if (i.risk === RiskLevel.pause) return i.paused ? { kind: "skip", why: "risk is critical" } : { kind: "pause" };
  if (i.health === "unknown") return { kind: "skip", why: "a market-status source is unknown" };
  if (i.state.status >= HALTED) return { kind: "skip", why: "a halt or corporate-action override is active" };
  if (!i.pricesReady) return { kind: "skip", why: "stock or USDT price is not usable for borrowing" };
  if (i.lastReportS !== undefined && i.nowS - i.lastReportS < i.reportIntervalS) return null;
  return { kind: "report" };
}

/**
 * The stricter status to set for a risk level, or null when none is needed: no tightening level, a halt (which
 * outranks it), an override that already covers it, or a calendar session that is already as strict.
 */
export function planTighten(i: PlanInput): { status: number; durationS: number } | null {
  const status = i.risk === undefined ? undefined : LEVEL_STATUS[i.risk];
  if (status === undefined || i.health === "halted") return null;
  const { state, expiry } = i.state.override;
  const overridden = expiry > i.nowS && state >= status;
  if (overridden ? expiry - i.nowS > i.overrideMarginS : i.state.status >= status) return null;
  return { status, durationS: i.overrideDurationS };
}

export interface Config {
  rpcUrl: string;
  keeper: Address;
  privateKey?: `0x${string}`;
  dryRun: boolean;
  pollMs: number;
  reportIntervalS: number;
  overrideDurationS: number;
  overrideMarginS: number;
  riskApiUrl?: string;
  riskPollS: number;
  /** Present only when risk scores may cause transactions. */
  risk?: RiskPolicy;
}

/** The controls reject a heartbeat gap of 10 minutes or more. */
const HEARTBEAT_S = 600;

export function loadBlueConfig(env: Record<string, string | undefined> = process.env): Config {
  const num = (k: string, d: number) => {
    const v = env[k];
    if (!v) return d;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`bad number for ${k}: ${v}`);
    return n;
  };
  const keeper = env.KEEPER_ADDRESS || DEFAULT_KEEPER;
  if (!/^0x[0-9a-fA-F]{40}$/.test(keeper)) throw new Error("KEEPER_ADDRESS invalid");
  const privateKey = env.KEEPER_PRIVATE_KEY || undefined;
  if (privateKey && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("KEEPER_PRIVATE_KEY must be 0x + 64 hex");
  const dryRun = !(env.DRY_RUN === "false" || env.DRY_RUN === "0");
  if (!dryRun && !privateKey) throw new Error("DRY_RUN=false requires KEEPER_PRIVATE_KEY");
  const cfg: Config = {
    rpcUrl: env.RPC_URL || "https://bsc-rpc.publicnode.com",
    keeper: keeper as Address,
    privateKey: privateKey as `0x${string}` | undefined,
    dryRun,
    pollMs: num("POLL_INTERVAL_MS", 30_000),
    reportIntervalS: num("REPORT_INTERVAL_S", 300),
    overrideDurationS: num("OVERRIDE_DURATION_S", 3600),
    overrideMarginS: num("OVERRIDE_REFRESH_MARGIN_S", 600),
    riskApiUrl: env.RISK_API_URL || undefined,
    riskPollS: num("RISK_POLL_S", 300),
  };
  if (env.RISK_ACTIONS === "true") {
    if (!cfg.riskApiUrl) throw new Error("RISK_ACTIONS=true requires RISK_API_URL");
    const allowSimulated = env.RISK_ALLOW_SIMULATED === "true";
    if (allowSimulated && env.BLUE_DEPLOYMENT !== "demo") throw new Error("RISK_ALLOW_SIMULATED is for the demo pool only (BLUE_DEPLOYMENT=demo)");
    const confirmations = num("RISK_CONFIRMATIONS", 3);
    if (!Number.isInteger(confirmations)) throw new Error("RISK_CONFIRMATIONS must be a whole number");
    const maxAgeS = num("RISK_MAX_AGE_S", 900);
    if (maxAgeS <= cfg.riskPollS) throw new Error("RISK_MAX_AGE_S must be longer than RISK_POLL_S");
    cfg.risk = { confirmations, maxAgeMs: maxAgeS * 1000, allowSimulated };
  }
  if (cfg.reportIntervalS + (2 * cfg.pollMs) / 1000 >= HEARTBEAT_S) throw new Error("REPORT_INTERVAL_S plus two polls must stay under the 600 s heartbeat");
  if (cfg.overrideMarginS >= cfg.overrideDurationS) throw new Error("OVERRIDE_REFRESH_MARGIN_S must be shorter than OVERRIDE_DURATION_S");
  return cfg;
}

export type Logger = (event: string, data?: Record<string, unknown>) => void;
const jsonLogger: Logger = (event, data) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

/** The contract error name when there is one, so logs read "InvalidRound" rather than a stack of RPC text. */
export function revertName(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? r.shortMessage;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

export interface Call {
  address: Address;
  abi: typeof controlsAbi | typeof calendarAbi | typeof sourceAbi;
  functionName: string;
  args?: readonly unknown[];
}

export interface Chain {
  stockState(token: Address): Promise<StockState>;
  usable(source: Address): Promise<boolean>;
  /** Roles `keeper` still lacks. Empty means it can send everything. */
  missingRoles(keeper: Address): Promise<string[]>;
  /** eth_call as `from`; throws if the call would revert. */
  simulate(call: Call, from: Address): Promise<void>;
  /** Sends from the keeper wallet and throws unless the receipt succeeds. */
  send(call: Call): Promise<string>;
  /** The address currently holding the role a call needs. */
  roleHolder(call: Call): Promise<Address>;
}

export interface Deps {
  cfg: Config;
  chain: Chain;
  sources: HaltSource[];
  assets: BlueAsset[];
  lastReport: Map<string, number>;
  /** Present only when risk scores may cause transactions. */
  risk?: RiskTracker;
  log: Logger;
  nowMs: () => number;
}

/** Dry run simulates as the current role holder, so the result shows what happens once the keeper is appointed. */
async function execute(d: Deps, call: Call, label: Record<string, unknown>): Promise<boolean> {
  const info = { ...label, call: call.functionName, to: call.address, args: call.args };
  try {
    await d.chain.simulate(call, d.cfg.dryRun ? await d.chain.roleHolder(call) : d.cfg.keeper);
    if (d.cfg.dryRun) d.log("dry_run_tx", info);
    else d.log("tx_sent", { ...info, hash: await d.chain.send(call) });
    return true;
  } catch (e) {
    d.log("tx_rejected", { ...info, error: revertName(e) });
    return false;
  }
}

/** Accepts a new feed round when the accepted one no longer passes. Returns whether the source is, or would be, usable. */
export async function refreshSource(d: Deps, source: Address, symbol: string): Promise<boolean> {
  try {
    if (await d.chain.usable(source)) return true;
  } catch (e) {
    d.log("read_failed", { asset: symbol, error: revertName(e) });
    return false;
  }
  return execute(d, { address: source, abi: sourceAbi, functionName: "refresh" }, { asset: symbol });
}

export async function tick(d: Deps): Promise<void> {
  const missing = await d.chain.missingRoles(d.cfg.keeper);
  if (missing.length) {
    d.log("missing_roles", { keeper: d.cfg.keeper, missing });
    if (!d.cfg.dryRun) return;
  }
  const usdtReady = await refreshSource(d, BLUE.usdtSource, "USDT");
  for (const a of d.assets) {
    try {
      const nowMs = d.nowMs();
      const signals = await Promise.all(
        d.sources.map(async (s): Promise<Signal & { source: string }> => {
          try {
            return { source: s.name, ...(await s.check({ ...a, token: a.listedToken }, nowMs)) };
          } catch (e) {
            return { source: s.name, state: "unknown", detail: revertName(e) };
          }
        }),
      );
      const health = combine(signals);
      const bad = signals.filter((s) => s.state !== "ok");
      if (bad.length) d.log(bad.some((s) => s.state === "corp_action") ? "corp_action_needs_review" : "signal", { asset: a.symbol, signals: bad });

      const priceReady = health === "ok" && (await refreshSource(d, a.source, a.symbol));
      const state = await d.chain.stockState(a.token);
      const key = a.token.toLowerCase();
      const level = d.risk?.level(a.symbol, d.nowMs());
      if (level !== RiskLevel.pause) d.risk?.paused.delete(a.symbol);
      const input: PlanInput = {
        health,
        state,
        pricesReady: usdtReady && priceReady,
        lastReportS: d.lastReport.get(key),
        nowS: Math.floor(d.nowMs() / 1000),
        reportIntervalS: d.cfg.reportIntervalS,
        overrideDurationS: d.cfg.overrideDurationS,
        overrideMarginS: d.cfg.overrideMarginS,
        risk: level,
        paused: d.risk?.paused.has(a.symbol),
      };
      const override = (status: number, durationS: number): Call => ({ address: BLUE.calendar, abi: calendarAbi, functionName: "setOverride", args: [a.token, status, BigInt(durationS)] });
      const tighten = planTighten(input);
      if (tighten) await execute(d, override(tighten.status, tighten.durationS), { asset: a.symbol, reason: "risk" });
      const action = planStock(input);
      if (!action) continue;
      if (action.kind === "skip") {
        d.log("no_heartbeat", { asset: a.symbol, why: action.why });
        continue;
      }
      const report = (healthy: boolean): Call => ({ address: BLUE.controls, abi: controlsAbi, functionName: "report", args: [a.token, healthy] });
      if (action.kind === "pause") {
        d.lastReport.delete(key);
        if (await execute(d, report(false), { asset: a.symbol, reason: "risk" })) d.risk?.paused.add(a.symbol);
        continue;
      }
      if (action.kind === "halt") {
        d.lastReport.delete(key);
        // If the override is refused, still close new borrowing through the heartbeat.
        if (!(await execute(d, override(HALTED, action.durationS), { asset: a.symbol }))) await execute(d, report(false), { asset: a.symbol });
        continue;
      }
      let sent: boolean;
      if (d.cfg.dryRun && !(await d.chain.usable(a.source) && (await d.chain.usable(BLUE.usdtSource)))) {
        // The refresh was not really sent, so simulating the report now would always revert.
        d.log("dry_run_tx", { asset: a.symbol, call: "report", to: BLUE.controls, args: [a.token, true], note: "not simulated: follows the refresh" });
        sent = true;
      } else {
        sent = await execute(d, report(true), { asset: a.symbol });
      }
      if (sent) d.lastReport.set(key, Math.floor(d.nowMs() / 1000));
    } catch (e) {
      d.log("tick_error", { asset: a.symbol, error: revertName(e) });
    }
  }
}

/** Logs each score and, when risk actions are on, records it. A failure records nothing, so old readings age out. */
export async function pollRisk(d: Pick<Deps, "assets" | "risk" | "log" | "nowMs">, url: string, fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchFn(`${url.replace(/\/$/, "")}/risk/overview`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const readings = parseOverview(await res.json());
    for (const a of d.assets) {
      const r = readings.find((x) => x.aliases.includes(a.symbol));
      if (!r) {
        d.log("risk_missing", { asset: a.symbol });
        continue;
      }
      const ignored = d.risk ? d.risk.add(a.symbol, r, d.nowMs()) : "risk actions are off";
      d.log("risk_advisory", {
        asset: a.symbol,
        category: r.category,
        score: r.score,
        confidence: r.confidence,
        simulated: r.simulated,
        ...(ignored ? { ignored } : { actingLevel: d.risk!.level(a.symbol, d.nowMs()) }),
      });
    }
  } catch (e) {
    d.log("risk_api_unavailable", { error: e instanceof Error ? e.message : String(e) });
  }
}

export function viemChain(cfg: Config): Chain {
  const { publicClient: pub, walletClient: wallet, account } = makeClients(cfg.rpcUrl, 56, cfg.privateKey);
  if (!cfg.dryRun && account?.address.toLowerCase() !== cfg.keeper.toLowerCase()) {
    throw new Error(`KEEPER_PRIVATE_KEY does not belong to keeper ${cfg.keeper}`);
  }
  const controls = { address: BLUE.controls, abi: controlsAbi } as const;
  const calendar = { address: BLUE.calendar, abi: calendarAbi } as const;
  return {
    async stockState(token) {
      const [status, override] = await Promise.all([
        pub.readContract({ ...calendar, functionName: "status", args: [token] }),
        pub.readContract({ ...calendar, functionName: "overrideOf", args: [token] }),
      ]);
      return { status, override: { state: override[0], expiry: Number(override[1]) } };
    },
    usable: (source) => pub.readContract({ address: source, abi: sourceAbi, functionName: "usableForBorrow" }),
    async missingRoles(keeper) {
      const same = (a: string) => a.toLowerCase() === keeper.toLowerCase();
      const [onControls, onCalendar, ...reporters] = await Promise.all([
        pub.readContract({ ...controls, functionName: "keeper" }),
        pub.readContract({ ...calendar, functionName: "isKeeper", args: [keeper] }),
        ...[BLUE.usdtSource, ...ASSETS.map((a) => a.source)].map((address) => pub.readContract({ address, abi: sourceAbi, functionName: "reporter" })),
      ]);
      const names = ["USDT", ...ASSETS.map((a) => a.symbol)];
      return [
        ...(same(onControls) ? [] : ["controls.keeper"]),
        ...(onCalendar ? [] : ["calendar.isKeeper"]),
        ...reporters.flatMap((r, i) => (same(r) ? [] : [`${names[i]} source reporter`])),
      ];
    },
    async roleHolder(call) {
      if (call.functionName === "refresh") return pub.readContract({ address: call.address, abi: sourceAbi, functionName: "reporter" });
      // The controls keeper is also a calendar keeper at deployment.
      return pub.readContract({ ...controls, functionName: "keeper" });
    },
    async simulate(call, from) {
      await pub.simulateContract({ ...call, account: from } as Parameters<typeof pub.simulateContract>[0]);
    },
    async send(call) {
      if (!wallet?.account) throw new Error("no wallet configured");
      const hash = await wallet.writeContract({ ...call, account: wallet.account, chain: wallet.chain } as Parameters<typeof wallet.writeContract>[0]);
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
      return hash;
    },
  };
}

export async function main(env = process.env): Promise<void> {
  const cfg = loadBlueConfig(env);
  const log = jsonLogger;
  const deps: Deps = {
    cfg,
    chain: viemChain(cfg),
    sources: [new NasdaqHaltSource(), new BinanceBapiSource()],
    assets: ASSETS,
    lastReport: new Map(),
    risk: cfg.risk && new RiskTracker(cfg.risk),
    log,
    nowMs: Date.now,
  };
  const once = process.argv.includes("--once");
  log("start", { dryRun: cfg.dryRun, keeper: cfg.keeper, assets: ASSETS.map((a) => a.symbol), pollMs: cfg.pollMs, risk: cfg.risk ?? "log only" });
  let stop = false;
  process.on("SIGINT", () => (stop = true));
  process.on("SIGTERM", () => (stop = true));
  let advisoryAt = 0;
  let advisory: Promise<void> | undefined;
  while (!stop) {
    // Runs beside the tick: a slow or sleeping API must not delay a heartbeat.
    if (cfg.riskApiUrl && Date.now() - advisoryAt >= cfg.riskPollS * 1000) {
      advisoryAt = Date.now();
      advisory = pollRisk(deps, cfg.riskApiUrl);
      // A single pass has no later tick to use the answer, so wait for it.
      if (once) await advisory;
    }
    try {
      await tick(deps);
    } catch (e) {
      log("tick_error", { error: revertName(e) });
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
  await advisory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
