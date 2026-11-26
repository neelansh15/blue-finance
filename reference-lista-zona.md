# Reference: Lista and Zona (fetched 2026-11-26, Exa, official docs)

Standing instruction (Alki, Nov 26): when lost on a design question, consult Lista and Zona and re-fetch their latest docs with Exa.

## Lista Lending (Moolah, BNB Chain), docs.bsc.lista.org
- Moolah = Morpho Blue fork (not unmodified) with: min loan floor, resilient oracle routing, reentrancy guard, upgradeability, RBAC, per-market liquidation whitelist, provider and broker contracts. BSC Moolah 0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C, PublicLiquidator 0x882475d622c687b079f149B69a15683FCbeCC6D9.
- Oracle interface is peek(asset)->USD 1e8, not Morpho IOracle; Moolah.getPrice divides collateral/loan legs, scale 36+loanDec-collDec.
- Resilient Oracle (BNB 0xf3afD82A4071f272F403dC176916141f44E6c750): per asset main/pivot/fallback + BoundValidator + per-asset timeDeltaTolerance (0 disables staleness!). bStocks: main = Atlas, pivot = APRO, fallback = Atlas for big names (bounds 0.98-1.02); long tail Atlas only, bounds 0.99-1.01 or none.
- bStock Stock Oracle (StockOracle 0x526D09c604A17D98cb1f260a7774A239990dbDfb, StockOracleSwitch 0xb4678C3E8B49d2b95Da48458f98805da193A8498): reverts StockMarketClosed() while closed flag set, so peek/getPrice/isHealthy revert (no liquidations while closed). Flag is NOT a clock: global manager switch, per-stock bot flag, pauser emergency close.
- bStocks lending is "7/24"; Lista reserves right to pause functions per market. Loans: USDT, USD1, U, USDC.
- Atlas feed addresses per bStock are listed on docs.bsc.lista.org/for-developer/multi-oracle/multi-oracle-bstock (useful for our Atlas adapter [U]).
- Liquidation: Morpho incentive factor min(MAX, 1/(1-cursor*(1-lltv))); liquidation whitelist; PublicLiquidator for third parties.
- Not found: how StockOracle handles uiMultiplier/corp actions (the ask-query fetch timed out). Not verified.

## Zona (Zona Lend, Robinhood Chain 4663), docs.zona.finance. Aave v3 fork, USDG loan, Robinhood stock tokens
- Borrow-only schedule: open Sun 8pm to Fri 8pm ET; closed from 4pm ET the day before an NYSE holiday until 9:30am next trading day; early close 1pm; DST-mismatch weeks open Sun 9pm.
- Closed != frozen: when closed, no new borrow; repay always works without a price; supply/add collateral ok; withdraw (with debt) and liquidation continue while the price is valid.
- Last price stays usable up to 24h (Chainlink round max age 24h) if issuer/validation checks pass. Price unavailable => no borrow, no withdraw-with-debt, no liquidation; interest accrues.
- Borrow permission is a separate on-chain gate: Borrow Sentinel, Asset Borrow Gate, Session Reporter, Emergency Brake, One-way LTV Guardian (can only lower LTV), Recoverable Borrow Controller, 1h timelock, Safe. Permission expires without fresh liveness evidence; reopening needs 30 min of monitored checks (2 min recent-liveness path); proof gap >3 min restarts; governance holds and emergency restrictions never auto-clear.
- Corporate actions: Chainlink price already includes Robinhood shares-per-token multiplier; borrowing stops until multiplier and a new round reflect the action; absolute price band check; issuer pause stops valuation.
- Zero LTV = no new borrow, liquidation threshold and bonus unchanged. One collateral asset per account; shared debt ceiling per collateral; supply/borrow caps (USDG 125k each).
- Audit: Beosin.

## Takeaways for Blue
1. Zona's separate borrow gate with one-way guardian and 30-min recovery maps to our HALTED/CORP_ACTION keeper; consider an expiring borrow permission (fail-closed on keeper silence).
2. Zona keeps liquidation live on a 24h-old last price; Lista halts everything (revert) when closed. Ours: haircut + freeze sits between them.
3. Lista's bound validator vs pivot (APRO 2%) is a jump-breaker analogue; ours is upward-only.
4. Lista forked Morpho; we stay unmodified (router bypass is the cost).
