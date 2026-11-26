# Dawn Finance

Dawn Finance is the working name for a lending product for tokenized US stocks (RWAs) on BNB Chain, built for BNB Bangkok (Nov 25-27, 2026). Research lives as markdown files at the repo root.

## Direction (draft)

Isolated-market lending for tokenized equities and RWAs, stablecoin borrow only in v1. Differentiator: a risk layer that knows when the underlying market is open (regime LTV haircuts, gap-risk model, conservative oracle). A propAMM is an optional liquidation venue, not required. Leverage vault and shorting come later.

## Files

- [architecture-v0.md](architecture-v0.md): lending architecture draft
- [idea-progression.md](idea-progression.md): how the idea evolved and why
- [morpho-blue.md](morpho-blue.md): Morpho Blue research (market model, oracle, liquidation, vaults, tokenized-stock markets)
- [architecture-v1.md](architecture-v1.md): architecture on top of unmodified Morpho Blue (splits, market hours, pause/whitelist, halts, dividends, ScaledUI)
- [frontend/](frontend): Next.js landing page (App Router, TypeScript). Run `npm install && npm run dev` inside the folder
- [protocol/](protocol): smart contracts (placeholder)

Compiled Nov 2026.
