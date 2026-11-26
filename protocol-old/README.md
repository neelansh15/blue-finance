# Protocol

Blue Finance smart-contract core: lending against tokenized US stocks (bStocks) on BNB Chain, on unmodified Morpho Blue.

- Design: [architecture-v1.md](../architecture-v1.md)
- Shared names: [INTERFACES.md](INTERFACES.md), with deviations listed under "Changes"

Router, deploy script and fork scenarios are included (see below). All risk parameters are labelled PLACEHOLDERS, not calibrated.

## Layout

```
foundry.toml                  solc 0.8.28 (pinned), evm shanghai, optimizer 200
lib/forge-std/                forge-std v1.9.7 (gitignored; see Setup)
src/
  RegimeRegistry.sol          on-chain US Eastern calendar (DST, holidays, early closes) + KEEPER/ADMIN overrides
  BlueOracle.sol              Morpho IOracle: Atlas adapter, uiMultiplier, regime haircuts, staleness, freeze
  libraries/EasternCalendar.sol  civil-date math (Hinnant), US DST rule, ET conversion
  interfaces/IMorpho.sol      minimal vendored Morpho Blue interface, MarketParams, MarketParamsLib.id
  interfaces/IOracle.sol      Morpho IOracle
  interfaces/IRegimeRegistry.sol  Regime enum, registry interface, RegimeLib (rank / moreConservative)
  interfaces/IAtlasFeed.sol   latestAnswer / latestRoundData / decimals (latestTimestamp reverts on real feeds)
  interfaces/IBStockLike.sol  ERC-8056 style uiMultiplier / balanceOfUI / UIMultiplierUpdated
  mocks/MockAtlasFeed.sol     owner-settable feed, can be switched to revert
  mocks/MockBStock.sol        ERC20 with scheduled uiMultiplier, for tests and the demo
test/
  RegimeRegistry.t.sol        calendar boundaries, DST, holidays, overrides, roles (24 tests)
  BlueOracle.t.sol            haircuts, splits, staleness, freeze, failure modes, fuzz (27 tests)
  fork/MorphoBnbFork.t.sol    BNB mainnet fork against the Morpho singleton (2 tests)
  BlueRouter.t.sol            router unit tests on the BNB fork (28 tests)
  scenarios/                  ScenarioBase + 7 fork scenario tests (4 demo scenarios plus variants)
src/BlueRouter.sol            borrow front door via Morpho setAuthorization, EIP-712 attestations, caps, targetLTV
script/BlueDeploy.sol         shared deploy logic (script and tests); script/Deploy.s.sol writes deployments/<chainid>.json
```

## Setup

`lib/` is gitignored. Install forge-std once:

```sh
forge install foundry-rs/forge-std@v1.9.7 --no-git
```

## Running

```sh
export PATH=/workspace/agent/work/foundry/bin:$PATH   # Foundry 1.x installed via foundryup
cd protocol-old
forge build
forge test                                  # all suites; fork suite uses the public BSC RPC
forge test --no-match-path 'test/fork/*'    # offline only
BSC_RPC_URL=https://your-node forge test --match-path 'test/fork/*' -vv
```

The fork suite reads `BSC_RPC_URL` and falls back to `https://bsc-dataseed.binance.org`. If neither can be reached, the tests are skipped rather than failed.

Last run (Nov 26 2026): 102 passed, 0 failed, 0 skipped (fork tests live against BSC mainnet; they skip if the RPC is unreachable). Fuzz tests run 512 runs each.

Deploy to an anvil fork: `anvil --fork-url https://bsc-dataseed.binance.org`, then `ANVIL_FUND_USDT=true forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast` (verified Nov 26 2026; writes deployments/56.json, an anvil fork, not mainnet).

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

## Atlas feed findings (BSC mainnet, probed 2026-11-26 13:59-14:05 UTC, public RPC)

**Oracle read-path change: NEEDS AN OPUS-LEVEL SECURITY REVIEW.** `BlueOracle._readFeed` (new, replaces the `latestAnswer` + `latestTimestamp` reads) is hand-written assembly decoding `latestRoundData()`. Review: the return buffer, range checks, the `answeredInRound >= roundId` rule, and the changed staleness semantics (updatedAt).

