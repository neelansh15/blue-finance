# Tokenized Asset Lending: Architecture v0

Design draft, Nov 25, 2026. Design reasoning, not researched: issuer behavior, oracle availability and token transfer rules on BNB Chain are unverified (see Open questions).

## Thesis

An isolated-market lending protocol for tokenized equities and RWAs on BNB Chain. The differentiator is a **risk layer that knows when the underlying market is open**. Tokens trade 24/7 but the underlying equity does not, so overnight, weekend and holiday gaps are the main risk Aave-style protocols ignore.

## Why stablecoin-only borrowing (v1)

* Debt value is stable, so risk is one-sided: only collateral price matters. One oracle per market, not two.
* One interest-rate curve and one deep liquidity pool per loan asset. Lenders are stablecoin holders seeking yield.
* Borrowers want cash without selling the stock (tax, conviction, no sale), and stablecoins buy everything else.
* Caveat: stablecoin depeg risk. Pick the loan asset deliberately (USDC/USDT/USD1 on BNB) and treat it as a market parameter.
* v2: borrowable equity tokens, which enables shorting (below).

## Leverage (demand side)

* **Leveraged long:** deposit TSLA token, borrow USDC, buy more TSLA, deposit again. Looping at 67% LTV gives about 3x. One-click "leverage" vault on top of the core.
* **Short:** deposit USDC as collateral, borrow the TSLA token, sell it for USDC. Profit if TSLA falls (buy back cheaper, repay). Needs equity tokens to be borrowable, which needs lenders of the token (holders earning yield on idle stock). v2 feature.
* Both create borrow demand, which is where protocol revenue comes from.

## Components

### 1. Core: isolated markets (Morpho-Blue-style)

* A market = (collateral token, loan token, oracle, LLTV, interest rate model). Created via MarketFactory.
* Isolated: bad debt in one market never touches others.
* Minimal, auditable core. Risk logic lives in modules, not in the core.

### 2. Oracle router

* Primary: equity price feed (Chainlink / Pyth / RedStone, whichever covers the asset) or issuer NAV.
* Secondary: onchain DEX TWAP of the token (24/7 signal).
* Outputs: price, confidence, staleness, and a market-status flag.
* Collateral valuation uses the **more conservative** of primary and TWAP when they diverge. This matters when the primary is frozen while the market is closed.
* Circuit breaker: deviation beyond a threshold or staleness beyond a limit pauses new borrows and widens liquidation rules.

### 3. Market-hours regime module

* Calendar of NYSE/Nasdaq sessions and holidays, published onchain as a regime table.
* Regimes: OPEN, EXTENDED (pre/post), CLOSED (overnight), WEEKEND/HOLIDAY, HALTED.
* Each regime has an LTV haircut. Max borrowable LTV ramps down before the close (e.g. 30-60 min) so positions are de-risked ahead of the gap.
* New borrows and collateral withdrawals are restricted in CLOSED and WEEKEND regimes. Repay and supply always allowed.
* Open design question: pause liquidations while closed (price frozen, unfair) vs allow with TWAP and a wider bonus.

### 4. Risk engine

* Offchain model per asset: historical overnight and weekend gap distribution, high-quantile gap G_q (e.g. 99.5%).
* Parameter rule of thumb: LLTV_regime = 1 - (G_q + slippage + liquidation bonus). Borrow LTV sits a buffer below LLTV.
* A curator or keeper publishes the haircut table to chain within hard-coded bounds. Onchain code only enforces; it does not compute.
* Outputs: supply and borrow caps per market (sized to exit liquidity), recalibration schedule.

### 5. Liquidation engine

* Health factor per position, partial liquidation with a close factor.
* Default: liquidator repays debt and receives collateral at a bonus (liquidator carries the exit risk). Bonus is regime-aware (higher when closed or low liquidity).
* Exit venues for liquidators: DEX, propAMM (optional upgrade), issuer redemption.
* Bad debt: per-market reserve and insurance fund, then loss shared by that market's suppliers only.

### 6. Interest rate model

* Utilization-kinked curve, ideally adaptive (Morpho-style). Rate floor tuned to stablecoin yield alternatives on BNB.

### 7. Asset-specific handling

* Corporate actions (splits, dividends): pause the market around the event and adjust oracle or ratio.
* Transfer restrictions or KYC on tokens: may require a whitelisted vault or proxy to hold collateral.
* Issuer redemption as a liquidation backstop where available.

## Contracts

MarketFactory, Market (core), OracleRouter, RegimeRegistry, RiskParams, LiquidationHelper, InterestRateModel, Keeper (offchain: regime updates, parameter publishing, liquidation bot), LeverageVault (v1.5).

## Where propAMM fits

Optional exit-liquidity venue for liquidators and for the leverage vault. Not required for the risk layer.

## Build phases

1. Spec and parameter model: gap analysis on 2-3 equities, regime table, LLTV formula (backtest).
2. Core + oracle router + regime module on a BNB testnet fork, with a mock tokenized equity.
3. Liquidation engine + keeper bot + simulator showing a weekend-gap scenario (the demo).
4. Leverage vault, UI, real feeds and tokens.

Hackathon cut (36h): phases 1-3 on a fork or testnet, with a live weekend-gap liquidation simulation.

## Open questions (verify before building)

* Which tokenized equities exist on BNB Chain, who issues them, and what are the transfer and KYC rules?
* Which oracle feeds cover them, and their update cadence outside market hours?
* Does the issuer offer redemption, and at what latency?
* Do the hackathon tracks or sponsor bounties call out RWA lending specifically?
