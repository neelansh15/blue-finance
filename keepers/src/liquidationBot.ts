// Liquidation bot for one Morpho Blue market whose oracle is a BlueOracle (or any IOracle).
// Discovers borrowers from Borrow events plus a seed list, computes health with the on-chain oracle price(),
// and liquidates through the LiquidatorCallback contract (no flash loan: repay from pre-funded loan token or a swap
// of the seized collateral). DRY_RUN defaults ON; it never liquidates while the oracle isFrozen unless configured.
import { pathToFileURL } from "node:url";
import { encodeAbiParameters, keccak256, type PublicClient, type WalletClient } from "viem";
import { MORPHO_BLUE_BSC, blueOracleAbi, erc20Abi, liquidatorCallbackAbi, morphoAbi } from "./abi.js";
import { makeClients } from "./chain.js";
import { jsonLogger, type Logger } from "./regimeKeeper.js";

type Addr = `0x${string}`;
const isAddr = (s: unknown): s is Addr => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);

export const WAD = 10n ** 18n;
export const ORACLE_PRICE_SCALE = 10n ** 36n;
const VIRTUAL_SHARES = 10n ** 6n;
const VIRTUAL_ASSETS = 1n;
const MAX_LIF = 1_150_000_000_000_000_000n;
const LIQUIDATION_CURSOR = 300_000_000_000_000_000n;

export interface MarketParams {
  loanToken: Addr;
  collateralToken: Addr;
  oracle: Addr;
  irm: Addr;
  lltv: bigint;
}
export interface MarketState {
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
}
export interface Position {
  borrowShares: bigint;
  collateral: bigint;
}

// ---- Morpho math (MathLib / SharesMathLib / UtilsLib, same rounding)
const mulDivDown = (x: bigint, y: bigint, d: bigint) => (x * y) / d;
const mulDivUp = (x: bigint, y: bigint, d: bigint) => (x * y + (d - 1n)) / d;
export const toAssetsUp = (shares: bigint, m: MarketState) => mulDivUp(shares, m.totalBorrowAssets + VIRTUAL_ASSETS, m.totalBorrowShares + VIRTUAL_SHARES);
export const toAssetsDown = (shares: bigint, m: MarketState) => mulDivDown(shares, m.totalBorrowAssets + VIRTUAL_ASSETS, m.totalBorrowShares + VIRTUAL_SHARES);
export const toSharesUp = (assets: bigint, m: MarketState) => mulDivUp(assets, m.totalBorrowShares + VIRTUAL_SHARES, m.totalBorrowAssets + VIRTUAL_ASSETS);

export function marketId(p: MarketParams): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv],
    ),
  );
}

/** Liquidation incentive factor: min(1.15, 1 / (1 - 0.3 * (1 - lltv))). */
export function liquidationIncentiveFactor(lltv: bigint): bigint {
  const denom = WAD - mulDivDown(LIQUIDATION_CURSOR, WAD - lltv, WAD);
  const f = mulDivDown(WAD, WAD, denom);
  return f < MAX_LIF ? f : MAX_LIF;
}

export const borrowedAssets = (pos: Position, m: MarketState) => toAssetsUp(pos.borrowShares, m);

/** Morpho's _isHealthy: collateral * price / 1e36 * lltv / 1e18 >= borrowed. */
export function isHealthy(pos: Position, m: MarketState, price: bigint, lltv: bigint): boolean {
  if (pos.borrowShares === 0n) return true;
  const maxBorrow = mulDivDown(mulDivDown(pos.collateral, price, ORACLE_PRICE_SCALE), lltv, WAD);
  return maxBorrow >= borrowedAssets(pos, m);
}

/** Health factor as a float for logs (>=1 healthy). */
export function healthFactor(pos: Position, m: MarketState, price: bigint, lltv: bigint): number {
  const b = borrowedAssets(pos, m);
  if (b === 0n) return Infinity;
  const maxBorrow = mulDivDown(mulDivDown(pos.collateral, price, ORACLE_PRICE_SCALE), lltv, WAD);
  return Number((maxBorrow * 1_000_000n) / b) / 1e6;
}

