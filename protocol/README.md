# Protocol

Dawn Finance smart-contract core: lending against tokenized US stocks (bStocks) on BNB Chain, on unmodified Morpho Blue.

- Design: [architecture-v1.md](../architecture-v1.md)
- Shared names: [INTERFACES.md](INTERFACES.md), with deviations listed under "Changes"

The router and deploy scripts are not written yet; they come in a later phase.

## Layout

```
foundry.toml                  solc 0.8.28 (pinned), evm shanghai, optimizer 200
lib/forge-std/                forge-std v1.9.7, vendored (no git submodule)
src/
  RegimeRegistry.sol          on-chain US Eastern calendar (DST, holidays, early closes) + KEEPER/ADMIN overrides
  DawnOracle.sol              Morpho IOracle: Atlas adapter, uiMultiplier, regime haircuts, staleness, freeze
  libraries/EasternCalendar.sol  civil-date math (Hinnant), US DST rule, ET conversion
  interfaces/IMorpho.sol      minimal vendored Morpho Blue interface, MarketParams, MarketParamsLib.id
  interfaces/IOracle.sol      Morpho IOracle
  interfaces/IRegimeRegistry.sol  Regime enum, registry interface, RegimeLib (rank / moreConservative)
  interfaces/IAtlasFeed.sol   latestAnswer / latestTimestamp / decimals
  interfaces/IBStockLike.sol  ERC-8056 style uiMultiplier / balanceOfUI / UIMultiplierUpdated
  mocks/MockAtlasFeed.sol     owner-settable feed, can be switched to revert
  mocks/MockBStock.sol        ERC20 with scheduled uiMultiplier, for tests and the demo
test/
  RegimeRegistry.t.sol        calendar boundaries, DST, holidays, overrides, roles (24 tests)
  DawnOracle.t.sol            haircuts, splits, staleness, freeze, failure modes, fuzz (27 tests)
  fork/MorphoBnbFork.t.sol    BNB mainnet fork against the Morpho singleton (2 tests)
```

## Running

```sh
export PATH=/workspace/agent/work/foundry/bin:$PATH   # Foundry 1.x installed via foundryup
cd protocol
forge build
forge test                                  # all suites; fork suite uses the public BSC RPC
forge test --no-match-path 'test/fork/*'    # offline only
BSC_RPC_URL=https://your-node forge test --match-path 'test/fork/*' -vv
```

The fork suite reads `BSC_RPC_URL` and falls back to `https://bsc-dataseed.binance.org`. If neither can be reached, the tests are skipped rather than failed.

Last run (Nov 26 2026): 53 passed, 0 failed, 0 skipped. Fuzz tests run 512 runs each. The fork tests ran live against BSC mainnet.

## How it works (short)

### Registry

- `regime(asset)` returns the most conservative of three inputs: the calendar regime, the asset's override, and the global override (`address(0)`). Overrides are ignored once they expire.
- Conservativeness order: OPEN < EXTENDED < CLOSED < WEEKEND < CORP_ACTION < HALTED.
- Keeper overrides:
  - Never OPEN.
  - Duration must be at most `MAX_OVERRIDE` (30 days hard cap).
  - While an override is active, it can only be replaced by an equal or more conservative state, with the same or a later expiry.
  - Relaxing an override means clearing it. The admin can always clear; a keeper can clear only if the admin enabled `keeperCanClear`.
- Calendar (ET):
  - Normal trading day:
    - 04:00-09:30 EXTENDED
    - 09:30-16:00 OPEN
    - 16:00-20:00 EXTENDED
    - 20:00-04:00 CLOSED
  - Early-close days run OPEN until 13:00, then EXTENDED until 17:00.
  - WEEKEND covers Friday 20:00 to Sunday 20:00, every holiday until 20:00, and any overnight period that leads into a holiday.

### Oracle

- Formula: `price() = p_raw * (1 - h[regime])`, where `p_raw` is the Atlas answer converted to per raw token and to Morpho's `1e36 + loanDec - collDec` scale.
- Live path: used when the regime is not HALTED or CORP_ACTION, the oracle is not frozen, the multiplier has not changed, and the feed is valid and fresh for the current regime.
- Fallback: if the feed is reverting, garbage or stale, the oracle serves `lastGoodPrice` with the current regime's haircut.
- Freeze triggers:
  - A HALTED or CORP_ACTION regime.
  - A `uiMultiplier` that differs from the one the last good price was recorded with.
  - An unreadable multiplier.
