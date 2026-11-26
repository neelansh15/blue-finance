"use client";

import { useEffect, useId, useRef, useState } from "react";
import { requestForPosition, type RiskPosition } from "../../../src/lib/risk/adapter";
import { isExpired, parseAdvisory, parseMarketStatus, SCENARIOS, statusFresh,
  type Advisory, type MarketStatus, type Scenario } from "../../../src/lib/risk/contracts";

const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
const timestamp = (value: string) => new Date(value).toLocaleString();

async function jsonResponse(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new Error("The advisory service returned an unreadable response."); }
}
function errorMessage(value: unknown): string {
  if (value && typeof value === "object" && "detail" in value && typeof value.detail === "string") return value.detail;
  return "The risk service is unavailable. Try again.";
}

/** Read-only analysis. It never changes account state, wallet actions or router limits. */
export default function RiskPanel({ position }: { position: RiskPosition }) {
  const id = useId();
  const [scenario, setScenario] = useState<Scenario>("baseline");
  const [result, setResult] = useState<Advisory | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<MarketStatus | null>(null);
  const [livePending, setLivePending] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [now, setNow] = useState<number | null>(null);
  const active = useRef<AbortController | null>(null);
  const liveActive = useRef<AbortController | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearInterval(timer); active.current?.abort(); liveActive.current?.abort(); };
  }, []);

  async function analyse() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setPending(true); setError(""); setResult(null);
    try {
      const body = requestForPosition(position, scenario);
      const response = await fetch(`/api/risk/advisory/${position.symbol}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        signal: controller.signal, cache: "no-store",
      });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(errorMessage(data));
      const parsed = parseAdvisory(data);
      if (!controller.signal.aborted) { setResult(parsed); setNow(Date.now()); }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Analysis failed. Try again."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }

  async function checkLive() {
    liveActive.current?.abort();
    const controller = new AbortController();
    liveActive.current = controller;
    setLivePending(true); setLiveError(""); setLive(null);
    try {
      const response = await fetch(`/api/risk/market-status/${position.symbol}`, { signal: controller.signal, cache: "no-store" });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(errorMessage(data));
      const parsed = parseMarketStatus(data);
      if (!controller.signal.aborted) { setLive(parsed); setNow(Date.now()); }
    } catch (e) { if (!controller.signal.aborted) setLiveError(e instanceof Error ? e.message : "Live status unavailable."); }
    finally { if (!controller.signal.aborted) setLivePending(false); }
  }

  const expired = result && now !== null && isExpired(result.recommendation.expires_at, now);
  return (
    <section className="risk-panel" aria-labelledby={`${id}-title`}>
      <div className="app-section-heading"><h2 id={`${id}-title`}>Legacy Morpho advisory</h2><span className="app-demo-label">Review required</span></div>
      <p className="risk-intro">For Aave V3 shared-reserve analysis, open /app/risk. This legacy panel assesses demo collateral and debt using the backend’s synthetic market scenarios. Recommendations require review; this analysis sends no transactions.</p>
      {position.unsupported ? <p className="app-message" role="status">{position.unsupported}</p> : <>
        <dl className="risk-account">
          <div><dt>Demo collateral</dt><dd>{position.quantity.toLocaleString()} NVDAb</dd></div>
          <div><dt>Demo debt</dt><dd>{usd(position.debtUsd)}</dd></div>
          <div><dt>UI price</dt><dd>{usd(position.uiPriceUsd)}</dd></div>
        </dl>
        <div className="risk-controls">
          <label htmlFor={`${id}-scenario`}>Backend scenario</label>
          <select id={`${id}-scenario`} value={scenario} disabled={pending} onChange={e => { setScenario(e.target.value as Scenario); setResult(null); setError(""); }}>
            {Object.entries(SCENARIOS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>
          <button className="btn" type="button" disabled={pending} onClick={analyse}>{pending ? "Assessing…" : "Analyse demo position"}</button>
        </div>
        {pending && <p role="status">Assessing market evidence and borrower stress scenarios…</p>}
        {error && <p className="app-message" role="alert">{error}</p>}
        {result && <div className="risk-result" aria-live="polite">
          <p className="risk-evidence-state">{result.recommendation.simulated ? "Simulated evidence" : "Backend evidence"} · Pending review · {label(result.recommendation.signing_status)}{expired ? " · Expired evidence" : ""}</p>
          {expired && <p className="app-message">This recommendation has expired. Historical replays remain available for inspection; run “Now” for newly generated synthetic evidence.</p>}
          <p>Backend reference price: <strong>{usd(result.assessment.reference_price)}</strong>. Health and stress results below use backend prices, which can differ from the UI price above.</p>
          <dl className="risk-metrics">
            <div><dt>Risk score / 100</dt><dd>{result.assessment.score.overall.toFixed(1)} <small>{label(result.assessment.score.category)}</small></dd></div>
            <div><dt>Recommended target LTV</dt><dd>{percent(result.recommendation.parameters.ltv)}</dd></div>
            <div><dt>Market liquidation LTV</dt><dd>{percent(result.recommendation.parameters.liquidation_threshold)}</dd></div>
            <div><dt>Total borrow cap · USD</dt><dd>{usd(result.recommendation.parameters.borrow_cap)}</dd></div>
            <div><dt>Total collateral cap · tokens</dt><dd>{result.recommendation.parameters.supply_cap.toLocaleString(undefined, { maximumFractionDigits: 2 })}</dd></div>
            <div><dt>New exposure recommendation</dt><dd>{result.recommendation.parameters.collateral_accepted ? "Permitted by model" : "Hold new exposure"}</dd></div>
            <div><dt>Blue policy regime</dt><dd>{label(result.assessment.session.protocol_regime)}</dd></div>
            <div><dt>Underlying exchange session</dt><dd>{label(result.assessment.session.underlying_session)}</dd></div>
            <div><dt>Oracle evidence</dt><dd>{result.assessment.oracle_stale ? "Stale" : "Within freshness policy"}</dd></div>
            <div><dt>Confidence</dt><dd>{percent(result.assessment.score.confidence)}</dd></div>
            <div><dt>Stressed recovery ratio</dt><dd>{percent(result.assessment.recovery_ratio)}</dd></div>
          </dl>
          {result.assessment.score.data_quality.length > 0 && <p className="app-message">Data quality: {result.assessment.score.data_quality.join("; ")}</p>}
          <p className="risk-note">Caps are total market policy targets, not your remaining borrowing allowance. Configured router limits are checked by the model; deployed contract limits must be verified separately.</p>
          <details><summary>Blue router proposal · review required</summary>
            <p>Proposed margin: {result.proposal.margin_bps} bps. Router target: {percent(result.proposal.target_ltv)}. Total borrow cap: {usd(result.proposal.total_cap_usd)}.</p>
            <dl className="risk-metrics">{result.proposal.regime_caps.map(({ regime, cap }) =>
              <div key={regime}><dt>{label(regime)} borrow cap</dt><dd>{usd(cap)}</dd></div>)}</dl>
            <p className="risk-note">Unsigned and uncalibrated. This proposal requires review and cannot execute a transaction. Zero caps hold new exposure.</p>
          </details>
          <h3>Borrower stress scenarios</h3>
          {result.recommendation.simulation.total_positions === 0 ? <p>No collateral position to stress-test. Your empty account was sent explicitly.</p> :
            <div className="risk-table-scroll"><table className="risk-table">
              <caption>Economic shortfalls are hypothetical. Liquidatable means health below 1 using the scenario’s oracle mark.</caption>
              <thead><tr><th scope="col">Scenario</th><th scope="col">Health</th><th scope="col">Position status</th><th scope="col">Estimated shortfall</th></tr></thead>
              <tbody>{[result.recommendation.simulation, ...result.simulations].map(s => <tr key={s.scenario}>
                <th scope="row">{label(s.scenario)}</th><td>{s.positions[0]?.health_factor == null ? "No debt" : s.positions[0].health_factor.toFixed(2)}</td>
                <td>{s.positions[0] ? label(s.positions[0].status) : "No position"}</td><td>{usd(s.estimated_bad_debt_usd)}</td>
              </tr>)}</tbody>
            </table></div>}
          <details><summary>Reasons and issuer evidence</summary>
            <ul>{result.recommendation.reasoning.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
            {result.assessment.events.map((event, i) => <div className="risk-event" key={i}>
              <p><strong>{label(event.severity)}</strong> · {event.description}{event.requires_review ? " · Review required" : ""}</p>
              <blockquote>{event.evidence}</blockquote><p className="risk-note">Source: {event.source}</p>
            </div>)}
          </details>
          <details><summary>Audit and expiry</summary><dl className="risk-audit">
            <div><dt>Evidence time</dt><dd>{timestamp(result.assessment.as_of)}</dd></div>
            <div><dt>Expires</dt><dd>{timestamp(result.recommendation.expires_at)}</dd></div>
            <div><dt>Recommendation</dt><dd>{result.recommendation.recommendation_id}</dd></div>
            <div><dt>Evidence hash</dt><dd>{result.assessment.evidence_hash}</dd></div>
          </dl></details>
        </div>}
        <div className="risk-live">
          <h3>Live market status</h3>
          <p>Fetch Nasdaq and Binance status separately. Live status does not turn synthetic prices, issuer reports or borrower analysis into live evidence.</p>
          <button className="btn dashboard-secondary" type="button" disabled={livePending} onClick={checkLive}>{livePending ? "Checking sources…" : "Check live status"}</button>
          {livePending && <p role="status">Fetching public market-status sources…</p>}
          {liveError && <p className="app-message" role="alert">{liveError} No live trading status is confirmed.</p>}
          {live && live.map((asset, i) => <dl className="risk-metrics" key={i}>{asset.observations.map(o => {
            const fresh = now !== null && statusFresh(o.fetched_at, now);
            return <div key={o.name}><dt>{label(o.name)}</dt><dd>{fresh ? label(o.status) : "Stale · refresh required"}</dd>
              <dd className="risk-note">HTTP {o.http_status ?? "unavailable"} · {timestamp(o.fetched_at)}{o.detail ? ` · ${o.detail}` : ""}</dd></div>;
          })}</dl>)}
        </div>
      </>}
    </section>
  );
}
