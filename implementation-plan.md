# Blue Finance: implementation plan (v1)

Plan to build the design in [architecture-v1.md](architecture-v1.md): lending for tokenized US stocks on BNB Chain, on top of unmodified Morpho Blue. Section references (§) point to that document. Items marked **[U]** are unverified.

## 1. Scope

**Demo (BNB Bangkok, demo Nov 27, 2026):** one market (bStock collateral, USDT loan, 62.5% LLTV), BlueOracle v0, RegimeRegistry, Router v0, keeper script, liquidation bot, and a UI with UI-unit balances, a regime badge and health "now / at weekend" (§13).

**Later:** wrapper C3, real eligibility service, Vault V2, PreLiquidation onboarding, halt monitor, production keepers, gap-quantile pipeline, dividend ex-date logic, audits (§13 phases 2 and 3).

**Out of scope for v1:** shorting, leverage vault, forking Morpho, a DEX TWAP in the oracle (Pancake TWAP is a backup, not implemented in this version).

## 2. Repo layout

```
protocol/
  src/        BlueOracle, RegimeRegistry, BlueRouter, mocks (MockAtlasFeed, MockBStock)
  test/       Foundry tests and fork tests
  script/     deploy and market creation
keepers/      regime keeper, multiplier watcher, liquidation bot (TypeScript)
frontend/     Next.js app (existing landing page, plus the demo app)
```

Toolchain: Foundry (Solidity), viem for scripts, Next.js for the UI.

## 3. Workstreams and tasks

### WS1. Environment and fork
1. Foundry project in `protocol/`, pinned solc version, remappings for the Morpho Blue interfaces.
2. Fork BNB mainnet. Morpho Blue singleton `0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a`, AdaptiveCurveIrm `0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979`.
3. Check `isLltvEnabled(0.625e18)` and `isIrmEnabled` on the fork. **[U]** If 62.5% is not enabled on BNB, fall back to an enabled LLTV, or deploy a local Morpho on testnet for the demo.

**Done when:** a fork test can call `createMarket` and `supply` against the canonical singleton.

### WS2. RegimeRegistry
1. States: OPEN, EXTENDED, CLOSED, WEEKEND, HALTED, CORP_ACTION.
2. Calendar view (US Eastern session times, holidays table) plus a keeper-set override for HALTED and CORP_ACTION.
3. Keeper role can only move toward a more conservative state, or freeze, for a bounded duration (§2). Admin role sets the calendar.
4. Read function `regime(asset)` used by the oracle and the router.

**Tests:** every calendar boundary (Friday close, Monday pre-market, holiday), override expiry, role limits.

### WS3. BlueOracle (C2)
1. Implements Morpho's `IOracle.price()` (scale 1e36 adjusted for the token decimals).
2. Steps (§1): read Atlas, apply `uiMultiplier()` if the feed quotes per UI share, apply `(1 − h[regime])`, enforce a staleness limit per regime, return the last good price during a freeze, never revert in the normal path.
3. `h[regime]` is immutable per market. Values are placeholders until the gap-quantile work (§11); the landing-page numbers (4% / 10% / 15%) are illustrative only.
4. Atlas read wrapped in try/catch so a feed failure falls back to the last good price.
5. Freeze has a maximum duration. Unfreezing requires a price-continuity check against the pre-freeze price.
6. Mock Atlas feed with the same interface for the demo.
7. Atlas Chainlink-style interface, units (per UI share or per raw token), and read access are **[U]** (§14, questions 1 and 2). Isolate them behind one adapter function.

**Tests:** price continuity across a 2-for-1 multiplier update, haircut applied per regime, staleness fallback, freeze expiry, no revert when the feed reverts.

### WS4. BlueRouter (C4)
1. `supplyCollateralAndBorrow`, `repay`, `withdraw`, using Morpho `setAuthorization`.
2. Borrow limit `targetLTV(regime) = LLTV × (1 − h_max) − margin`, so a regime switch alone never makes a fresh position liquidatable (§5).
3. Eligibility attestation check (EIP-712 signature, short expiry). Stub signer for the demo.
4. Per-asset and per-regime caps.
5. Router is bypassable without wrapper C3. State this in the demo notes (§5 table).

**Tests:** borrow rejected above targetLTV in WEEKEND, allowed in OPEN, attestation expiry, caps.

### WS5. Market and mock token
1. `MockBStock` implementing the ERC-8056 style `uiMultiplier()` and `balanceOfUI` for demos. On the fork, use the real bStock where its compliance rules allow.
2. Deployment script: oracle, registry, router, `createMarket` for bStock/USDT at 62.5% LLTV with AdaptiveCurveIrm, seed supply.

