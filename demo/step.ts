// Helper for demo/check.sh. Run with: ../keepers/node_modules/.bin/tsx demo/step.ts <cmd>
//   open [collateralRaw=10] [borrowUsd=1000]   open the demo user's position through the router
//   snap                                       print one JSON line: regime, frozen, debt, collateral, oracle price, hf
//   close                                      repay all and withdraw all (best effort)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RealBlueClient, readEnv } from "../frontend/src/lib/blue/real";
import { WAD } from "../frontend/src/lib/blue/types";

const txt = readFileSync(resolve(__dirname, "../frontend/.env.local"), "utf8");
const env: Record<string, string> = {};
for (const l of txt.split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m) env[m[1]] = m[2];
}
const c = new RealBlueClient(readEnv(env));

async function snap() {
  const s = await c.getSnapshot();
  const coll = Number(s.collateralRaw) / 1e18;
  const px = s.oraclePricePerRaw ?? s.lastGoodPricePerRaw;
  const hf = s.debt > 0 ? (coll * px * s.params.lltv) / s.debt : null;
  return {
    regime: s.regime,
    frozen: s.oracleFrozen,
    uiMultiplier: Number(s.uiMultiplier) / 1e18,
    feedPricePerUI: s.feedPricePerUI,
    oraclePricePerRaw: px,
    collateral: coll,
    debt: s.debt,
    hf,
  };
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "open") {
    const r = await c.supplyCollateralAndBorrow!(BigInt(Math.round(Number(a ?? 10) * 1e6)) * (WAD / 1_000_000n), Number(b ?? 1000));
    console.log(JSON.stringify({ ok: r.ok, message: r.message }));
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === "snap") {
    console.log(JSON.stringify(await snap()));
  } else if (cmd === "close") {
    const s = await c.getSnapshot();
    if (s.debt > 0) await c.repay!(Infinity);
    const s2 = await c.getSnapshot();
    if (s2.collateralRaw > 0n) await c.withdraw!(s2.collateralRaw);
    console.log(JSON.stringify(await snap()));
  } else {
    console.error("usage: step.ts open|snap|close");
    process.exit(2);
  }
}
main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