- **Interface (94 feeds from the Lista bStock page, 5 probed in detail):** `description()` ("SingleFeed TSLAB/USD"), `decimals()` = 8, `latestAnswer()`, `latestRoundData()` exist. `latestTimestamp()`, `latestRound()` and `version()` REVERT. `getRoundData(1)` returns the same single round. No public logs available on the free RPC.
- **Round fields:** one round only. `roundId == answeredInRound`, either 1 (68 feeds) or 0 (26 feeds). `startedAt` is updatedAt or updatedAt - 1. So the adapter requires `answeredInRound >= roundId` but not `roundId > 0`.
- **Update cadence (updatedAt age across all 94 feeds, on a US market holiday, Thanksgiving, NYSE closed):** the 26 round-0 feeds were 48-90 s old; the 68 round-1 feeds were 88 s to 3588 s old (about 1 h, median about 45 min). Feeds do update while the market is closed (extended-hours prices), but at an hourly-ish cadence. Not measured: an ordinary weekend (public RPC is not archive; no history).
- **Staleness consequence:** a 1 h live staleness (the old placeholder) sits right at the observed maximum age and would flip to the last-good fallback. The real-feed deploy path uses 2 h for OPEN/EXTENDED (CLOSED 4 h, WEEKEND 6 h unchanged). All values remain placeholders.
- **Units: per RAW token.** `balanceOfUI = raw x uiMultiplier`. SNDKB has uiMultiplier = 8e18; the feed answers $606.05 while the underlying SNDK traded at $73.6 (regular close) and $76.7 (after hours): answer = 8 x share price. Consistent: IBMB (answer 246.2 vs IBM 243.9 x 1.00976 = 246.3) and SQQQB. Inconclusive within about 1%: NVDAB, AAPLB, SPYB, SOXSB, NOKB (multipliers 1.0004-1.01). TSLAB multiplier is 1.0.
- **Scaling:** 8 decimals; answer x 1e28 = Morpho price for 18-dec collateral and 18-dec loan, per raw token (test asserts this on the fork).
- **Fork tests** (`test/fork/AtlasRealFeedFork.t.sol`): live bands, so they assert sanity, not exact prices. The registry used there has no holidays seeded, so the regime shown is the plain calendar one.
- **multiplier moves:** SNDKB at 8 suggests a split happened; the feed and multiplier relationship around a change is unobserved.

## Router (BlueRouter)

- targetLTV = LLTV x (1 - h_max) - margin, h_max over OPEN/EXTENDED/CLOSED/WEEKEND (cached at listing). With placeholders: 62.5% x 85% - 2% = 51.125%. The limit is applied to oracle.price(), which already carries the current regime's haircut, so a WEEKEND flip tightens the limit by a further 15% and a position opened at the limit in any routine regime stays healthy on Morpho after a flip to any other routine regime (test_Scenario2b). Opening in a haircut regime is deliberately conservative (haircut counted twice).
- NOT covered: HALTED (25% > h_max) can make a limit-sized position liquidatable (test_Scenario2c documents it); real price moves; the expired-freeze haircut.
- Borrow, and withdraw while debt exists, are blocked in HALTED/CORP_ACTION, when paused, when the oracle is frozen, or when the feed is not live-fresh. The gate runs before Morpho's own check. Supply collateral and repay are always allowed.
- Borrow needs an EIP-712 Eligibility(account, nonce, expiry) signature: expiry <= now + MAX_ATTESTATION_TTL, single-use nonce per account, domain bound to chain and router, low-s only.
- Caps: per-market total and per-regime (checked against post-borrow totalBorrowAssets). Guardian can pause and lower caps only. Admin is two-step.
- Bypassable by design: Morpho is permissionless, so anyone can borrow directly on the market and skip the router's rules.
- Fixed in review: withdraw previously called Morpho first, so Morpho's health revert masked the HALTED/CORP_ACTION block.

## Jump breaker (BlueOracle) - NEEDS AN OPUS-LEVEL SECURITY REVIEW