### WS6. Keepers (C8)
1. **Regime keeper:** pushes calendar changes, sets HALTED or CORP_ACTION on a signal.
2. **Multiplier watcher:** listens for `UIMultiplierUpdated`, sets CORP_ACTION, and checks the oracle price stays continuous before returning to normal (§4).
3. **Liquidation bot:** scans positions, liquidates unhealthy ones using the Morpho callback so no flash loan is needed.
4. Demo control script: flip regime, change the multiplier, move the mock price.
5. **Halt monitor** (small version for the demo, full version later), per architecture §7:
   - Nasdaq halt RSS, at most once per minute.
   - Binance bapi `/asset/market/status/ai` per bStock (poll every 30-60s). Use `type=3` on `/stock/detail/list/ai` to get contract addresses.
   - Binance Spot `exchangeInfo` status.
   - Any signal can only move the regime to HALTED or CORP_ACTION. Clearing needs a Nasdaq resumption, bapi status TRADING and the price-continuity check. A fetch failure counts as unknown, never as clear.
   - The session clock is computed locally from the ET table and a holiday calendar; the bapi market status is a cross-check only.
   - Before relying on it, verify live that ASSET_PAUSED fires on a real split or dividend pause, and what `marketStatus` returns for bStocks.
6. Production items (later): SEC suspension feed, sentinel bot for cap cuts.

### WS7. UI
1. UI-unit balances via `balanceOfUI`.
2. Regime badge and the current haircut.
3. Health shown "now" and "at weekend".
4. Corporate-action banner.
5. Borrow form wired to the router with targetLTV preview.
6. ScaledUI-aware display (optional, noted in §9).

### WS8. Demo scenarios (§13)
1. Borrow during OPEN.
2. Flip to WEEKEND: borrow limit tightens, health drops, fresh positions are not liquidated.
3. 2-for-1 multiplier update: a naive oracle triggers mass liquidation, BlueOracle stays continuous.
4. Gap: price drops, the liquidation bot closes the position.

Each scenario is one script plus one fork test, so the demo and the tests share code.

## 4. Order and dependencies

| Step | Work | Depends on |
|---|---|---|
| 1 | WS1 environment and fork | none |
| 2 | WS2 RegimeRegistry, WS5 mock token | 1 |
| 3 | WS3 BlueOracle | 2 |
| 4 | WS5 market deploy script | 3 |
| 5 | WS4 BlueRouter | 2, 4 |
| 6 | WS6 keepers and liquidation bot | 4, 5 |
| 7 | WS8 scenario scripts and tests | 5, 6 |
| 8 | WS7 UI wired to the demo | 5 (can start on mocked data earlier) |

WS7 UI work can run in parallel with steps 2 to 6 using mocked numbers.

## 5. Testing

- Unit tests per contract (Foundry).
- Fork tests against the canonical Morpho singleton for market creation, borrow, and liquidation.
- Invariants: BlueOracle price is continuous across a multiplier update of the same value; a position opened at or under targetLTV is never liquidatable by a regime switch alone.
- Scenario tests mirror the four demo scenarios.

## 6. Risks to the plan

| Risk | Effect | Mitigation |
|---|---|---|
| 62.5% LLTV not enabled on BNB **[U]** | Market cannot be created on the fork | Use an enabled LLTV, or a local Morpho deploy |
| Atlas feed access, units **[U]** | Oracle adapter changes | Single adapter function, mock feed with the same interface |
| bStock compliance blocks the Morpho singleton or router | Real-token demo fails | Use MockBStock for the demo |
| Router bypass without C3 | Ineligible users can borrow raw | Phase 2 wrapper, documented limit |
| Placeholder haircut values | Demo numbers are not calibrated | Label as illustrative until §11 pipeline runs |

## 7. Open questions that block later phases

See §14 in architecture-v1.md: Atlas units and access (1, 2), compliance rule type (3), issuer stance on protocol contracts (4), eligibility endpoint (6), Morpho DAO fee policy (7), dividend credit lag (9), issuer contract migration (10).

## 8. Definition of done for the demo

- Market created on the fork with BlueOracle and RegimeRegistry.
- All four scenarios run end to end from scripts and pass as tests.
- UI shows balances in UI units, the regime badge, and health now and at weekend.
- Placeholder parameters and unverified items are labeled in the UI notes and in this document.
