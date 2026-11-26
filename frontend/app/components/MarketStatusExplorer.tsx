"use client";

import { useId, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { AnimatedValue, useAnimatedNumber } from "./AnimatedValue";
import PositionPreview from "./PositionPreview";
import {
  BASE_LTV,
  DAYS,
  STATUS_LABEL,
  STATUS_NOTE,
  STEPS_PER_DAY,
  WEEK_STEPS,
  discountAt,
  formatStep,
  statusAt,
  type SessionStatus,
} from "./market-status";

const W = 720;
const PAD_L = 8;
const PAD_R = 8;
const TOP = 16;
const BOTTOM = 168;
const MAX_LTV = BASE_LTV; // y-axis top: borrow LTV in the regular session
const MIN_LTV = 0.4; // y-axis floor
const LTV_TICKS = [MAX_LTV, 0.45, MIN_LTV];

const x = (step: number) => PAD_L + (step / WEEK_STEPS) * (W - PAD_L - PAD_R);
const y = (borrowLtv: number) => TOP + ((MAX_LTV - borrowLtv) / (MAX_LTV - MIN_LTV)) * (BOTTOM - TOP);
const ltvText = (value: number) => `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

const JUMPS = [
  { label: "Regular", step: 2 * STEPS_PER_DAY + 22 },
  { label: "Extended", step: 3 * STEPS_PER_DAY + 34 },
  { label: "Overnight", step: STEPS_PER_DAY + 44 },
  { label: "Weekend", step: 5 * STEPS_PER_DAY + 24 },
  { label: "Sunday night", step: 6 * STEPS_PER_DAY + 42 },
];

export default function MarketStatusExplorer() {
  const [step, setStep] = useState(JUMPS[0].step);
  const id = useId();

  // Contiguous status bands and the stepped borrow-LTV line.
  const { bands, line, area } = useMemo(() => {
    const bands: { from: number; to: number; r: SessionStatus }[] = [];
    let pts = "";
    for (let s = 0; s < WEEK_STEPS; s++) {
      const r = statusAt(s);
      const last = bands[bands.length - 1];
      if (last && last.r === r) last.to = s + 1;
      else bands.push({ from: s, to: s + 1, r });
      const p = MAX_LTV * (1 - discountAt(s));
      pts += `${s === 0 ? "M" : "L"}${x(s).toFixed(1)} ${y(p).toFixed(1)} L${x(s + 1).toFixed(1)} ${y(p).toFixed(1)} `;
    }
    const area = `${pts}L${x(WEEK_STEPS).toFixed(1)} ${BOTTOM} L${x(0).toFixed(1)} ${BOTTOM} Z`;
    return { bands, line: pts.trim(), area };
  }, []);

  const status = statusAt(step);
  const discount = discountAt(step);
  const borrowLtv = MAX_LTV * (1 - discount);
  const animatedDiscount = useAnimatedNumber(discount);

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
            <p className="plot-label">Borrow LTV</p>
            <p className="plot-value num">
              <AnimatedValue value={ltvText(borrowLtv)}>
                {(MAX_LTV * (1 - animatedDiscount) * 100).toFixed(1).replace(/\.0$/, "")}<span className="plot-unit">%</span>
              </AnimatedValue>
            </p>
          </div>
          <div className="plot-reading">
            <p className="num">{formatStep(step)}</p>
            <p>
              {STATUS_LABEL[status]} ·{" "}
              <AnimatedValue value={`${Math.round(discount * 100)}%`}>
                {Math.round(animatedDiscount * 100)}%
              </AnimatedValue>{" "}
              borrowing discount
            </p>
          </div>
        </div>

        <div className="chart">
          <div className="chart-axis" aria-hidden="true">
            {LTV_TICKS.map((tick) => (
              <span key={tick} style={{ top: `${(y(tick) / BOTTOM) * 100}%` }}>
                {ltvText(tick)}
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
              <title id={`${id}-t`}>Borrow LTV across one week, by market status</title>
              <desc id={`${id}-d`}>
                Borrow LTV is 50% in the regular session, 48% in extended hours, 45% overnight (including Sunday from
                8pm), and 42.5% from Friday 8pm until Sunday 8pm. The liquidation threshold stays at 62.5% throughout.
                Values are illustrative.
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
              {LTV_TICKS.map((p) => (
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
              style={{ left: `${(x(step + 0.5) / W) * 100}%`, top: `${(y(borrowLtv) / BOTTOM) * 100}%` }}
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
          aria-valuetext={`${formatStep(step)}, ${STATUS_LABEL[status]}, borrow LTV ${ltvText(borrowLtv)}`}
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
        <p className="plot-note">{STATUS_NOTE[status]} Health factor does not change.</p>
      </div>

      <PositionPreview discount={discount} animatedDiscount={animatedDiscount} id={`${id}-position`} />
    </div>
  );
}
