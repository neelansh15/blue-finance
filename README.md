# Dawn Finance

Dawn Finance is the working name for a lending product for tokenized US stocks (RWAs) on BNB Chain, built for BNB Bangkok (Nov 25-27, 2026). Research lives as markdown files at the repo root.

## Direction (draft)

Isolated-market lending for tokenized equities and RWAs, stablecoin borrow only in v1. Differentiator: a risk layer that knows when the underlying market is open (regime LTV haircuts, gap-risk model, conservative oracle). A propAMM is an optional liquidation venue, not required. Leverage vault and shorting come later.

## Files

- [architecture-v0.md](architecture-v0.md): lending architecture draft
- [idea-progression.md](idea-progression.md): how the idea evolved and why
- [morpho-blue.md](morpho-blue.md): Morpho Blue research (market model, oracle, liquidation, vaults, tokenized-stock markets)
- [architecture-v1.md](architecture-v1.md): architecture on top of unmodified Morpho Blue (splits, market hours, pause/whitelist, halts, dividends, ScaledUI)

Compiled Nov 2026.

## AI Risk Controller

The standalone [AI Risk Controller](ai-risk-controller/README.md) provides a FastAPI backend for collateral risk, market sessions, recoverable liquidation value, lending recommendations and borrower stress simulation. Its end-to-end weekend demo uses explicitly simulated NVDA data and requires no API keys. It does not execute transactions or change the lending protocol.