With `jumpBandBps != 0` (placeholder 30%), an UPWARD feed move above lastGood x (1 + band) with unchanged multiplier and no freeze regime is not accepted: price() serves min(live, lastGood) and update() records a jump freeze. It ends when the price returns inside the band, falls below the reference, a registry/multiplier freeze supersedes it, or the admin calls forceUnfreeze after maxFreeze. Tradeoff: downward jumps are deliberately not frozen (serving a stale higher price would allow over-borrowing and delay liquidations), so a feed-first split without CORP_ACTION is still priced live at the halved value (open issue 4). A genuine large rally is delayed until the admin acts. Tests: test/BlueOracle.t.sol "Jump" group. This logic was added by an earlier agent and has not had an independent security review.

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

1. **Atlas units: measured, one decisive data point.** See "Atlas feed findings" below. Real feeds quote per raw token (`feedPerUIShare = false`). Only SNDKB (multiplier 8) separates the two hypotheses cleanly; for multipliers near 1 the evidence is within extended-hours noise. Re-verify when a bStock with a large multiplier is the target.
2. **Atlas read access:** open to any caller on BSC (verified with eth_call from an arbitrary address on 2026-11-26).
3. **USDT is assumed to equal 1 USD.** The feed is assumed to be quoted in USD. A depeg is not modelled.
4. **Split timing (the jump breaker is upward-only, so this still applies).**
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

## Mainnet deploy

`script/DeployMainnet.s.sol` deploys one market on BNB Chain (chain id 56, asserted) for a REAL bStock and its REAL Atlas feed: registry, BlueOracle (per raw token, 2h live staleness), router, Morpho market (62.5% LLTV, AdaptiveCurveIrm) and listing. No mocks, no demo signer, no seed supply unless `SEED_SUPPLY` is set. All parameters are uncalibrated placeholders.

Env: `ATLAS_FEED`, `BSTOCK`, `ELIGIBILITY_SIGNER`, `GUARDIAN` (required, must differ from the deployer); `KEEPER` (default deployer), `SEED_SUPPLY` (optional, USDT 18 dec).

Caps (USDT, market totalBorrowAssets): total 1,000; OPEN 1,000, EXTENDED 500, CLOSED 250, WEEKEND 250, HALTED and CORP_ACTION 0. The guardian can pause and call `lowerCaps` (cannot raise); only the admin can `setCaps`.

Steps (dry run by default; `--broadcast` is added deliberately by the operator):
1. `export ATLAS_FEED=0xf569C3e52e797219eCFDc1659c3250B0BbDC693C BSTOCK=0x5b1910eAaD6450E50f816082Aa078C41F10C292f ELIGIBILITY_SIGNER=0x... GUARDIAN=0x...`
2. Key at run time only: `--account <keystore> --sender <addr>`, or `--ledger --sender <addr>`, or `PRIVATE_KEY` typed into the shell session. Never put a key in a file.
3. `forge script script/DeployMainnet.s.sol --rpc-url $BSC_RPC_URL --account <name> --sender <addr>` and review the simulation, then rerun with `--broadcast`.

Verify after deploy: `router.admin()`, `router.guardian()`, `router.marketConfig(id)` (caps), `oracle.price()` > 0, `Morpho.idToMarketParams(id)`, and `forge verify-contract` for the three contracts. Make sure the keeper calls `oracle.update()` regularly and the holiday tables are current.

### Real bStock compatibility (TSLAB, fork test `test/fork/RealBStockFork.t.sol`, 2026-11-26)

On a BSC fork with the real TSLAB token, real Atlas feed and real Morpho, the full cycle works both directly on Morpho and through BlueRouter: supplyCollateral, borrow USDT, repay, withdrawCollateral. Nothing reverted. TSLAB is a beacon proxy; `transfer`/`transferFrom` call a pause check (`isTokenPaused`) and a compliance contract (`checkIsCompliant(token, address)`) for both sides, and both passed for Morpho, BlueRouter and a fresh holder at that block. Caveats: the holder balance was set with `deal()`, the router test mocks only the feed timestamp (to pass the staleness gate after warping to an OPEN session), and `uiMultiplier` was 1e18 (SNDKB, multiplier 8, was not cycled). The issuer can still pause the token or add compliance rules at any time, which would block Morpho transfers (and so repay, withdraw and liquidation); that risk is outside the protocol's control.
