"use client";

import { useId, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import PositionPreview from "./PositionPreview";
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
const POWER_TICKS = [1, 0.9, MIN_POWER];

const x = (step: number) => PAD_L + (step / WEEK_STEPS) * (W - PAD_L - PAD_R);
const y = (power: number) => TOP + ((1 - power) / (1 - MIN_POWER)) * (BOTTOM - TOP);

const JUMPS = [
  { label: "Regular", step: 2 * STEPS_PER_DAY + 22 },
  { label: "Near close", step: 3 * STEPS_PER_DAY + 31 },
  { label: "Extended", step: 3 * STEPS_PER_DAY + 34 },
  { label: "Overnight", step: STEPS_PER_DAY + 44 },
  { label: "Weekend", step: 5 * STEPS_PER_DAY + 24 },
];

export default function RegimeExplorer() {
  const [step, setStep] = useState(JUMPS[0].step);
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

  function selectPoint(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const vx = ((event.clientX - rect.left) / rect.width) * W;
    const nextStep = Math.floor(((vx - PAD_L) / (W - PAD_L - PAD_R)) * WEEK_STEPS);
    setStep(Math.max(0, Math.min(WEEK_STEPS - 1, nextStep)));
  }

  return (
    <div className="market-workbench">
      <div className="plot-panel">
        <div className="plot-heading">
          <div>
            <p className="plot-label">Borrowing power</p>
            <p className="plot-value num">{(power * 100).toFixed(0)}<span>%</span></p>
          </div>
          <div className="plot-reading">
            <p className="num">{formatStep(step)}</p>
            <p>{REGIME_LABEL[regime]} · {(h * 100).toFixed(0)}% haircut</p>
          </div>
        </div>

        <div className="chart">
          <div className="chart-axis" aria-hidden="true">
            {POWER_TICKS.map((tick) => (
              <span key={tick} style={{ top: `${(y(tick) / BOTTOM) * 100}%` }}>
                {Math.round(tick * 100)}%
              </span>
            ))}
          </div>
          <div className="chart-plot">
            <svg
              viewBox={`0 0 ${W} ${BOTTOM}`}
              preserveAspectRatio="none"
              role="img"
              aria-labelledby={`${id}-t`}
              aria-describedby={`${id}-d`}
              onPointerDown={(event) => event.button === 0 && selectPoint(event)}
              onPointerMove={(event) => event.buttons === 1 && selectPoint(event)}
            >
              <title id={`${id}-t`}>Illustrative borrowing power across one week, by market regime</title>
              <desc id={`${id}-d`}>
                Percent of regular-session borrowing power. It ramps down in the last half hour before
                the close, is slightly lower in extended hours, lower overnight, and lowest from Friday evening until
                Monday pre-market. Values are illustrative.
              </desc>
              <defs>
                <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--plot-ink)" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="var(--plot-ink)" stopOpacity="0" />
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
              {POWER_TICKS.map((p) => (
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
          </div>
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
          style={{ "--progress": `${(step / (WEEK_STEPS - 1)) * 100}%` } as CSSProperties}
          onChange={(e) => setStep(Number(e.target.value))}
          aria-valuetext={`${formatStep(step)}, ${REGIME_LABEL[regime]}, borrowing power ${(power * 100).toFixed(0)}% of regular session (illustrative)`}
        />

        <div className="jumps" role="group" aria-label="Compare market sessions">
          {JUMPS.map((jump) => (
            <button
              key={jump.step}
              type="button"
              aria-pressed={step === jump.step}
              onClick={() => setStep(jump.step)}
            >
              {jump.label}
            </button>
          ))}
        </div>
        <p className="plot-note">
          {regime === "open" && h > 0
            ? "The example begins reducing borrowing power 30 minutes before the regular session closes."
            : REGIME_NOTE[regime]}
        </p>
      </div>

      <PositionPreview haircut={h} id={`${id}-position`} />
    </div>
  );
}
