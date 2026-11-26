import assert from "node:assert/strict";

// Run against both real services, not mocked HTTP responses.
const origin = process.env.FRONTEND_URL || "http://127.0.0.1:3000";
async function advisory(scenario, borrowers) {
  const response = await fetch(new URL("/api/risk/advisory/NVDAB", origin), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, borrowers }), signal: AbortSignal.timeout(60_000),
  });
  assert.equal(response.status, 200, `Advisory failed: HTTP ${response.status}`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.equal(data.assessment.asset, "BNB_STOCK_NVDA");
  assert.equal(data.recommendation.evidence_hash, data.assessment.evidence_hash);
  assert.equal(data.blue_proposal.evidence_hash, data.assessment.evidence_hash);
  assert.equal(data.blue_proposal.recommendation_id, data.recommendation.recommendation_id);
  assert.equal(data.recommendation.simulated, true);
  assert.equal(data.blue_proposal.executable, false);
  assert.equal(data.recommendation.approval_status, "PENDING_REVIEW");
  assert.equal(data.recommendation.simulation.total_positions, borrowers.length);
  assert.ok(data.simulations.every(s => s.total_positions === borrowers.length));
  assert.equal(data.simulations.length, 8);
  return data;
}

const overviewResponse = await fetch(new URL("/api/risk/overview", origin), { signal: AbortSignal.timeout(60_000) });
assert.equal(overviewResponse.status, 200);
assert.equal(overviewResponse.headers.get("cache-control"), "no-store");
const overview = await overviewResponse.json();
assert.equal(overview.refresh_after_seconds, 5);
const nvda = overview.assets.find(row => row.aliases.includes("NVDAB"));
assert.equal(nvda.status, "available");
assert.equal(nvda.simulated, true);
assert.ok(Math.abs(nvda.health_score - (100 - nvda.risk_score)) <= .051);
assert.equal(nvda.factors.length, 5);
for (const alias of ["NVDAB", "QQQB", "SPCXB", "TSLAB", "GOOGLB"]) {
  const row = overview.assets.find(row => row.aliases.includes(alias));
  assert.equal(row.status, "available", `${alias} coverage missing`);
  assert.equal(row.simulated, true);
  assert.equal(row.factors.length, 5);
  assert.ok(Math.abs(row.health_score - (100 - row.risk_score)) <= .051);
}
assert.ok(nvda.description.length > 0);
assert.deepEqual(await (await fetch(new URL("/api/risk/overview", origin))).json(), overview);
console.log("PASS stock overview: health, five explained factors, simulated provenance and shared five-second cache");

const borrowers = [{ borrower_id: "demo-position", collateral_quantity: 10, debt_usd: 350, liquidation_threshold: .625 }];
for (const scenario of ["baseline", "friday", "saturday"]) {
  const data = await advisory(scenario, borrowers);
  if (scenario === "friday") assert.equal(data.recommendation.simulation.positions[0].health_factor, 2.5);
  if (scenario === "saturday") assert.equal(data.recommendation.recommended_parameters.borrow_cap, 0);
  console.log(`PASS ${scenario}: one explicit borrower, shared evidence, eight stress scenarios`);
}
await advisory("baseline", []);
console.log("PASS empty account: zero borrowers retained");
const unsupported = await fetch(new URL("/api/risk/advisory/QQQB", origin), {
  method: "POST", body: JSON.stringify({ scenario: "baseline", borrowers: [] }),
});
assert.equal(unsupported.status, 404);
console.log("PASS unsupported market rejected");

if (process.argv.includes("--live-status")) {
  const response = await fetch(new URL("/api/risk/market-status/NVDAB", origin), { signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200, `Live sources unavailable: HTTP ${response.status}`);
  const statuses = await response.json();
  assert.ok(statuses.length > 0);
  for (const s of statuses) {
    assert.equal(s.simulated, false);
    for (const name of ["nasdaq_market", "underlying_halt", "binance_bstock"]) {
      assert.ok([200, 201].includes(s[name].http_status), `${name}: upstream failed`);
      assert.notEqual(s[name].status, "UNKNOWN");
    }
  }
  console.log("PASS live Nasdaq/Binance status through frontend proxy");
}
