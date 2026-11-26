"use client";

import { useEffect, useRef, useState } from "react";
import { STOCKS } from "../markets";
import { parseOverview, type RiskOverview } from "../../../src/lib/risk/contracts";

const title = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

export default function StockRiskTable() {
  const [data, setData] = useState<RiskOverview | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    async function load() {
      if (running || disposed) return;
      clearTimeout(timer);
      running = true;
      const startedAt = Date.now();
      controller = new AbortController();
      setPending(true);
      try {
        const response = await fetch("/api/risk/overview", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(50_000)]) });
        if (!response.ok) throw new Error("Stock risk data is unavailable. Check the risk service connection.");
        const parsed = parseOverview(await response.json());
        if (!disposed) { setData(parsed); setError(""); setNow(Date.now()); }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : "Unable to refresh stock risk data.");
      } finally {
        running = false;
        if (!disposed) {
          setPending(false);
          // Target a five-second cadence without overlapping requests or hidden-tab polling.
          timer = setTimeout(() => { if (!document.hidden) void load(); }, Math.max(0, 5_000 - (Date.now() - startedAt)));
        }
      }
    }
    refresh.current = () => { void load(); };
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", visible);
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    void load();
    return () => { disposed = true; clearTimeout(timer); clearInterval(clock); controller?.abort(); document.removeEventListener("visibilitychange", visible); };
  }, []);

  const stale = !!data && now - Date.parse(data.generated_at) > 20_000;
  const covered = STOCKS.filter(m => data?.assets.some(a => a.aliases.includes(m.id) && a.status === "available")).length;
  return <section className="stock-risk" aria-labelledby="stock-risk-title">
    <div className="stock-risk-heading">
      <div><p className="app-demo-label">Market intelligence</p><h2 id="stock-risk-title">Stock health at a glance</h2>
        <p>Compare collateral health, understand the drivers, and spot gaps in coverage.</p></div>
      <button type="button" className="stock-refresh" disabled={pending} onClick={() => refresh.current()}>{pending ? "Refreshing…" : "Refresh data"}</button>
    </div>
    <div className="stock-risk-strip">
      <span><strong>{data ? `${covered} / ${STOCKS.length}` : "—"}</strong> stocks assessed</span>
      <span>Auto-refresh <strong>every 5 seconds</strong></span>
      <span role="status">{error ? "Connection interrupted" : stale ? "Stale evidence" : pending ? "Fetching assessments…" : "Connected to risk backend"}</span>
    </div>
    {error && <p className="app-message" role="alert">{error} {data ? "Showing the last received data; it may be outdated." : "Scores will appear when the backend is available."} Retrying every 5 seconds.</p>}
    <div className="risk-table-scroll" tabIndex={0} role="region" aria-label="Stock health and risk table">
      <table className="risk-table stock-risk-table">
        <caption>Health = 100 − backend risk score; higher health is better. Factor bars show risk from 0 to 100; higher means more risk. Asset scores are independent of your account’s health factor. Default backend evidence is simulated.</caption>
        <thead><tr><th scope="col">Stock</th><th scope="col">Health / 100</th><th scope="col">Risk level</th><th scope="col">Risk drivers</th><th scope="col">What to know</th><th scope="col">Evidence</th></tr></thead>
        <tbody>{STOCKS.map(market => {
          const row = data?.assets.find(a => a.aliases.includes(market.id));
          const available = row?.status === "available" ? row : null;
          const outdated = available && (stale || now - Date.parse(available.as_of) > 20_000);
          return <tr key={market.id}>
            <th scope="row"><span className="stock-identity">{market.symbol}</span><span className="stock-detail">{market.name}</span></th>
            <td>{available ? <div className="stock-health"><strong>{available.health_score.toFixed(1)}</strong><meter min={0} max={100} value={available.health_score} aria-label={`${market.symbol} health score`} /></div> : <span className="stock-detail">—</span>}</td>
            <td>{available ? <span className={`stock-risk-badge stock-risk-${available.category.toLowerCase()}`}>{title(available.category)}{outdated ? " · stale" : ""}</span> : <span className="stock-risk-badge">{pending && !data ? "Loading" : row ? "Unavailable" : data ? "No coverage" : "Unavailable"}</span>}</td>
            <td>{available ? <div className="stock-factors">{available.factors.map(factor => <div key={factor.name} title={factor.description}>
              <span>{title(factor.name)}</span><meter min={0} max={100} value={factor.score} aria-label={`${market.symbol} ${factor.name} risk`} /><span>{Math.round(factor.score)}</span>
            </div>)}</div> : <span className="stock-detail">No factor data</span>}</td>
            <td className="stock-explanation">{row?.description ?? (data ? "This stock is listed in the app but has no risk assessment provider configured yet." : pending ? "Waiting for the risk backend…" : "Connect the risk backend to view available assessments.")}
              {available && <><span className="stock-detail">Model confidence: {Math.round(available.confidence * 100)}%</span>
                {available.data_quality.length > 0 && <span className="stock-quality">Data limitations: {available.data_quality.join("; ")}</span>}
                <details className="stock-factor-notes"><summary>Explain the factors</summary>{available.factors.map(f => <p key={f.name}><strong>{title(f.name)}:</strong> {f.description}</p>)}</details></>}
            </td>
            <td>{available ? <><strong className="stock-evidence">{available.simulated ? "Simulated" : "Backend evidence"}</strong><time className="stock-detail" dateTime={available.as_of}>{new Date(available.as_of).toLocaleTimeString()}</time>{outdated && <span className="stock-quality">Refresh required</span>}</> : <span className="stock-detail">No evidence</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}
