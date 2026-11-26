# Dawn shared interfaces (v0, contract between workstreams)

Source of truth for names. Agents may add to this but must not rename without noting it at the bottom under "Changes".

## Regime enum (uint8, order matters)
`OPEN=0, EXTENDED=1, CLOSED=2, WEEKEND=3, HALTED=4, CORP_ACTION=5`
Conservativeness order for keeper moves: OPEN < EXTENDED < CLOSED < WEEKEND < CORP_ACTION < HALTED.

## IRegimeRegistry
```solidity
enum Regime { OPEN, EXTENDED, CLOSED, WEEKEND, HALTED, CORP_ACTION }
function regime(address asset) external view returns (Regime);          // effective: max(calendar, override) by conservativeness
function calendarRegime() external view returns (Regime);               // from ET session table + holidays
function overrideOf(address asset) external view returns (Regime state, uint64 expiry);
function setOverride(address asset, Regime r, uint64 duration) external; // KEEPER: only more conservative, duration <= MAX_OVERRIDE
function clearOverride(address asset) external;                          // KEEPER or ADMIN; keeper clear allowed only after expiry-independent check flag set by admin? (see registry docs)
function setHoliday(uint32 yyyymmdd, bool closed) external;              // ADMIN
function setEarlyClose(uint32 yyyymmdd, bool early) external;            // ADMIN
event OverrideSet(address indexed asset, Regime r, uint64 expiry, address by);
event OverrideCleared(address indexed asset, address by);
```
Calendar is US Eastern with DST computed on-chain (second Sunday of March to first Sunday of November). Sessions: pre 04:00-09:30 EXTENDED, regular 09:30-16:00 OPEN, post 16:00-20:00 EXTENDED, 20:00-04:00 weekday CLOSED, Fri 20:00 to Sun 20:00 WEEKEND, holidays WEEKEND.

## IDawnOracle (also Morpho IOracle)
```solidity
function price() external view returns (uint256);          // Morpho scale 1e36 adjusted for decimals
function lastGoodPrice() external view returns (uint256);
function frozenSince() external view returns (uint64);     // 0 if not frozen
function haircutBps(IRegimeRegistry.Regime r) external view returns (uint16);
event Frozen(uint64 at); event Unfrozen(uint256 price);
```
Immutable constructor params: atlasFeed adapter, registry, asset, loan/collateral decimals, haircuts[6], maxFreeze, stalenessPerRegime[6], continuityBandBps.

## IBStockLike (ERC-8056 style)
```solidity
function uiMultiplier() external view returns (uint256);   // 1e18 scale
function balanceOfUI(address) external view returns (uint256);
event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier);
```

## IAtlasFeed (Chainlink AggregatorV2/V3-compatible subset)
```solidity
function latestAnswer() external view returns (int256);
function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
function decimals() external view returns (uint8);
```

Dawn reads ONLY `latestRoundData()` (updatedAt for staleness). `latestTimestamp()` was removed from the interface: it reverts on the real Atlas feeds.

## Keeper -> chain
Keeper hot key holds KEEPER role on the registry. Keeper reads `regime(asset)`, `calendarRegime()`, `overrideOf(asset)`, oracle `frozenSince()` and `uiMultiplier()`.

## Changes

Atlas read path, Nov 26 2026 (NEEDS AN OPUS-LEVEL SECURITY REVIEW):
- **IAtlasFeed:** `latestTimestamp()` removed, `latestRoundData()` added. DawnOracle reads feeds through the single adapter `_readFeed(address)`. Accepts only: return data of at least 5 words, round ids within uint80, `answeredInRound >= roundId`, `0 < answer <= MAX_ANSWER`, `updatedAt != 0`. Failure means "no price" (never reverts). `MockAtlasFeed` is unchanged (it keeps `latestTimestamp()` as an extra view).
- **Units:** real Atlas feeds quote per raw token, so real deployments use `feedPerUIShare = false`; the mock default stays per UI share.
- **DawnDeploy / Deploy.s.sol:** `realAtlasFeed` / `realBStock` hooks, env `ATLAS_FEED` / `BSTOCK`. Unset keeps the mock path. With a real feed: per raw token, 2 h live staleness, `Deployment.feed` is address(0).
- **Tests:** test/AtlasAdapter.t.sol (10), test/fork/AtlasRealFeedFork.t.sol (4). Existing tests unchanged.

Protocol core (registry, oracle, mocks), Nov 26 2026. No names above were renamed. Additions and one deviation:

- **IBStockLike event (deviation):** `UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)`. It has 3 arguments to match the real bStock SecuritiesToken ABI. Indexers and keepers must use this signature. MockBStock also emits `UIMultiplierChangeOverwritten(uint256, uint256)` and exposes `pendingMultiplier()`, `hasPendingMultiplier()`, `setUIMultiplier(new, effectiveAt)`, `setUIMultiplierNow(new)`, `toUIAmount` and `fromUIAmount`.
- **IRegimeRegistry additions:**
  - Views: `admin()`, `isKeeper(address)`, `calendarRegimeAt(uint256 ts)`, `keeperCanClear()`, `pendingAdmin()`, `MAX_OVERRIDE()`.
  - Admin calls: `setHolidays(uint32[], bool)`, `setEarlyCloses(uint32[], bool)`, `setKeeper(address, bool)`, `setKeeperCanClear(bool)`, `transferAdmin(address)`, `acceptAdmin()`.
  - Constructor: `(admin, keeper, maxOverride <= 30 days, keeperCanClear)`.
- **Override rules:**
  - `asset = address(0)` is a global override that applies to every asset.
  - An override can never be OPEN.
  - While an override is active, a new one must be at least as conservative and must not expire earlier.
  - `clearOverride`: the ADMIN can always clear. A KEEPER can clear only when `keeperCanClear` is set.
- **Calendar detail:**
  - Early-close days run 09:30-13:00 OPEN and 13:00-17:00 EXTENDED.
  - The overnight period after a Friday, or before a holiday, is WEEKEND.
  - Sunday 20:00 onward is CLOSED, or WEEKEND if Monday is a holiday.
- **IDawnOracle additions:**
  - Calls: `update()` (permissionless: records the price, freezes or unfreezes), `forceUnfreeze()` (registry admin, only after maxFreeze).
  - Views: `priceForRegime(Regime)`, `isFrozen()`, `liveRawPrice()`, `stalenessSec(Regime)`, `lastGoodAt()`, `lastMultiplier()`, `frozenRegime()`.
  - Event: `PriceRecorded(uint256 rawPrice, uint64 observedAt, uint256 multiplier)`.
  - Constructor: takes a `DawnOracle.Config` struct. Besides the params listed above, it adds `feedDecimals`, `feedPerUIShare` and `expiredFreezeHaircutBps`.
  - `lastGoodPrice` is stored pre-haircut.
  - The oracle also freezes on its own when `uiMultiplier()` differs from the multiplier the last good price was recorded with.
