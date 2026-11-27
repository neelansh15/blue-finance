// Product limits for leveraged borrowing (architecture-v3.md, section 6). Planning is in live-leverage.ts.

export const LEVERAGE = {
  /** Product-wide cap shown on the card. */
  cap: 2,
  /** Borrow-swap-supply rounds an ordinary batch may contain. */
  maxRounds: 5,
  /** Default slippage bound: the swap reverts below this share of the quote. */
  slippage: 0.005,
  /** A quote older than this is refreshed before one-click execution. */
  quoteSeconds: 30,
} as const;
