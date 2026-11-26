# Idea progression

How the product direction evolved. Dates are 2026. Design reasoning is marked as such; sourced facts are marked with their source.

## Stage 1: Liquidity primitives (Nov 13)

Starting point: BNB Bangkok tracks are AI, RWA and Trading, with a 36-hour build. Two directions were explored:

- **Pegged-RWA Bin pool:** a PancakeSwap Infinity Bin pool with a hook. Tight bins around an oracle NAV, fees that widen on depeg and on oracle age.
- **Prop AMM on EVM:** oracle-driven quoting instead of passive curves.

Facts that shaped the next step:

- Prop AMMs are already large on BNB Chain (Tessera about $725M and Metric about $1.8B over 30 days, sources disagree on exact volumes), but closed-source and run by single firms. No open-source template found.
- BNB Chain has run 0.45s blocks since Jan 2026, which shrinks the quote staleness window.
- Tokenized RWAs and stables have low staleness risk, so a prop AMM matters most where the underlying market closes.
- Unverified: whether Pancake Infinity hooks can override pricing or only fees (docs returned 404).

## Stage 2: Shortlist of products (Nov 25)

Six candidates were compared on track, risk in 36 hours and demo moment: prop AMM simulator, RWA prop AMM, AI market-making agent, QuoteGuard (spoof-proof quote wrapper), onchain stock terminal, pegged-RWA Bin pool hook.

## Stage 3: Lending for tokenized equities (Nov 25)

Direction chosen: an isolated-market lending protocol for tokenized equities and RWAs on BNB Chain.

Core insight (design reasoning, not researched): tokens trade 24/7 but the underlying equity does not, so overnight, weekend and holiday gaps are the main risk that Aave-style protocols ignore. The risk layer therefore tracks whether the underlying market is open.

Decisions, with the reason for each:

| Decision | Reason |
|----------|--------|
| Isolated markets (Morpho-Blue-style) | Bad debt in one market never touches others; minimal core |
| Stablecoin-only borrowing in v1 | One-sided risk (only collateral price matters), one oracle per market, one rate curve |
| Market-hours regime module | LTV haircuts per regime (open, extended, closed, weekend or holiday, halted) |
| Conservative oracle router | Uses the more conservative of the primary feed and DEX TWAP when they diverge |
| Offchain risk engine, onchain enforcement | Gap-quantile model sets haircuts; contracts only enforce hard-coded bounds |
| Regime-aware liquidation bonus | Liquidator carries the exit risk, so the bonus rises when closed or illiquid |
| Prop AMM as optional liquidation venue | Useful exit liquidity, but not required for the risk layer |
| Leverage vault and shorting later | Leveraged longs are v1.5; shorting needs borrowable equity tokens (v2) |

Full detail: [architecture-v0.md](architecture-v0.md).

## Stage 4: Name (Nov 26)

Working name: Blue Finance.

Alternative under consideration (Nov 26): Blue Finance. No decision yet.

## Build plan

1. Spec and parameter model: gap analysis on 2-3 equities, regime table, LLTV formula (backtest).
2. Core, oracle router and regime module on a BNB testnet fork with a mock tokenized equity.
3. Liquidation engine, keeper bot and a simulator showing a weekend-gap scenario (the demo).
4. Leverage vault, UI, real feeds and tokens.

Hackathon cut (36 hours): phases 1-3 with a live weekend-gap liquidation simulation.

## Open questions

- Which tokenized equities exist on BNB Chain, who issues them, and what are the transfer and KYC rules?
- Which oracle feeds cover them, and what is their update cadence outside market hours?
- Does the issuer offer redemption, and at what latency?
- Should liquidations pause while the market is closed (frozen price, unfair) or run on TWAP with a wider bonus?
