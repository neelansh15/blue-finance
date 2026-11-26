// Demo control CLI. Sends txs by default; pass --dry-run to only print.
//   regime set <asset|global> <EXTENDED|CLOSED|WEEKEND|HALTED|CORP_ACTION> [--duration 3600]   (never OPEN; global = address(0))
//   regime clear <asset|global>            (registry: admin always, keeper only if keeperCanClear)
//   multiplier <mockBStock> <value> [--at <unix ts>]   e.g. 2 or 1.000725 (18-dec); --raw for a raw integer.
//                                          without --at: setUIMultiplierNow, with --at: setUIMultiplier(value, ts)
//   oracle update <blueOracle>             permissionless heartbeat
//   price <mockFeed> <value> [--decimals 8]  e.g. 245.5
// Env: RPC_URL, CHAIN_ID(56), REGIME_REGISTRY (regime cmds), DEMO_PRIVATE_KEY or KEEPER_PRIVATE_KEY
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { parseUnits, type Hex } from "viem";
import { REGIME_NAMES, Regime, blueOracleAbi, mockAtlasFeedAbi, mockBStockAbi, regimeRegistryAbi, type RegimeName } from "./abi.js";
import { makeClients } from "./chain.js";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const isAddr = (s: string | undefined): s is `0x${string}` => !!s && /^0x[0-9a-fA-F]{40}$/.test(s);

export type DemoCall =
  | { address: `0x${string}`; abi: typeof regimeRegistryAbi; functionName: "setOverride"; args: readonly [`0x${string}`, number, bigint] }
  | { address: `0x${string}`; abi: typeof regimeRegistryAbi; functionName: "clearOverride"; args: readonly [`0x${string}`] }
  | { address: `0x${string}`; abi: typeof mockBStockAbi; functionName: "setUIMultiplierNow"; args: readonly [bigint] }
  | { address: `0x${string}`; abi: typeof mockBStockAbi; functionName: "setUIMultiplier"; args: readonly [bigint, bigint] }
  | { address: `0x${string}`; abi: typeof blueOracleAbi; functionName: "update"; args: readonly [] }
  | { address: `0x${string}`; abi: typeof mockAtlasFeedAbi; functionName: "setAnswer"; args: readonly [bigint] };

/** Pure: argv + registry -> the call to make. */
export function buildCall(argv: string[], registry?: string): DemoCall {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { duration: { type: "string" }, raw: { type: "boolean" }, decimals: { type: "string" }, at: { type: "string" }, "dry-run": { type: "boolean" } },
  });
  const [cmd, a, b] = positionals;
  if (cmd === "regime") {
    if (!isAddr(registry)) throw new Error("REGIME_REGISTRY env required");
    if (a === "set") {
      const asset = positionals[2] === "global" ? ZERO : positionals[2];
      const name = positionals[3] as RegimeName | undefined;
      if (!isAddr(asset) || !name || !REGIME_NAMES.includes(name)) throw new Error("usage: regime set <asset|global> <REGIME> [--duration s]");
      if (name === "OPEN") throw new Error("registry rejects an OPEN override (InvalidRegime); use regime clear");
      const dur = BigInt(values.duration ?? "3600");
      return { address: registry, abi: regimeRegistryAbi, functionName: "setOverride", args: [asset, Regime[name], dur] };
    }
    if (a === "clear") {
      const asset = b === "global" ? ZERO : b;
      if (!isAddr(asset)) throw new Error("usage: regime clear <asset|global>");
      return { address: registry, abi: regimeRegistryAbi, functionName: "clearOverride", args: [asset] };
    }
  }
  if (cmd === "multiplier") {
    if (!isAddr(a) || !b) throw new Error("usage: multiplier <mockBStock> <value>");
    const m = values.raw ? BigInt(b) : parseUnits(b, 18);
    if (values.at !== undefined) return { address: a, abi: mockBStockAbi, functionName: "setUIMultiplier", args: [m, BigInt(values.at)] };
    return { address: a, abi: mockBStockAbi, functionName: "setUIMultiplierNow", args: [m] };
  }
  if (cmd === "oracle") {
    if (a !== "update" || !isAddr(b)) throw new Error("usage: oracle update <blueOracle>");
    return { address: b, abi: blueOracleAbi, functionName: "update", args: [] };
  }
  if (cmd === "price") {
    if (!isAddr(a) || !b) throw new Error("usage: price <mockFeed> <value> [--decimals 8]");
    return { address: a, abi: mockAtlasFeedAbi, functionName: "setAnswer", args: [parseUnits(b, Number(values.decimals ?? "8"))] };
  }
  throw new Error("commands: regime set|clear, multiplier, price, oracle update");
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry-run");
  const call = buildCall(argv, process.env.REGIME_REGISTRY);
  const printable = JSON.stringify({ to: call.address, fn: call.functionName, args: call.args }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  if (dry) return console.log("DRY RUN", printable);
  const pk = (process.env.DEMO_PRIVATE_KEY ?? process.env.KEEPER_PRIVATE_KEY) as Hex | undefined;
  if (!pk || !process.env.RPC_URL) throw new Error("RPC_URL and DEMO_PRIVATE_KEY (or KEEPER_PRIVATE_KEY) required");
  const { publicClient, walletClient } = makeClients(process.env.RPC_URL, Number(process.env.CHAIN_ID ?? 56), pk);
  const hash = await walletClient!.writeContract({ ...call, account: walletClient!.account!, chain: walletClient!.chain } as never);
  console.log("sent", printable, hash);
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  console.log("status", rc.status, "block", rc.blockNumber);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