- While frozen, the oracle serves `lastGoodPrice` with the haircut of the most conservative of the current regime and the freeze cause.
- Unfreezing:
  - `update()` unfreezes only if the live price is within `continuityBandBps` of `lastGoodPrice`.
  - After `maxFreeze`, the registry admin can call `forceUnfreeze()` to accept a genuine gap.
- Old prices: a served last-good price older than `maxFreeze` takes an extra `expiredFreezeHaircutBps`.
- Failure handling: a reverting registry or an out-of-range enum is treated as HALTED.
- Never reverts: every external read is a bounded staticcall that checks the return size, so `price()` does not revert. The only exception is `NoPrice()` before the first valid observation.

## Security notes

- Rounding: every division rounds down (scaling and each haircut), so collateral is never overvalued by rounding. This gives liquidators a dust-level edge.
- Zero price: answers of 0 or below are rejected. Raw prices must lie in `[1e4, 1e60]`, and haircuts are capped at 50% each, so `price()` is never 0 once a price exists.
- Overflow:
  - Answers are capped at 1e40 and the multiplier at 1e27.
  - The product is checked against `SCALE_MUL` before multiplying.
  - Haircut and continuity products stay below 1e65.
- Monotone haircuts: the constructor requires haircuts to be non-decreasing in conservativeness order, so a keeper's override can never raise the price.
- DST: computed on-chain from the US rule.
  - DST starts on the 2nd Sunday of March at 07:00 UTC and ends on the 1st Sunday of November at 06:00 UTC.
  - Test vectors were generated independently with the tz database (Node Intl), not with the contract's own code.
- Feed timestamps in the future are clamped to the current block time. Out-of-order observations are ignored.

## Unverified assumptions and open issues

1. **Atlas units are unverified.** It is not known whether the Atlas price is per UI share or per raw token. The `feedPerUIShare` flag covers both, and `_readAtlas` is the only adapter that would need to change.
2. **Atlas read access is unverified.** It is not known whether reads are open or whitelist-only. A revert is handled as "no price", and `decimals()` is checked only if it is readable at deploy time.
3. **USDT is assumed to equal 1 USD.** The feed is assumed to be quoted in USD. A depeg is not modelled.
4. **Split timing (no jump breaker).**
   - If a per-UI feed switches to post-split prices before `uiMultiplier` changes, and no keeper has set CORP_ACTION, the oracle prices live at the halved value.
   - `test_Split_FeedFirstWithoutFlag_IsLiveGap` documents this.
   - Mitigation: the keeper must flag CORP_ACTION when a `UIMultiplierUpdated` event is scheduled (the event fires at scheduling time). A deviation breaker is a candidate follow-up.
5. **Keepers must call `update()` regularly.** Otherwise the fallback `lastGoodPrice` can be old. Old prices are still covered by the expired-freeze haircut.
6. **Haircuts step at regime boundaries** instead of ramping. A position at the edge can become liquidatable at Friday 20:00. The router's target LTV must leave room for the WEEKEND haircut.
7. **A genuine price gap after a halt stays frozen** until the price comes back within the band or the admin calls `forceUnfreeze()` after `maxFreeze`.
8. **Feed calls forward all gas.** A malicious or upgraded feed could grief gas. The feed is a trusted, immutable address.
9. **`NoPrice()` reverts** before the oracle's first valid observation. Deploy only when the feed is readable; the constructor seeds the price if it can.
10. **The holiday and early-close tables must be seeded by the admin** each year. The calendar does not know holidays on its own.
11. **An unreadable or out-of-bounds `uiMultiplier`** (for example a paused token) keeps the oracle frozen at the CORP_ACTION haircut.
12. **Early-close post-market hours are assumed.** Post-market is assumed to end at 17:00 ET.
13. **Fork test results are live, not pinned.** Morpho on BSC (`0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a`) reported `isLltvEnabled(0.625e18) = true` and `isIrmEnabled(0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979) = true` on Nov 26 2026. The fork uses the latest block, not a pinned one.
14. **MockBStock has no compliance or pause logic,** and it allows an immediate `effectiveAt`. The real token requires a future `effectiveAt`.
