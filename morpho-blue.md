# Morpho Blue

Reference research for the isolated-market core that Dawn's architecture is modeled on. Facts are from Morpho's docs, the Morpho Blue repo and whitepaper (Oct 2023), and market data dated up to Nov 26, 2026. Items marked "Dawn note" are design implications, not Morpho facts.

## What it is

A non-custodial lending primitive for the EVM. Minimal, immutable, governance-minimized base layer. One singleton contract holds all markets. Risk management, UX and compliance are meant to be built in layers on top (vaults, curators).

Sources: Morpho Blue README (GitHub), whitepaper, docs.morpho.org.

## Market = five parameters

| Parameter | Meaning |
|-----------|---------|
| loanToken | Asset supplied by lenders and borrowed |
| collateralToken | Asset posted by borrowers |
| oracle | Contract with `price()`, returns collateral priced in loan token, scaled by 1e36 |
| irm | Interest rate model contract |
| lltv | Liquidation LTV, 18 decimals |

* Market id = keccak256 of the five parameters. All five are immutable after creation.
* One collateral and one loan asset per market. Risk is isolated: a loss in one market is shared only by that market's lenders.
* Market creation is permissionless (`createMarket`). The IRM and LLTV must come from sets enabled by governance. Enabled IRMs and LLTVs cannot be disabled.
* Governance-enabled LLTVs: 38.5%, 62.5%, 77%, 86%, 91.5%, 94.5%, 96.5%, 98%. Only IRM enabled: AdaptiveCurveIRM.
* Governance cannot halt a market or change its LLTV, IRM or oracle. It can enable new LLTV/IRM options, set a per-market fee of 0 to 25% of interest, and set the fee recipient.
* Collateral is not lent out (no rehypothecation), so it stays liquid in the contract.

## Core actions

`supply`, `withdraw` (needs free liquidity), `borrow`, `repay`, `supplyCollateral`, `withdrawCollateral`, `liquidate`, plus free flash loans, callbacks on supply/repay/liquidate/flash loan, and authorization (delegated position management, with EIP-712 signature option). Amounts are tracked as shares and assets.

## Token assumptions (from the contract docs)

* ERC20 compliant (return values on transfer may be omitted).
* No fee-on-transfer, no burn functions that reduce Morpho's balance, no re-entry into Morpho.
* Loan asset should not be ERC4626.
* Liveness risks: a token that reverts on transfer, an oracle that reverts on `price()` (this blocks borrow, collateral withdrawal and liquidation), an IRM that reverts, very large amounts (~1e35) overflowing share math.

Dawn note: tokenized equities with pause, blacklist or freeze logic fall under "token can revert on transfer". A paused or blacklisted collateral token can block liquidation.

## Oracles

* Oracle-agnostic. Interface is a single `price()` function. Chosen by the market creator and immutable.
* Types in the docs: price feed oracles (Chainlink, Redstone, API3, Pyth, Chronicle), exchange-rate oracles, fixed-price oracles.
* Reference implementation: `MorphoChainlinkOracleV2` (direct, inverse, multi-feed and multi-hop routes).
* The oracle price is both the liquidation trigger and the exchange rate used when a liquidator repays debt for collateral.
* Docs state no oracle is immune to manipulation, and curators, not Morpho, are responsible for oracle selection.

Dawn note: because the oracle is immutable per market, a conservative-of-two oracle router (primary feed and DEX TWAP) and a market-hours status flag must live inside the oracle contract the market points to. The regime logic can be added as a wrapper without changing the core.

## Liquidation

* Position is healthy when LTV <= LLTV. Health factor = collateral value x LLTV / debt.
* Anyone can liquidate an unhealthy position. No close factor: the whole position can be repaid in one call.
* Liquidator repays debt and seizes collateral at a bonus, the Liquidation Incentive Factor:
  `LIF = min(1.15, 1 / (1 - 0.3 x (1 - LLTV)))`. The incentive goes entirely to the liquidator, Morpho takes no liquidation fee.
* LIF computed from the formula for the enabled LLTVs (rounded): 38.5% gives the 1.15 cap, 62.5% about 1.127, 77% about 1.074, 86% about 1.044, 94.5% about 1.017, 98% about 1.006.
* Bad debt: if LTV rises above 1/LIF, a liquidator can take all collateral while repaying only part of the debt. When collateral reaches zero with debt remaining, the bad debt is socialized across that market's lenders immediately (total supply assets reduced). Aave and Compound do not account for bad debt this way (whitepaper comparison).
* Optional periphery: a PreLiquidation contract exists in the repo (`src/periphery/pre-liquidation`), letting borrowers opt in to earlier, softer liquidation.

Dawn note: the LIF is static per market in Morpho. Dawn's regime-aware bonus would need a custom liquidation path or a pre-liquidation-style module. With a static LIF, a weekend gap larger than (1/LIF - LLTV) produces bad debt. Example: 62.5% LLTV leaves about 26% price drop before bad debt (1/1.127 = 88.7% vs 62.5%).

## Interest rate model (AdaptiveCurveIRM)

* Targets 90% utilization. A curve reacts to short-term utilization, and the rate at target adapts over time (drifts up when utilization is above target, down when below), so it needs no governance retuning across assets.
* Borrow APY = exp(borrowRate x 31,536,000 s) - 1. Supply rate = borrowRate x utilization x (1 - fee).
* Stateful: `borrowRate` is called at market creation to initialize.

