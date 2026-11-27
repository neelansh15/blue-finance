// Moves both the keeper and guardian roles to one wallet in a single atomic batch, signed by the admin.
// Reads the chain, simulates the batch, then serves a local page that hands it to the admin's browser wallet
// through EIP-5792 wallet_sendCalls. Holds no keys and sends nothing itself. `--check` only simulates and verifies.
import { createServer } from "node:http";
import { concatHex, encodeAbiParameters, encodeFunctionData, getAddress, padHex, parseAbi, type Address, type Hex } from "viem";
import { ASSETS, BLUE } from "../src/blueKeeper.js";
import { makeClients } from "../src/chain.js";

const NEW_ROLE_HOLDER = getAddress("0x68c09dcC4d11D7974BA3E8e96D69CED9C31e733A");
/** Compromised on 2026-11-27: its key is in someone else's hands. It must end up with no role. */
const COMPROMISED = getAddress("0x08DcE649f86AF45dA8648FaD31D1C33A617C52d1");
const PORT = 9546;

const abi = parseAbi([
  "function admin() view returns (address)",
  "function keeper() view returns (address)",
  "function guardian() view returns (address)",
  "function signer() view returns (address)",
  "function reporter() view returns (address)",
  "function isKeeper(address) view returns (bool)",
  "function setKeeper(address keeper, bool enabled)",
  "function setRoles(address keeper, address guardian, address signer)",
  "function execute(bytes32 mode, bytes executionCalldata)",
]);
const sourceAbi = parseAbi(["function setRoles(address reporter, address guardian)"]);

const { publicClient: pub } = makeClients(process.env.BSC_RPC_URL || "https://bsc-rpc.publicnode.com", 56);
const sources = [{ name: "USDT", address: BLUE.usdtSource as Address }, ...ASSETS.map((a) => ({ name: a.symbol, address: a.source }))];
const read = (address: Address, functionName: "admin" | "keeper" | "guardian" | "signer" | "reporter") =>
  pub.readContract({ address, abi, functionName });
const isKeeper = (who: Address) => pub.readContract({ address: BLUE.calendar, abi, functionName: "isKeeper", args: [who] });

async function roleProblems(): Promise<string[]> {
  const bad: string[] = [];
  const expect = (label: string, actual: string) => {
    if (actual !== NEW_ROLE_HOLDER) bad.push(`${label} is ${actual}`);
  };
  expect("controls keeper", await read(BLUE.controls, "keeper"));
  expect("controls guardian", await read(BLUE.controls, "guardian"));
  for (const s of sources) {
    expect(`${s.name} reporter`, await read(s.address, "reporter"));
    expect(`${s.name} guardian`, await read(s.address, "guardian"));
  }
  if (!(await isKeeper(NEW_ROLE_HOLDER))) bad.push("calendar does not list the new keeper");
  if (await isKeeper(COMPROMISED)) bad.push("calendar still lists the compromised wallet");
  return bad;
}

async function main() {
  if ((await pub.getChainId()) !== 56) throw new Error("BNB Smart Chain (56) only");
  if (process.argv.includes("--verify")) {
    const bad = await roleProblems();
    console.log(bad.length ? `NOT complete:\n  ${bad.join("\n  ")}` : `Complete: ${NEW_ROLE_HOLDER} is keeper and guardian everywhere.`);
    process.exitCode = bad.length ? 1 : 0;
    return;
  }
  const code = await pub.getCode({ address: NEW_ROLE_HOLDER });
  if (code && code !== "0x") throw new Error(`new wallet has code or a delegation (${code}); do not give it a role`);
  const [admin, signer] = await Promise.all([read(BLUE.controls, "admin"), read(BLUE.controls, "signer")]);
  if ([admin, COMPROMISED].includes(NEW_ROLE_HOLDER)) throw new Error("new wallet must differ from the admin and the compromised wallet");

  const calendarCall = (who: Address, enabled: boolean) => ({
    to: BLUE.calendar as Address,
    data: encodeFunctionData({ abi, functionName: "setKeeper", args: [who, enabled] }),
  });
  const calls: { label: string; to: Address; data: Hex }[] = [
    { label: "Calendar: remove compromised keeper", ...calendarCall(COMPROMISED, false) },
    { label: "Calendar: add new keeper", ...calendarCall(NEW_ROLE_HOLDER, true) },
    {
      label: "Borrow controls: set keeper and guardian",
      to: BLUE.controls,
      data: encodeFunctionData({ abi, functionName: "setRoles", args: [NEW_ROLE_HOLDER, NEW_ROLE_HOLDER, signer] }),
    },
    ...sources.map((s) => ({
      label: `${s.name} price source: set reporter and guardian`,
      to: s.address,
      data: encodeFunctionData({ abi: sourceAbi, functionName: "setRoles", args: [NEW_ROLE_HOLDER, NEW_ROLE_HOLDER] }),
    })),
  ];

  // Simulate the whole batch the way a delegated (EIP-7702) account runs it: a self-call to ERC-7579 execute.
  const adminCode = await pub.getCode({ address: admin });
  if (adminCode?.startsWith("0xef0100")) {
    const batch = encodeAbiParameters(
      [{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }],
      [calls.map((c) => ({ target: c.to, value: 0n, callData: c.data }))],
    );
    const mode = padHex(concatHex(["0x01"]), { dir: "right", size: 32 });
    await pub.call({ account: admin, to: admin, data: encodeFunctionData({ abi, functionName: "execute", args: [mode, batch] }) });
    console.log(`Simulated all ${calls.length} calls as one batch from ${admin}: OK`);
  } else {
    for (const c of calls) await pub.call({ account: admin, to: c.to, data: c.data });
    console.log(`Simulated ${calls.length} calls individually from ${admin}: OK`);
  }
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
  return `<!doctype html><meta charset="utf-8"><title>Rotate Blue keeper and guardian</title>
<style>body{font:15px system-ui;max-width:760px;margin:40px auto;padding:0 16px}code{font-size:13px;word-break:break-all}button{font:inherit;padding:10px 18px}pre{white-space:pre-wrap}</style>
<h1>Rotate keeper and guardian</h1>
<p>New keeper and guardian: <code>${NEW_ROLE_HOLDER}</code></p>
<p>Removed: <code>${COMPROMISED}</code></p>
<p>Sign with the admin: <code>${admin}</code>, BNB Smart Chain. One atomic batch, ${calls.length} calls.</p>
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
      log(s.status === 200 || s.status === "CONFIRMED" ? "Done. Now run: pnpm rotate-keeper --verify" : "Batch failed with status " + s.status);
      return;
    }
    log("Still pending. Check your wallet, then run: pnpm rotate-keeper --verify");
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
