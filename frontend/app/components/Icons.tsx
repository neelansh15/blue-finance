import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
  width: 24,
  height: 24,
};

/** Clock with a sun arc: market-hours awareness. */
export const IconRegime = () => (
  <svg {...base}>
    <path d="M3 16a9 9 0 0 1 18 0" />
    <path d="M12 16l3.5-4" />
    <path d="M2 20h20" />
    <path d="M12 5V3M5.6 8.6 4.2 7.2M18.4 8.6l1.4-1.4" />
  </svg>
);

/** Two lines meeting at the lower value: conservative min() oracle. */
export const IconOracle = () => (
  <svg {...base}>
    <path d="M3 7h6l3 5" />
    <path d="M3 17h6l3-5" />
    <path d="M12 12h9" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

/** Split arrows: corporate actions via the multiplier. */
export const IconSplit = () => (
  <svg {...base}>
    <path d="M4 12h6" />
    <path d="M10 12l5-5h5" />
    <path d="M10 12l5 5h5" />
    <path d="M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5" />
  </svg>
);

/** Pause bars in a rounded square: halts and freezes. */
export const IconHalt = () => (
  <svg {...base}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="M10 9v6M14 9v6" />
  </svg>
);

/** Shield with check: eligibility and compliance. */
export const IconShield = () => (
  <svg {...base}>
    <path d="M12 3l7.5 3v5.5c0 4.4-3.1 8-7.5 9.5-4.4-1.5-7.5-5.1-7.5-9.5V6L12 3z" />
    <path d="M8.8 12.2l2.2 2.2 4.2-4.4" />
  </svg>
);

/** Descending steps: partial, gentler liquidation. */
export const IconSteps = () => (
  <svg {...base}>
    <path d="M3 6h5v4h5v4h5v4h3" />
    <path d="M3 20h18" />
  </svg>
);

/** Separate cells: isolated markets. */
export const IconIsolated = () => (
  <svg {...base}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </svg>
);

export const IconArrow = () => (
  <svg {...base} width={16} height={16} strokeWidth={1.8}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const IconDoc = () => (
  <svg {...base} width={20} height={20}>
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5M10 13h6M10 17h6" />
  </svg>
);