## Vault layer (curation)

* Lenders usually deposit into curated vaults that allocate across Blue markets, instead of picking markets themselves.
* Vaults V1 (MetaMorpho) and Vaults V2 (adapter system, so one vault can allocate across Blue markets and other vaults). V2 roles per Morpho's risk docs: curators configure adapters, allocation caps, fees and gates; allocators move funds within those limits; sentinels can reduce caps, cancel pending actions and remove allocations in emergencies.
* Curator layer scale (data.morpho.org, updated Nov 25, 2026): 41 curators, $6.41B under curation, $20.9M annualized curation fees. Top: Steakhouse Financial $2.46B, Gauntlet $1.04B, Sentora $1.00B.

## Newer products

* Morpho Midnight: fixed-rate, fixed-term lending, launched on Base Jul 21, 2026. Deposits passed $200M in the last week of Oct 2026 (Morpho blog, Oct 2026 recap). A Midnight Adapter for Vaults was planned for Q4 2026.

## Tokenized stocks on Morpho

* Coinbase Tokenized Stocks and Robinhood Stock Tokens are live on Morpho (Base and Robinhood Chain respectively), per Morpho's October 2026 recap.
* Steakhouse Financial curated USDC markets for five Coinbase stock tokens by Sep 18, 2026 (Apple, Alphabet, Nvidia, Meta, SpaceX). LLTV 62.5% for Apple, Nvidia, Meta, SpaceX and 77% for Alphabet. Two Steakhouse High Yield USDC vaults supplied 98.9% of the largest stock-token market at that snapshot (finwire, Oct 28, 2026).
* Robinhood Stock Token borrowing confirmed Oct 22, 2026. Access excludes US persons and restricted jurisdictions, with curators deploying markets and compliance controls. Robinhood documents the tokens as debt securities, and market makers mint and burn them Monday 2am to Saturday 2am CET, so primary issuance and redemption pause on weekends.
* Other Morpho-based stock lenders from the Lending Competitors research: Lista Lending (Moolah) on BNB Chain uses Morpho-style isolated markets with about 70 bStocks, NVDAB/USD1 at 75% LLTV, Atlas oracle; Denar on Robinhood Chain uses Morpho Blue markets with a freeze guard and no shorting. Morpho with Gauntlet listed xStocks on X Layer (Nov 18-20) and Ondo SPYon/QQQon on Ethereum.
* Oracle gap seen on Morpho and Aave feeds: Friday's NVDA price held for about 50 hours over a weekend (The Defiant, Nov 19, 2026).

## Scale (newest data Nov 26, 2026)

| Metric | Value | Source |
|--------|-------|--------|
| TVL | $9.68B (down 15.2% over 30 days from a $11.64B high on Nov 5) | DefiLlama, Nov 26 |
| Total deposits / outstanding loans | $13.81B / $4.80B | data.morpho.org, Nov 25 |
| RWA deposits / loans | $1.84B / $766M | data.morpho.org, Nov 25 |
| RWA deposits / loans, earlier | $2.145B / $894M | Morpho RWA dashboard, Oct 28 |
| Listed markets / vaults | 472 markets, 335 vaults | morphowatch.com, Nov 26 (Morpho API) |

Sources differ on definitions (TVL with or without collateral, which markets are counted), so the figures are not directly comparable. Private credit tokens were about 58% of RWA deposits in CertiK's September snapshot, and a few borrowers dominated several RWA collateral markets (Sentora, Oct 1).

## What Dawn takes and changes

| Morpho Blue | Dawn |
|-------------|------|
| Five-parameter isolated market | Keep as the core market model |
| Immutable oracle, any `price()` source | Oracle router contract: conservative of primary feed and DEX TWAP, plus market-status flag |
| Static LIF, no close factor | Regime-aware liquidation bonus and bounds, tested against weekend-gap scenarios |
| Governance-approved LLTV list | Per-market LLTV chosen from a gap-quantile risk model, with regime haircuts on top |
| Curators and vaults | Curator publishes haircut tables within onchain bounds |
| Bad debt socialized per market | Keep, plus per-market reserve |
| Borrow any loan asset | Stablecoin loan asset only in v1 |

## Open points

* Whether to fork Morpho Blue (GPL-2.0-or-later core license, MIT for other files) or write a minimal core with the same market model.
* Whether market creation should be permissionless or factory-gated for tokenized equities (transfer restrictions, issuer pause and blacklist).
* Which enabled LLTV values fit equity gap risk, given the 38.5% to 98% list is fixed by Morpho governance and Dawn would set its own.

## Checked / Not checked

Checked (fetched Nov 26, 2026): docs.morpho.org pages for Blue contract reference, markets, liquidation, oracle and IRM; Morpho Blue README and `Morpho.sol` on GitHub; whitepaper text (Oct 2023); Morpho Oct 2026 recap; data.morpho.org (Nov 25), DefiLlama and morphowatch.com (Nov 26); finwire (Oct 28) and TokenPost (Nov 6) news; Lending Competitors research notes.
Newest source date: Nov 26, 2026.
Not checked: deployed contract addresses and BNB Chain deployment of Morpho Blue; audit reports; Vaults V2 contract-level details; Midnight mechanics beyond news; PreLiquidation parameters; Morpho governance forum.