export interface LiquidationPlan {
  borrower: Addr;
  /** Exactly one of seizedAssets / repaidShares is non-zero (Morpho requires this). */
  seizedAssets: bigint;
  repaidShares: bigint;
  /** Loan token the liquidator must hold or obtain via the swap. */
  repayAssets: bigint;
  /** Value of the seized collateral in loan token at the oracle price. Gross, before swap slippage and gas. */
  seizedValue: bigint;
  profit: bigint;
  health: number;
}
export type PlanResult = { action: "liquidate"; plan: LiquidationPlan } | { action: "skip"; reason: string; borrower: Addr };

export interface PlanCfg {
  minProfit: bigint;
  dustBorrow: bigint;
  /** 0 = unlimited. */
  maxRepay: bigint;
}

/** Pure: decide whether and how to liquidate one position. */
export function planLiquidation(
  borrower: Addr,
  pos: Position,
  m: MarketState,
  price: bigint,
  params: Pick<MarketParams, "lltv">,
  cfg: PlanCfg,
  /** Loan token available for repayment (pre-funded mode). Undefined = not capped by balance (swap mode). */
  available?: bigint,
): PlanResult {
  const skip = (reason: string): PlanResult => ({ action: "skip", reason, borrower });
  if (pos.borrowShares === 0n) return skip("no_debt");
  if (price === 0n) return skip("zero_price");
  if (isHealthy(pos, m, price, params.lltv)) return skip("healthy");
  const borrowed = borrowedAssets(pos, m);
  if (borrowed < cfg.dustBorrow) return skip("dust");
  if (pos.collateral === 0n) return skip("no_collateral");

  const lif = liquidationIncentiveFactor(params.lltv);
  const seizedForShares = (shares: bigint) => mulDivDown(mulDivDown(toAssetsDown(shares, m), lif, WAD), ORACLE_PRICE_SCALE, price);
  const sharesForSeized = (seized: bigint) => {
    const s = toSharesUp(mulDivUp(mulDivUp(seized, price, ORACLE_PRICE_SCALE), WAD, lif), m);
    return s > pos.borrowShares ? pos.borrowShares : s;
  };

  let seizedAssets = 0n;
  let repaidShares = 0n;
  const fullSeized = seizedForShares(pos.borrowShares);
  if (fullSeized <= pos.collateral) repaidShares = pos.borrowShares;
  else seizedAssets = pos.collateral; // bad debt: take all collateral

  let repay = repaidShares ? toAssetsUp(repaidShares, m) : toAssetsUp(sharesForSeized(seizedAssets), m);
  const cap = [cfg.maxRepay > 0n ? cfg.maxRepay : undefined, available].filter((x): x is bigint => x !== undefined).reduce<bigint | undefined>((a, b) => (a === undefined || b < a ? b : a), undefined);
  if (cap !== undefined && repay > cap) {
    if (cap === 0n) return skip("no_repay_funds");
    // Partial liquidation: seize what `cap` of debt buys (round down so the repay never exceeds the cap).
    const bySeize = mulDivDown(mulDivDown(cap, lif, WAD), ORACLE_PRICE_SCALE, price);
    seizedAssets = bySeize < pos.collateral ? bySeize : pos.collateral;
    repaidShares = 0n;
    if (seizedAssets === 0n) return skip("cap_too_small");
    repay = toAssetsUp(sharesForSeized(seizedAssets), m);
    if (repay > cap) return skip("cap_too_small");
  }
  const seized = repaidShares ? fullSeized : seizedAssets;
  const seizedValue = mulDivDown(seized, price, ORACLE_PRICE_SCALE);
  const profit = seizedValue - repay;
  if (profit <= 0n || profit < cfg.minProfit) return skip("unprofitable");
  return {
    action: "liquidate",
    plan: { borrower, seizedAssets, repaidShares, repayAssets: repay, seizedValue, profit, health: healthFactor(pos, m, price, params.lltv) },
  };
}

// ---- chain abstraction (faked in tests)
export interface BotChain {
  headBlock(): Promise<bigint>;
  /** Borrowers (onBehalf) of the market in [from, to]. */
  borrowersBetween(from: bigint, to: bigint): Promise<Addr[]>;
  market(): Promise<MarketState>;
  position(user: Addr): Promise<Position>;
  oraclePrice(): Promise<bigint>;
  /** BlueOracle.isFrozen(); throws if the oracle does not implement it. */
  oracleFrozen(): Promise<boolean>;
  /** Loan token held by the liquidator contract (or the wallet when no callback contract is used). */
  loanBalance(): Promise<bigint>;
  /** Throws if the liquidation would revert (eth_call). */
  simulate(plan: LiquidationPlan): Promise<void>;
  send(plan: LiquidationPlan): Promise<string>;
}

