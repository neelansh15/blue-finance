"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import {
  DAYS,
  REGIME_LABEL,
  REGIME_NOTE,
  STEPS_PER_DAY,
  WEEK_STEPS,
  formatStep,
  haircutAt,
  regimeAt,
  type Regime,
} from "./regimes";

const W = 720;
const PAD_L = 8;
const PAD_R = 8;
const TOP = 16;
const BOTTOM = 168;
const MIN_POWER = 0.8; // y-axis floor (relative power), illustrative

const x = (step: number) => PAD_L + (step / WEEK_STEPS) * (W - PAD_L - PAD_R);
const y = (power: number) => TOP + ((1 - power) / (1 - MIN_POWER)) * (BOTTOM - TOP);

const JUMPS: { label: string; step: number }[] = [
  { label: "Wed, regular session", step: 2 * STEPS_PER_DAY + 22 }, // Wed 11:00
  { label: "Thu, close ramp", step: 3 * STEPS_PER_DAY + 31 }, // Thu 15:30
  { label: "Tue, overnight", step: 1 * STEPS_PER_DAY + 44 }, // Tue 22:00
  { label: "Saturday", step: 5 * STEPS_PER_DAY + 24 }, // Sat 12:00
];

export default function RegimeExplorer() {
  const [step, setStep] = useState(2 * STEPS_PER_DAY + 22);
  const svgRef = useRef<SVGSVGElement>(null);
  const id = useId();

  // Contiguous regime bands and the stepped power line.
  const { bands, line, area } = useMemo(() => {
    const bands: { from: number; to: number; r: Regime }[] = [];
    let pts = "";
    for (let s = 0; s < WEEK_STEPS; s++) {
      const r = regimeAt(s);
      const last = bands[bands.length - 1];
      if (last && last.r === r) last.to = s + 1;
      else bands.push({ from: s, to: s + 1, r });
      const p = 1 - haircutAt(s);
      pts += `${s === 0 ? "M" : "L"}${x(s).toFixed(1)} ${y(p).toFixed(1)} L${x(s + 1).toFixed(1)} ${y(p).toFixed(1)} `;
    }
    const area = `${pts}L${x(WEEK_STEPS).toFixed(1)} ${BOTTOM} L${x(0).toFixed(1)} ${BOTTOM} Z`;
    return { bands, line: pts.trim(), area };
  }, []);

  const regime = regimeAt(step);
  const h = haircutAt(step);
  const power = 1 - h;

  const onPointer = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.type === "pointermove" && e.buttons !== 1 && e.pointerType !== "mouse") return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const s = Math.round(((vx - PAD_L) / (W - PAD_L - PAD_R)) * WEEK_STEPS);
    setStep(Math.max(0, Math.min(WEEK_STEPS - 1, s)));
  }, []);

  return (
    <div className="explorer">
      <div className="explorer-top">
        <div className="readout" aria-live="polite">
          <p className="readout-time num">{formatStep(step)}</p>
          <span className={`pill pill-${regime}`}>
            <span className="pill-dot" aria-hidden="true" />
            {REGIME_LABEL[regime]}
          </span>
        </div>
        <dl className="readout-stats">
          <div>
            <dt>Haircut</dt>
            <dd className="num">{(h * 100).toFixed(1)}%</dd>
          </div>
          <div>
            <dt>Borrowing power</dt>
            <dd className="num key">{(power * 100).toFixed(1)}%</dd>
          </div>
        </dl>
      </div>
      <p className="readout-note">{REGIME_NOTE[regime]}</p>

      <div className="chart">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${BOTTOM}`}
          preserveAspectRatio="none"
          role="img"
          aria-labelledby={`${id}-t ${id}-d`}
          onPointerDown={onPointer}
          onPointerMove={(e) => (e.buttons === 1 ? onPointer(e) : undefined)}
        >
          <title id={`${id}-t`}>Illustrative borrowing power across one week, by market regime</title>
          <desc id={`${id}-d`}>
            Borrowing power is full during each weekday regular session, ramps down in the last half hour before
            the close, is slightly lower in extended hours, lower overnight, and lowest from Friday evening until
            Monday pre-market. Values are illustrative.
          </desc>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {bands.map((b) => (
            <rect
              key={b.from}
              className={`band band-${b.r}`}
              x={x(b.from)}
              y={TOP}
              width={x(b.to) - x(b.from)}
              height={BOTTOM - TOP}
            />
          ))}
          {[1, 0.9, MIN_POWER].map((p) => (
            <line key={p} className="gridline" x1={PAD_L} x2={W - PAD_R} y1={y(p)} y2={y(p)} />
          ))}
          {DAYS.map((d, i) =>
            i > 0 ? (
              <line key={d} className="dayline" x1={x(i * STEPS_PER_DAY)} x2={x(i * STEPS_PER_DAY)} y1={TOP} y2={BOTTOM} />
            ) : null,
          )}
          <path d={area} fill={`url(#${id}-fill)`} />
          <path d={line} className="power-line" />
          <line className="cursor" x1={x(step + 0.5)} x2={x(step + 0.5)} y1={TOP - 6} y2={BOTTOM} />
        </svg>
        <span
          className="cursor-dot"
          aria-hidden="true"
          style={{ left: `${(x(step + 0.5) / W) * 100}%`, top: `${(y(power) / BOTTOM) * 100}%` }}
        />
        <ol className="days" aria-hidden="true">
          {DAYS.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ol>
      </div>

      <label className="sr-only" htmlFor={`${id}-range`}>
        Time of week
      </label>
      <input
        id={`${id}-range`}
        className="range"
        type="range"
        min={0}
        max={WEEK_STEPS - 1}
        step={1}
        value={step}
        onChange={(e) => setStep(Number(e.target.value))}
        aria-valuetext={`${formatStep(step)}, ${REGIME_LABEL[regime]}, borrowing power ${(power * 100).toFixed(1)}% (illustrative)`}
      />

      <div className="explorer-foot">
        <div className="jumps" role="group" aria-label="Jump to a moment in the week">
          {JUMPS.map((j) => (
            <button
              key={j.label}
              type="button"
              className="chip-btn"
              aria-pressed={step === j.step}
              onClick={() => setStep(j.step)}
            >
              {j.label}
            </button>
          ))}
        </div>
        <ul className="legend" aria-label="Regime legend">
          {(["open", "extended", "closed", "weekend"] as Regime[]).map((r) => (
            <li key={r}>
              <span className={`swatch band-${r}`} aria-hidden="true" />
              {REGIME_LABEL[r]}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
