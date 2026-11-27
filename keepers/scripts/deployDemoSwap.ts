// Deploys the demo swap contract and fills it with test tokens in one atomic batch, signed by the demo admin.
// Build first: (cd ../protocol && forge build). Simulates the batch, then serves a local page that hands it to
// the admin's browser wallet through EIP-5792 wallet_sendCalls. Holds no keys. `--check` only simulates.
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  concatHex, encodeAbiParameters, encodeFunctionData, formatEther, getContractAddress, pad, parseAbi, parseEther,
  type Address, type Hex,
} from "viem";
import { makeClients } from "../src/chain.js";

const PORT = 9547;
/** The deterministic deployment proxy: calldata is salt followed by init code. */
const FACTORY: Address = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
const SALT = pad("0x01", { size: 32 });
const url = (path: string) => new URL(path, import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(url(path), "utf8"));

const demo = json("../../frontend/src/lib/blue/demo-deployment.json") as {
  oracle: Address; usdt: Address; controls: Address; stocks: Record<string, [Address, Address]>;
};
const artifact = json("../../protocol/out/DemoSwapRouter.sol/DemoSwapRouter.json") as { bytecode: { object: Hex } };
const abi = parseAbi([
  "function admin() view returns (address)",
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
  "function execute(bytes32 mode, bytes executionCalldata)",
]);

async function main() {
  const { publicClient: pub } = makeClients(process.env.BSC_RPC_URL || "https://bsc-rpc.publicnode.com", 56);
  if ((await pub.getChainId()) !== 56) throw new Error("BNB Smart Chain (56) only");
  const admin = await pub.readContract({ address: demo.controls, abi, functionName: "admin" });
  const init = concatHex([artifact.bytecode.object, encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }], [demo.oracle, demo.usdt, admin])]);
  const router = getContractAddress({ opcode: "CREATE2", from: FACTORY, salt: SALT, bytecode: init });
  const record = "../../frontend/src/lib/blue/demo-swap.json";
  if (process.argv.includes("--record")) {
    writeFileSync(url(record), `${JSON.stringify({ router }, null, 2)}\n`);
    console.log(`Recorded ${router}`);
    return;
  }
  const recorded = (json(record) as { router: Address }).router;
  if (recorded !== router) throw new Error(`the app expects ${recorded} but this build deploys ${router}: run with --record, then commit`);

  const calls: { label: string; to: Address; data: Hex }[] = [];
  const code = await pub.getCode({ address: router });
  const deployed = !!code && code !== "0x";
  if (!deployed) calls.push({ label: "Deploy the demo swap contract", to: FACTORY, data: concatHex([SALT, init]) });
  const inventory: [string, Address, bigint][] = [
    ["mUSDT", demo.usdt, parseEther("1000000")],
    ...Object.entries(demo.stocks).map(([name, [token]]): [string, Address, bigint] => [`m${name}`, token, parseEther("10000")]),
  ];
  for (const [name, token, target] of inventory) {
    const held = await pub.readContract({ address: token, abi, functionName: "balanceOf", args: [router] });
    // Refill only what has run low.
    if (held >= target / 2n) continue;
    calls.push({
      label: `Mint ${formatEther(target - held)} ${name} to it`, to: token,
      data: encodeFunctionData({ abi, functionName: "mint", args: [router, target - held] }),
    });
  }
  if (!calls.length) return console.log(`Ready: ${router} is deployed and stocked. Nothing to sign.`);

  const [sim] = await pub.simulateBlocks({ blocks: [{ calls: calls.map(({ to, data }) => ({ account: admin, to, data })) }] });
  const failed = sim!.calls.findIndex((call) => call.status !== "success");
  if (failed >= 0) throw new Error(`simulation failed at "${calls[failed]!.label}"`);
  console.log(`Simulated ${calls.length} calls from ${admin}: OK. Swap contract: ${router}`);
  if (process.argv.includes("--check")) return;

  const html = page(admin, calls);
  createServer((req, res) => {
    // Only this exact local origin, so another site cannot reach the page through a rebound hostname.
    if (req.headers.host !== `127.0.0.1:${PORT}` || req.url !== "/") return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(html);
  }).listen(PORT, "127.0.0.1", () => console.log(`Open http://127.0.0.1:${PORT} in the browser with MetaMask. Ctrl+C when done.`));
}

function page(admin: Address, calls: { label: string; to: Address; data: Hex }[]): string {
  const data = JSON.stringify({ admin, calls });
  return `<!doctype html><meta charset="utf-8"><title>Deploy the Blue demo swap</title>
<style>body{font:15px system-ui;max-width:760px;margin:40px auto;padding:0 16px}code{font-size:13px;word-break:break-all}button{font:inherit;padding:10px 18px}pre{white-space:pre-wrap}</style>
<h1>Deploy the demo swap</h1>
<p>Sign with the admin: <code>${admin}</code>, BNB Smart Chain. One atomic batch, ${calls.length} calls. Test tokens only; you pay BNB gas.</p>
<ol>${calls.map((c) => `<li>${c.label}<br><code>${c.to}</code></li>`).join("")}</ol>
<button id="go">Connect and sign batch</button><pre id="log"></pre>
<script>
const { admin, calls } = ${data};
const log = (m) => (document.getElementById("log").textContent += m + "\\n");
const button = document.getElementById("go");
button.onclick = async () => {
  button.disabled = true;
  try {
    const eth = window.ethereum;
    if (!eth) throw new Error("No browser wallet found");
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    const from = accounts.find((a) => a.toLowerCase() === admin.toLowerCase());
    if (!from) throw new Error("Connect the admin account " + admin + " (connected: " + accounts.join(", ") + ")");
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
    log("Confirm the batch in your wallet...");
    const sent = await eth.request({ method: "wallet_sendCalls", params: [{ version: "2.0.0", chainId: "0x38", from, atomicRequired: true, calls: calls.map((c) => ({ to: c.to, data: c.data, value: "0x0" })) }] });
    const id = typeof sent === "string" ? sent : sent.id;
    log("Submitted. Batch id " + id);
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await eth.request({ method: "wallet_getCallsStatus", params: [id] });
      if (s.status === 100 || s.status === "PENDING") continue;
      for (const r of s.receipts || []) log("Transaction " + r.transactionHash);
      log(s.status === 200 || s.status === "CONFIRMED" ? "Done. Reload the app." : "Batch failed with status " + s.status);
      return;
    }
    log("Still pending. Check your wallet.");
  } catch (e) {
    log("Error: " + (e.message || JSON.stringify(e)));
    button.disabled = false;
  }
};
</script>`;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