export interface BotConfig {
  rpcUrl: string;
  chainId: number;
  morpho: Addr;
  market: MarketParams;
  /** LiquidatorCallback contract. */
  liquidator: Addr;
  swapper?: Addr;
  swapData: `0x${string}`;
  seedBorrowers: Addr[];
  fromBlock?: bigint;
  /** Max blocks per getLogs call. */
  logChunk: bigint;
  /** On the first scan, look back this many blocks from head when FROM_BLOCK is not set. */
  lookback: bigint;
  privateKey?: `0x${string}`;
  dryRun: boolean;
  minProfit: bigint;
  dustBorrow: bigint;
  maxRepay: bigint;
  liquidateWhenFrozen: boolean;
  pollIntervalMs: number;
}

const need = (env: Record<string, string | undefined>, k: string): string => {
  const v = env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const big = (env: Record<string, string | undefined>, k: string, d: bigint): bigint => {
  const v = env[k];
  if (v === undefined || v === "") return d;
  if (!/^\d+$/.test(v)) throw new Error(`bad integer for ${k}: ${v}`);
  return BigInt(v);
};

/**
 * Env: RPC_URL, CHAIN_ID(56), MORPHO(default Morpho Blue on BSC), MARKET_PARAMS (JSON with loanToken, collateralToken,
 * oracle, irm, lltv), LIQUIDATOR (callback contract), SWAPPER + SWAP_DATA (optional), SEED_BORROWERS (comma list),
 * FROM_BLOCK, LOG_CHUNK(2000), LOOKBACK_BLOCKS(50000), DRY_RUN(true), LIQUIDATOR_PRIVATE_KEY or KEEPER_PRIVATE_KEY,
 * MIN_PROFIT, DUST_BORROW, MAX_REPAY (raw loan token units; 0 = none), LIQUIDATE_WHEN_FROZEN(false), POLL_INTERVAL_MS(15000).
 */
export function loadBotConfig(env: Record<string, string | undefined> = process.env): BotConfig {
  const mp = JSON.parse(need(env, "MARKET_PARAMS")) as Record<string, unknown>;
  for (const k of ["loanToken", "collateralToken", "oracle", "irm"]) if (!isAddr(mp[k])) throw new Error(`MARKET_PARAMS.${k} invalid`);
  if (typeof mp.lltv !== "string" && typeof mp.lltv !== "number") throw new Error("MARKET_PARAMS.lltv invalid");
  const morpho = env.MORPHO ?? MORPHO_BLUE_BSC;
  const liquidator = need(env, "LIQUIDATOR");
  if (!isAddr(morpho)) throw new Error("MORPHO invalid");
  if (!isAddr(liquidator)) throw new Error("LIQUIDATOR invalid");
  if (env.SWAPPER && !isAddr(env.SWAPPER)) throw new Error("SWAPPER invalid");
  const seed = (env.SEED_BORROWERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const s of seed) if (!isAddr(s)) throw new Error(`SEED_BORROWERS entry invalid: ${s}`);
  const pk = env.LIQUIDATOR_PRIVATE_KEY ?? env.KEEPER_PRIVATE_KEY;
  if (pk && !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("private key must be 0x + 64 hex");
  const dryRun = !(env.DRY_RUN === "false" || env.DRY_RUN === "0");
  if (!dryRun && !pk) throw new Error("DRY_RUN=false requires LIQUIDATOR_PRIVATE_KEY or KEEPER_PRIVATE_KEY");
  return {
    rpcUrl: need(env, "RPC_URL"),
    chainId: Number(env.CHAIN_ID ?? 56),
    morpho,
    market: { loanToken: mp.loanToken as Addr, collateralToken: mp.collateralToken as Addr, oracle: mp.oracle as Addr, irm: mp.irm as Addr, lltv: BigInt(mp.lltv) },
    liquidator,
    swapper: env.SWAPPER as Addr | undefined,
    swapData: (env.SWAP_DATA ?? "0x") as `0x${string}`,
    seedBorrowers: seed as Addr[],
    fromBlock: env.FROM_BLOCK ? BigInt(env.FROM_BLOCK) : undefined,
    logChunk: big(env, "LOG_CHUNK", 2000n),
    lookback: big(env, "LOOKBACK_BLOCKS", 50_000n),
    privateKey: pk as `0x${string}` | undefined,
    dryRun,
    minProfit: big(env, "MIN_PROFIT", 0n),
    dustBorrow: big(env, "DUST_BORROW", 0n),
    maxRepay: big(env, "MAX_REPAY", 0n),
    liquidateWhenFrozen: env.LIQUIDATE_WHEN_FROZEN === "true",
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 15_000),
  };
}

export function viemBotChain(cfg: BotConfig, pub: PublicClient, wallet: WalletClient | undefined): BotChain {
  const id = marketId(cfg.market);
  const call = (p: LiquidationPlan) => ({
    address: cfg.liquidator,
    abi: liquidatorCallbackAbi,
    functionName: "liquidate" as const,
    args: [cfg.market, p.borrower, p.seizedAssets, p.repaidShares, cfg.swapper ?? "0x0000000000000000000000000000000000000000", cfg.swapData] as const,
  });
  return {
    headBlock: () => pub.getBlockNumber(),
    async borrowersBetween(from, to) {
      const logs = await pub.getContractEvents({ address: cfg.morpho, abi: morphoAbi, eventName: "Borrow", args: { id }, fromBlock: from, toBlock: to });
      return logs.map((l) => l.args.onBehalf).filter((a): a is Addr => !!a);
    },
    async market() {
      const m = await pub.readContract({ address: cfg.morpho, abi: morphoAbi, functionName: "market", args: [id] });
      return { totalBorrowAssets: m[2], totalBorrowShares: m[3] };
    },
    async position(user) {
      const p = await pub.readContract({ address: cfg.morpho, abi: morphoAbi, functionName: "position", args: [id, user] });
      return { borrowShares: p[1], collateral: p[2] };
    },
    oraclePrice: () => pub.readContract({ address: cfg.market.oracle, abi: blueOracleAbi, functionName: "price" }),
    oracleFrozen: () => pub.readContract({ address: cfg.market.oracle, abi: blueOracleAbi, functionName: "isFrozen" }),
    loanBalance: () => pub.readContract({ address: cfg.market.loanToken, abi: erc20Abi, functionName: "balanceOf", args: [cfg.liquidator] }),
    async simulate(p) {
      await pub.simulateContract({ ...call(p), account: wallet?.account });
    },
    async send(p) {
      if (!wallet?.account) throw new Error("no wallet configured");
      const hash = await wallet.writeContract({ ...call(p), account: wallet.account, chain: wallet.chain });
      await pub.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

export interface BotDeps {
  cfg: Pick<BotConfig, "market" | "seedBorrowers" | "fromBlock" | "logChunk" | "lookback" | "dryRun" | "minProfit" | "dustBorrow" | "maxRepay" | "liquidateWhenFrozen"> & Partial<Pick<BotConfig, "swapper">>;
  chain: BotChain;
  log: Logger;
}

export type TickOutcome = { borrower: Addr; result: "dry_run" | "sent" | "failed" | "sim_failed" | "skipped"; reason?: string; plan?: LiquidationPlan };

/** Blocks re-scanned on every discovery pass (reorg / head-regression safety). */
export const REORG_OVERLAP = 6n;

export class LiquidationBot {
  readonly borrowers = new Set<string>();
  private lastBlock: bigint | undefined;
  constructor(private readonly d: BotDeps) {
    for (const s of d.cfg.seedBorrowers) this.borrowers.add(s.toLowerCase());
  }

  /** Scan Borrow events since the last scan (chunked) and remember the borrowers. */
  async discover(): Promise<number> {
    const { chain, cfg } = this.d;
    const head = await chain.headBlock();
    // Rescan a few blocks behind the last scan: the head can move backwards (reorg, anvil evm_revert, load-balanced RPC lagging),
    // and a Borrow in a block we already "scanned" on the old branch would otherwise be missed forever.
    const floor = cfg.fromBlock ?? (head > cfg.lookback ? head - cfg.lookback : 0n);
    const last = this.lastBlock !== undefined && this.lastBlock > head ? head : this.lastBlock;
    let from = last !== undefined ? (last >= REORG_OVERLAP ? last - REORG_OVERLAP + 1n : 0n) : floor;
    if (from < floor) from = floor;
    let found = 0;
    while (from <= head) {
      const to = from + cfg.logChunk - 1n < head ? from + cfg.logChunk - 1n : head;
      for (const b of await chain.borrowersBetween(from, to)) {
        if (!this.borrowers.has(b.toLowerCase())) found++;
        this.borrowers.add(b.toLowerCase());
      }
      from = to + 1n;
    }
    this.lastBlock = head; // only advanced after every chunk succeeded, so a failure retries the range
    return found;
  }

  async tick(): Promise<TickOutcome[]> {
    const { chain, cfg, log } = this.d;
    try {
      const n = await this.discover();
      if (n) log("borrowers_discovered", { new: n, total: this.borrowers.size });
    } catch (e) {
      log("discover_failed", { error: String(e) }); // keep going with the known set
    }
    const price = await chain.oraclePrice();
    if (!cfg.liquidateWhenFrozen) {
      let frozen: boolean;
      try {
        frozen = await chain.oracleFrozen();
      } catch (e) {
        log("oracle_frozen_unknown_skip", { error: String(e) });
        return [];
      }
      if (frozen) {
        log("oracle_frozen_skip", { price });
        return [];
      }
    }
    const market = await chain.market();
    const available = cfg.swapper ? undefined : await chain.loanBalance();
    const planCfg: PlanCfg = { minProfit: cfg.minProfit, dustBorrow: cfg.dustBorrow, maxRepay: cfg.maxRepay };
    const plans: LiquidationPlan[] = [];
    const out: TickOutcome[] = [];
    for (const b of this.borrowers) {
      const borrower = b as Addr;
      let pos: Position;
      try {
        pos = await chain.position(borrower);
      } catch (e) {
        log("position_failed", { borrower, error: String(e) });
        continue;
      }
      if (pos.borrowShares === 0n) {
        this.borrowers.delete(b); // re-added by a future Borrow event
        continue;
      }
      const r = planLiquidation(borrower, pos, market, price, cfg.market, planCfg, available);
      if (r.action === "skip") {
        if (r.reason !== "healthy") log("skip", { borrower, reason: r.reason });
        out.push({ borrower, result: "skipped", reason: r.reason });
      } else plans.push(r.plan);
    }
    plans.sort((a, b) => (b.profit > a.profit ? 1 : b.profit < a.profit ? -1 : 0));
    let remaining = available;
    for (const plan of plans) {
      if (remaining !== undefined && plan.repayAssets > remaining) {
        log("skip", { borrower: plan.borrower, reason: "insufficient_balance_after_earlier_liquidations" });
        out.push({ borrower: plan.borrower, result: "skipped", reason: "insufficient_balance" });
        continue;
      }
      if (cfg.dryRun) {
        log("dry_run_liquidation", { ...plan });
        out.push({ borrower: plan.borrower, result: "dry_run", plan });
        if (remaining !== undefined) remaining -= plan.repayAssets;
        continue;
      }
      try {
        await chain.simulate(plan);
      } catch (e) {
        log("liquidation_sim_failed", { borrower: plan.borrower, error: String(e) });
        out.push({ borrower: plan.borrower, result: "sim_failed", plan });
        continue;
      }
      try {
        const hash = await chain.send(plan);
        log("liquidation_sent", { ...plan, hash });
        out.push({ borrower: plan.borrower, result: "sent", plan });
        if (remaining !== undefined) remaining -= plan.repayAssets;
      } catch (e) {
        log("liquidation_failed", { borrower: plan.borrower, error: String(e) });
        out.push({ borrower: plan.borrower, result: "failed", plan });
      }
    }
    return out;
  }
}

export async function main(env = process.env): Promise<void> {
  const cfg = loadBotConfig(env);
  const { publicClient, walletClient } = makeClients(cfg.rpcUrl, cfg.chainId, cfg.privateKey);
  const bot = new LiquidationBot({ cfg, chain: viemBotChain(cfg, publicClient, walletClient), log: jsonLogger });
  jsonLogger("start", { dryRun: cfg.dryRun, morpho: cfg.morpho, marketId: marketId(cfg.market), liquidator: cfg.liquidator, whenFrozen: cfg.liquidateWhenFrozen });
  let stop = false;
  process.on("SIGINT", () => (stop = true));
  process.on("SIGTERM", () => (stop = true));
  while (!stop) {
    try {
      await bot.tick();
    } catch (e) {
      jsonLogger("tick_error", { error: String(e) });
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
