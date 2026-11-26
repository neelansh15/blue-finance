import { describe, expect, it } from "vitest";
import { BLUE_REGIMES, parseAdvisory } from "./contracts";

// Narrow wire contract; the separate HTTP smoke also checks the real Python service.
function response() {
  const asOf = "2026-11-26T12:00:00Z", expires = "2026-11-26T12:15:00Z";
  const simulation = { scenario: "baseline", total_positions: 0, at_risk: 0, liquidatable: 0,
    estimated_bad_debt_usd: 0, positions: [] };
  return {
    assessment: { asset: "BNB_STOCK_NVDA", as_of: asOf, simulated: true, evidence_hash: "sha256:evidence",
      score: { overall: 25, category: "MODERATE", confidence: .9, data_quality: [] },
      session: { underlying_session: "REGULAR", effective_session: "REGULAR", protocol_regime: "OPEN" },
      recovery: { reference_price: 140, recovery_ratio: .9 }, oracle: { stale: false }, events: [] },
    recommendation: { asset: "BNB_STOCK_NVDA", evidence_hash: "sha256:evidence", simulated: true,
      chain_id: 56, market_id: "DEMO", recommendation_id: "recommendation-1", approval_required: true,
      approval_status: "PENDING_REVIEW", signing_status: "UNSIGNED", timestamp: asOf, expires_at: expires,
      recommended_parameters: { ltv: .5, liquidation_threshold: .625, supply_cap: 100, borrow_cap: 7000,
        collateral_accepted: true }, reasoning: [], simulation },
    blue_proposal: { asset: "BNB_STOCK_NVDA", evidence_hash: "sha256:evidence", chain_id: 56, market_id: "DEMO",
      recommendation_id: "recommendation-1", expires_at: expires, market_lltv: .625, executable: false,
      approval_required: true, approval_status: "PENDING_REVIEW", signing_status: "UNSIGNED", proposal_hash: "sha256:proposal",
      router: { margin_bps: 200, target_ltv: .51125, total_borrow_cap_usd: 7000,
        regime_order: [...BLUE_REGIMES], regime_caps_usd: { OPEN: 7000, EXTENDED: 4900, CLOSED: 4900,
          WEEKEND: 2800, HALTED: 0, CORP_ACTION: 0 } } }, simulations: [simulation],
  };
}

describe("advisory response contract", () => {
  it("retains the proposal, evidence and empty portfolio explicitly", () => {
    const parsed = parseAdvisory(response());
    expect(parsed.proposal.regime_caps).toHaveLength(6);
    expect(parsed.recommendation.simulation.total_positions).toBe(0);
    expect(parsed.proposal.margin_bps).toBe(200);
  });

  it.each(["evidence_hash", "recommendation_id", "market_id", "expires_at", "chain_id"])(
    "rejects a proposal with mismatched %s", field => {
      const data = response();
      Object.assign(data.blue_proposal, { [field]: field === "chain_id" ? 1 : "wrong" });
      expect(() => parseAdvisory(data)).toThrow(/invalid response/);
    });

  it("rejects executable proposals, reversed expiry and invalid financial values", () => {
    const executable = response(); executable.blue_proposal.executable = true;
    const expiredBeforeEvidence = response(); expiredBeforeEvidence.recommendation.expires_at = "2026-11-25T12:00:00Z";
    const invalidLtv = response(); invalidLtv.recommendation.recommended_parameters.ltv = .7;
    const haltedCap = response(); haltedCap.blue_proposal.router.regime_caps_usd.HALTED = 100;
    const nonfinite = response(); nonfinite.assessment.score.overall = NaN;
    for (const data of [executable, expiredBeforeEvidence, invalidLtv, haltedCap, nonfinite]) {
      expect(() => parseAdvisory(data)).toThrow(/invalid response/);
    }
  });
});
