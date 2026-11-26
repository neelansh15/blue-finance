/** Narrow, runtime-checked view of the advisory service. Never transaction input. */
export const SCENARIOS = { baseline: "Now · synthetic inputs", friday: "Friday replay", saturday: "Saturday replay" } as const;
export type Scenario = keyof typeof SCENARIOS;
export type RiskRequest = {
  scenario: Scenario;
  borrowers: { borrower_id: string; collateral_quantity: number; debt_usd: number; liquidation_threshold: number }[];
};

function invalid(): never { throw new Error("The risk service returned an invalid response. Try again."); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string { return typeof value === "string" && value.length > 0 ? value : invalid(); }
function number(value: unknown, max = Infinity): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : invalid();
}
function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : invalid(); }
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(parse) : invalid();
}
function date(value: unknown): string {
  const result = text(value);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
}
function nullableNumber(value: unknown) { return value === null ? null : number(value); }

function simulation(value: unknown) {
  const s = object(value);
  return {
    scenario: text(s.scenario), total_positions: number(s.total_positions),
    at_risk: number(s.at_risk), liquidatable: number(s.liquidatable),
    estimated_bad_debt_usd: number(s.estimated_bad_debt_usd),
    positions: list(s.positions, item => {
      const p = object(item);
      return { borrower_id: text(p.borrower_id), health_factor: nullableNumber(p.health_factor), status: text(p.status) };
    }),
  };
}

const DAWN_REGIMES = ["OPEN", "EXTENDED", "CLOSED", "WEEKEND", "HALTED", "CORP_ACTION"] as const;
function dawnProposal(value: unknown, assessment: Record<string, unknown>, recommendation: Record<string, unknown>) {
  const d = object(value), router = object(d.router), config = object(d.configured);
  if (d.evidence_hash !== assessment.evidence_hash || d.recommendation_id !== recommendation.recommendation_id ||
      d.expires_at !== recommendation.expires_at || d.asset !== assessment.asset || d.executable !== false ||
      d.approval_required !== true || d.approval_status !== "PENDING_REVIEW" || d.calibration_status !== "UNCALIBRATED" ||
      d.signing_status !== "UNSIGNED" || JSON.stringify(router.regime_order) !== JSON.stringify(DAWN_REGIMES)) return invalid();
  const caps = object(router.regime_caps_usd), haircuts = object(config.haircuts_bps), stale = object(config.staleness_seconds);
  return { margin_bps: number(router.margin_bps, 5000), target_ltv: number(router.target_ltv, 1),
    total_borrow_cap_usd: number(router.total_borrow_cap_usd), profile: text(config.profile),
    oracle_freshness_seconds: number(d.advisory_oracle_max_age_seconds),
    regimes: DAWN_REGIMES.map(regime => ({ regime, haircut_bps: number(haircuts[regime], 5000),
      staleness_seconds: number(stale[regime]), proposed_cap_usd: number(caps[regime]) })),
    unchanged_controls: list(d.unchanged_controls, text), reasons: list(d.reasons, text),
    configuration_hash: text(d.configuration_hash), proposal_hash: text(d.proposal_hash),
    export_json: JSON.stringify(d, null, 2),
  };
}

export function parseAdvisory(value: unknown) {
  const root = object(value), a = object(root.assessment), r = object(root.recommendation);
  const score = object(a.score), session = object(a.session), recovery = object(a.recovery), oracle = object(a.oracle);
  const p = object(r.recommended_parameters);
  if (a.asset !== "BNB_STOCK_NVDA" || r.asset !== a.asset || r.evidence_hash !== a.evidence_hash ||
      r.simulated !== a.simulated || r.approval_required !== true || r.approval_status !== "PENDING_REVIEW") return invalid();
  const ltv = number(p.ltv, 1), threshold = number(p.liquidation_threshold, 1);
  if (ltv >= threshold || threshold !== .625) return invalid();
  return {
    assessment: {
      as_of: date(a.as_of), simulated: boolean(a.simulated), evidence_hash: text(a.evidence_hash),
      score: { overall: number(score.overall, 100), category: text(score.category), confidence: number(score.confidence, 1),
        data_quality: list(score.data_quality, text) },
      session: { underlying_session: text(session.underlying_session), protocol_regime: text(session.protocol_regime),
        effective_session: text(session.effective_session) },
      reference_price: number(recovery.reference_price), recovery_ratio: number(recovery.recovery_ratio, 1),
      oracle_stale: boolean(oracle.stale),
      events: list(a.events, item => { const e = object(item); return {
        description: text(e.description), severity: text(e.severity), evidence: text(e.evidence),
        requires_review: boolean(e.requires_review), source: text(e.source),
      }; }),
    },
    recommendation: {
      recommendation_id: text(r.recommendation_id), simulated: boolean(r.simulated), timestamp: date(r.timestamp),
      expires_at: date(r.expires_at), signing_status: text(r.signing_status),
      parameters: { ltv, liquidation_threshold: threshold, supply_cap: number(p.supply_cap), borrow_cap: number(p.borrow_cap),
        collateral_accepted: boolean(p.collateral_accepted) },
      reasoning: list(r.reasoning, text), simulation: simulation(r.simulation),
    },
    simulations: list(root.simulations, simulation),
    dawn_proposal: dawnProposal(root.dawn_proposal, a, r),
  };
}
export type Advisory = ReturnType<typeof parseAdvisory>;

export function parseMarketStatus(value: unknown) {
  const statuses = list(value, item => {
    const s = object(item);
    if (s.asset !== "BNB_STOCK_NVDA" || s.simulated !== false) return invalid();
    return { asset: text(s.asset), observations: ["nasdaq_market", "underlying_halt", "binance_bstock"].map(name => {
      const o = object(s[name]);
      if (![200, 201].includes(o.http_status as number) || o.status === "UNKNOWN") return invalid();
      return { name, status: text(o.status), fetched_at: date(o.fetched_at),
        http_status: o.http_status === null ? null : number(o.http_status, 599),
        detail: typeof o.detail === "string" ? o.detail : "" };
    }) };
  });
  return statuses.length > 0 ? statuses : invalid();
}
export type MarketStatus = ReturnType<typeof parseMarketStatus>;

/** Only the small demo portfolio contract is exposed through the browser proxy. */
export function parseRiskRequest(value: unknown): RiskRequest {
  const v = object(value);
  if (Object.keys(v).some(k => !["scenario", "borrowers"].includes(k)) ||
      typeof v.scenario !== "string" || !Object.hasOwn(SCENARIOS, v.scenario) ||
      !Array.isArray(v.borrowers) || v.borrowers.length > 1) return invalid();
  const borrowers = v.borrowers.map(item => {
    const b = object(item);
    const quantity = number(b.collateral_quantity, 1e12);
    if (quantity === 0 || b.borrower_id !== "demo-position" || b.liquidation_threshold !== .625 ||
        Object.keys(b).some(k => !["borrower_id", "collateral_quantity", "debt_usd", "liquidation_threshold"].includes(k))) return invalid();
    return { borrower_id: "demo-position", collateral_quantity: quantity, debt_usd: number(b.debt_usd, 1e15), liquidation_threshold: .625 };
  });
  return { scenario: v.scenario as Scenario, borrowers };
}

export function isExpired(expiresAt: string, now = Date.now()) { return Date.parse(expiresAt) <= now; }
export function statusFresh(at: string, now = Date.now()) { const age = now - Date.parse(at); return age >= 0 && age <= 300_000; }
