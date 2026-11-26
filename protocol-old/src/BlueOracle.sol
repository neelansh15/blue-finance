// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IOracle} from "./interfaces/IOracle.sol";
import {IAtlasFeed} from "./interfaces/IAtlasFeed.sol";
import {IBStockLike} from "./interfaces/IBStockLike.sol";
import {IRegimeRegistry, RegimeLib} from "./interfaces/IRegimeRegistry.sol";

/// @title BlueOracle
/// @notice Morpho Blue IOracle for one bStock collateral / stablecoin loan market.
///
///   price() = p_raw x (1 - h[regime]) [x (1 - h_expired) if the served last-good price is older than maxFreeze]
///   p_raw   = Atlas answer, converted to "per raw token" (x uiMultiplier/1e18 when the feed quotes per UI
///             share), scaled to Morpho's 1e36 + loanDecimals - collateralDecimals convention.
///
///   Live path: regime OPEN/EXTENDED/CLOSED/WEEKEND, not frozen, uiMultiplier unchanged since the last update,
///              feed answer valid and within staleness[regime]. Otherwise the last good price is served.
///   Frozen path: regime HALTED or CORP_ACTION, a recorded freeze (frozenSince != 0), or a uiMultiplier that
///              differs from the one the last good price was recorded with. Serves lastGoodPrice with the
///              haircut of the most conservative of (current regime, freeze cause).
///   Unfreeze: update() in a normal regime, with a valid feed price within continuityBandBps of lastGoodPrice.
///              After maxFreeze, the registry admin may force-unfreeze to the live feed price.
///   Haircut:   the haircut served is the LARGEST haircut of every regime that applies: the effective regime,
///              the calendar regime (price() only), the freeze cause while frozen, and CORP_ACTION while the
///              multiplier differs. A keeper override can therefore never lower the haircut below the calendar's,
///              whatever the configured haircut sizes are.
///   Jump breaker (upward only, optional): with an unchanged multiplier, a normal regime and no freeze, a live
///              price above lastGoodPrice x (1 + jumpBandBps) is not accepted. price() serves
///              min(live, lastGood) and update() records a jump freeze. A jump freeze ends when the live price is
///              back within continuityBandBps of lastGood or below it, or by forceUnfreeze after maxFreeze.
///              Downward jumps are deliberately NOT frozen: serving a stale higher price would let anyone borrow
///              against overvalued collateral directly on Morpho (the router is bypassable). See README.
///
/// @dev price() never reverts once a first good price exists: every external read is a bounded low-level
///      staticcall with return-size checks, and all arithmetic is range-checked before use. The only revert is
///      NoPrice() before the oracle has ever observed a valid price.
///      Rounding: every step rounds down, i.e. collateral is never overvalued by rounding.
///      The oracle has no owner. The only privileged call is forceUnfreeze (registry admin, after maxFreeze).
contract BlueOracle is IOracle {
    using RegimeLib for IRegimeRegistry.Regime;

    struct Config {
        address atlasFeed;
        address registry;
        address asset; // bStock (collateral token), source of uiMultiplier()
        uint8 loanDecimals;
        uint8 collateralDecimals;
        uint8 feedDecimals;
        bool feedPerUIShare; // [U] Atlas units unverified; true = multiply by uiMultiplier
        uint16[6] haircutsBps; // indexed by Regime enum value
        uint32[6] stalenessSec; // indexed by Regime enum value
        uint64 maxFreeze;
        uint16 continuityBandBps;
        uint16 expiredFreezeHaircutBps;
        uint32 jumpBandBps; // 0 disables the upward jump breaker; otherwise must exceed continuityBandBps
    }

    uint256 internal constant BPS = 10_000;
    uint256 public constant MAX_HAIRCUT_BPS = 5_000;
    uint256 public constant MIN_MULTIPLIER = 1e9; // bStock SecuritiesToken bound
    uint256 public constant MAX_MULTIPLIER = 1e27; // bStock SecuritiesToken bound
    uint256 public constant MAX_ANSWER = 1e40;
    uint256 public constant MIN_RAW_PRICE = 1e4; // keeps price() > 0 after max haircuts (>= 25% left)
    uint256 public constant MAX_RAW_PRICE = 1e60; // far above any real price; keeps Morpho math in range
    uint256 public constant MAX_JUMP_BAND_BPS = 1_000_000; // 100x

    IAtlasFeed public immutable ATLAS_FEED;
    IRegimeRegistry public immutable REGISTRY;
    address public immutable ASSET;
    bool public immutable FEED_PER_UI_SHARE;
    uint8 public immutable LOAN_DECIMALS;
    uint8 public immutable COLLATERAL_DECIMALS;
    uint8 public immutable FEED_DECIMALS;
    uint256 public immutable SCALE_MUL;
    uint256 public immutable SCALE_DIV;
    uint64 public immutable MAX_FREEZE;
    uint16 public immutable CONTINUITY_BAND_BPS;
    uint16 public immutable EXPIRED_FREEZE_HAIRCUT_BPS;
    uint32 public immutable JUMP_BAND_BPS;
    uint256 internal immutable HAIRCUTS_PACKED; // 6 x 16 bits
    uint256 internal immutable STALENESS_PACKED; // 6 x 32 bits

    /// Last good price per raw token, Morpho scale, BEFORE haircut.
    uint256 public lastGoodPrice;
    /// Observation time of lastGoodPrice (feed timestamp, clamped to block time).
    uint64 public lastGoodAt;
    /// 0 if not frozen.
    uint64 public frozenSince;
    /// Most conservative regime that caused the current freeze.
    IRegimeRegistry.Regime public frozenRegime;
    /// uiMultiplier that lastGoodPrice was computed with.
    uint256 public lastMultiplier;
    /// True while the current freeze was caused only by the upward jump breaker.
    bool public jumpFrozen;

    event Frozen(uint64 at);
    event Unfrozen(uint256 price);
    event PriceRecorded(uint256 rawPrice, uint64 observedAt, uint256 multiplier);
    event JumpRejected(uint256 livePrice, uint256 lastGoodPrice);

    error NoPrice();
    error InvalidConfig();
    error Unauthorized();
    error FreezeNotExpired();
    error StillFreezeRegime();
    error LivePriceUnavailable();

    constructor(Config memory c) {
        if (c.atlasFeed.code.length == 0 || c.registry.code.length == 0 || c.asset.code.length == 0) {
            revert InvalidConfig();
        }
        if (c.loanDecimals > 36 || c.collateralDecimals > 36 || c.feedDecimals > 36) revert InvalidConfig();
        if (c.maxFreeze == 0) revert InvalidConfig();
        if (c.continuityBandBps == 0 || c.continuityBandBps > MAX_HAIRCUT_BPS) revert InvalidConfig();
        if (c.expiredFreezeHaircutBps > MAX_HAIRCUT_BPS) revert InvalidConfig();
        if (c.jumpBandBps != 0 && (c.jumpBandBps <= c.continuityBandBps || c.jumpBandBps > MAX_JUMP_BAND_BPS)) {
            revert InvalidConfig();
        }

        // Haircuts must be bounded. Routine regimes must be non-decreasing (OPEN <= EXTENDED <= CLOSED <= WEEKEND)
        // and HALTED >= CORP_ACTION, so that a keeper move within either group never raises the price.
        // CORP_ACTION/HALTED may be below WEEKEND: price() never serves less than the calendar regime's haircut
        // (see _calendarFloorBps), so a keeper override cannot raise the price in that case either.
        for (uint256 i; i < 6; ++i) {
            if (c.haircutsBps[i] > MAX_HAIRCUT_BPS || c.stalenessSec[i] == 0) revert InvalidConfig();
            if (i > 0 && i < 4 && c.haircutsBps[i] < c.haircutsBps[i - 1]) revert InvalidConfig();
        }
        if (c.haircutsBps[4] < c.haircutsBps[5]) revert InvalidConfig();

        // If decimals() is readable now, it must match the configured value (feed may be whitelist-only).
        (bool okDec, uint256 dec) = _staticUint(c.atlasFeed, abi.encodeWithSelector(IAtlasFeed.decimals.selector));
        if (okDec && dec != c.feedDecimals) revert InvalidConfig();

        // p_raw = answer * mf * 10^(36 + loanDec) / (10^(feedDec + collDec) * 1e18), mf = uiMultiplier or 1e18
        uint256 numExp = 36 + uint256(c.loanDecimals);
        uint256 denExp = uint256(c.feedDecimals) + uint256(c.collateralDecimals) + 18;
        if (numExp >= denExp) {
            SCALE_MUL = 10 ** (numExp - denExp);
            SCALE_DIV = 1;
        } else {
            SCALE_MUL = 1;
            SCALE_DIV = 10 ** (denExp - numExp);
        }

        ATLAS_FEED = IAtlasFeed(c.atlasFeed);
        REGISTRY = IRegimeRegistry(c.registry);
        ASSET = c.asset;
        FEED_PER_UI_SHARE = c.feedPerUIShare;
        LOAN_DECIMALS = c.loanDecimals;
        COLLATERAL_DECIMALS = c.collateralDecimals;
        FEED_DECIMALS = c.feedDecimals;
        MAX_FREEZE = c.maxFreeze;
        CONTINUITY_BAND_BPS = c.continuityBandBps;
        EXPIRED_FREEZE_HAIRCUT_BPS = c.expiredFreezeHaircutBps;
        JUMP_BAND_BPS = c.jumpBandBps;

        uint256 h;
        uint256 s;
        for (uint256 i; i < 6; ++i) {
            h |= uint256(c.haircutsBps[i]) << (16 * i);
            s |= uint256(c.stalenessSec[i]) << (32 * i);
        }
        HAIRCUTS_PACKED = h;
        STALENESS_PACKED = s;

        // Seed state if the feed is already readable. Immutables cannot be read during construction,
        // so this uses the config values directly.
        (bool okM, uint256 m) = _staticUint(c.asset, abi.encodeWithSelector(IBStockLike.uiMultiplier.selector));
        if (okM && m >= MIN_MULTIPLIER && m <= MAX_MULTIPLIER) {
            lastMultiplier = m;
            (bool okA, uint256 a, uint256 t) = _readFeed(c.atlasFeed);
            if (okA && t <= block.timestamp) {
                uint256 x = a * (c.feedPerUIShare ? m : 1e18);
                uint256 sm = numExp >= denExp ? 10 ** (numExp - denExp) : 1;
                uint256 sd = numExp >= denExp ? 1 : 10 ** (denExp - numExp);
                if (x <= type(uint256).max / sm) {
                    uint256 p = (x * sm) / sd;
                    if (p >= MIN_RAW_PRICE && p <= MAX_RAW_PRICE) {
                        lastGoodPrice = p;
                        lastGoodAt = uint64(t);
                        emit PriceRecorded(p, uint64(t), m);
                    }
                }
            }
        }
    }

    // ================================================================ Morpho entry point

    /// @inheritdoc IOracle
    function price() external view returns (uint256) {
        return _price(_currentRegime(), _calendarFloorBps());
    }

    /// Price the oracle would return if the effective regime were `r` (UI "health at weekend", router previews).
    /// Hypothetical: applies `r` and the freeze state, but not the current calendar floor.
    function priceForRegime(IRegimeRegistry.Regime r) external view returns (uint256) {
        return _price(r, 0);
    }

    function haircutBps(IRegimeRegistry.Regime r) public view returns (uint16) {
        return uint16(HAIRCUTS_PACKED >> (16 * uint256(uint8(r))));
    }

    function stalenessSec(IRegimeRegistry.Regime r) public view returns (uint32) {
        return uint32(STALENESS_PACKED >> (32 * uint256(uint8(r))));
    }

    /// True if price() is currently served from lastGoodPrice by the freeze logic.
    function isFrozen() external view returns (bool) {
        (bool mOk, uint256 m) = _multiplier();
        IRegimeRegistry.Regime r = _currentRegime();
        if (frozenSince != 0 || r.isFreezeRegime() || !mOk || m != lastMultiplier) return true;
        (bool ok, uint256 p,) = _readAtlas(r, m);
        return ok && _jumpUp(p, lastGoodPrice); // pending jump that update() has not recorded yet
    }

    /// Live Atlas price per raw token (pre-haircut) under the current regime's staleness, for keepers/UI.
    function liveRawPrice() external view returns (bool ok, uint256 rawPrice, uint256 observedAt) {
        (bool mOk, uint256 m) = _multiplier();
        if (!mOk) return (false, 0, 0);
        return _readAtlas(_currentRegime(), m);
    }

    // ================================================================ state transitions (permissionless)

    /// @notice Records the live price, enters a freeze, or leaves a freeze if the continuity check passes.
    ///         Permissionless; keepers should call it every heartbeat and the router before borrows.
    /// @return The current lastGoodPrice after the update (pre-haircut).
    function update() external returns (uint256) {
        IRegimeRegistry.Regime r = _currentRegime();
        (bool mOk, uint256 m) = _multiplier();
        bool freezeRegime = r.isFreezeRegime();
        bool mChanged = !mOk || m != lastMultiplier;

        if (freezeRegime || mChanged) {
            IRegimeRegistry.Regime cause = freezeRegime ? r : IRegimeRegistry.Regime.CORP_ACTION;
            if (frozenSince == 0) {
                frozenSince = uint64(block.timestamp);
                frozenRegime = cause;
                emit Frozen(uint64(block.timestamp));
            } else if (cause.rank() > frozenRegime.rank()) {
                frozenRegime = cause;
            }
            jumpFrozen = false; // a registry or multiplier freeze supersedes a jump freeze
            // Stay frozen while the registry says so, or while the multiplier cannot be read.
            if (freezeRegime || !mOk) return lastGoodPrice;
            // Normal regime with a new multiplier: fall through and try the continuity check right away
            // (e.g. a dividend reinvestment where feed and multiplier moved together).
        }

        (bool ok, uint256 p, uint256 ts) = _readAtlas(r, m);
        if (!ok) return lastGoodPrice;

        if (frozenSince != 0) {
            uint256 ref = lastGoodPrice;
            // A jump freeze also ends when the price falls below the reference: downward moves are accepted.
            if (ref != 0 && !_continuous(p, ref) && !(jumpFrozen && p < ref)) return ref; // stay frozen
            frozenSince = 0;
            frozenRegime = IRegimeRegistry.Regime.OPEN;
            jumpFrozen = false;
            _record(p, ts, m, true);
            emit Unfrozen(p);
            return p;
        }

        if (_jumpUp(p, lastGoodPrice)) {
            frozenSince = uint64(block.timestamp);
            frozenRegime = r;
            jumpFrozen = true;
            emit Frozen(uint64(block.timestamp));
            emit JumpRejected(p, lastGoodPrice);
            return lastGoodPrice;
        }

        _record(p, ts, m, false);
        return lastGoodPrice;
    }

    /// @notice Escape hatch for a genuine price gap that never passes the continuity band.
    ///         Only the registry admin, only after maxFreeze has elapsed, only in a normal regime,
    ///         and only to the live feed price.
    function forceUnfreeze() external {
        if (msg.sender != REGISTRY.admin()) revert Unauthorized();
        if (frozenSince == 0 || block.timestamp <= uint256(frozenSince) + MAX_FREEZE) revert FreezeNotExpired();
        IRegimeRegistry.Regime r = _currentRegime();
        if (r.isFreezeRegime()) revert StillFreezeRegime();
        (bool mOk, uint256 m) = _multiplier();
        if (!mOk) revert LivePriceUnavailable();
        (bool ok, uint256 p, uint256 ts) = _readAtlas(r, m);
        if (!ok) revert LivePriceUnavailable();
        frozenSince = 0;
        frozenRegime = IRegimeRegistry.Regime.OPEN;
        jumpFrozen = false;
        _record(p, ts, m, true);
        emit Unfrozen(p);
    }

    // ================================================================ internals

    /// @param floorBps minimum haircut: the calendar regime's haircut for price(), 0 for previews
    function _price(IRegimeRegistry.Regime r, uint256 floorBps) internal view returns (uint256) {
        (bool mOk, uint256 m) = _multiplier();
        bool mChanged = !mOk || m != lastMultiplier;
        uint64 fs = frozenSince;
        uint256 h = _max(haircutBps(r), floorBps);
        if (fs != 0) h = _max(h, haircutBps(frozenRegime));

        if (!r.isFreezeRegime() && !mChanged && (fs == 0 || jumpFrozen)) {
            (bool ok, uint256 p,) = _readAtlas(r, m);
            // Feed missing/stale/reverting: fall back to the last good price (same multiplier).
            if (!ok) return _servedLastGood(h);
            if (fs == 0 && !_jumpUp(p, lastGoodPrice)) return _applyHaircut(p, h);
            // Upward jump (pending or recorded): never serve more than the last good price.
            uint256 live = _applyHaircut(p, h);
            uint256 lg = _servedLastGood(h);
            return live < lg ? live : lg;
        }

        if (mChanged) h = _max(h, haircutBps(IRegimeRegistry.Regime.CORP_ACTION));
        return _servedLastGood(h);
    }

    function _jumpUp(uint256 p, uint256 ref) internal view returns (bool) {
        uint256 band = JUMP_BAND_BPS;
        // p, ref <= 1e60 and band <= 1e6, so both products stay below 1e67.
        return band != 0 && ref != 0 && p * BPS > ref * (BPS + band);
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    /// Haircut of the current calendar regime, or 0 if the registry does not expose calendarRegime().
    function _calendarFloorBps() internal view returns (uint256) {
        (bool ok, uint256 v) =
            _staticUint(address(REGISTRY), abi.encodeWithSelector(IRegimeRegistry.calendarRegime.selector));
        if (!ok || v > uint256(type(IRegimeRegistry.Regime).max)) return 0;
        return haircutBps(IRegimeRegistry.Regime(v));
    }

    function _servedLastGood(uint256 hBps) internal view returns (uint256) {
        uint256 lg = lastGoodPrice;
        if (lg == 0) revert NoPrice();
        uint256 out = _applyHaircut(lg, hBps);
        // lastGoodAt <= block.timestamp by construction.
        if (block.timestamp - lastGoodAt > MAX_FREEZE) out = _applyHaircut(out, EXPIRED_FREEZE_HAIRCUT_BPS);
        return out;
    }

    /// @dev ATLAS ADAPTER. The only place that knows the feed's interface and units.
    ///      Units: measured on 2026-11-26, the real Atlas feeds quote USD per RAW token (see README), so real
    ///      deployments use FEED_PER_UI_SHARE = false. The flag stays for per-UI feeds (the mock default).
    ///      Read access: the real feeds are open to any caller; a revert is still handled as "no price".
    ///      [U] USDT is treated as exactly 1 USD; the feed is assumed to be USD-quoted.
    /// @return ok      false if the read failed, the answer is non-positive/out of range, or stale for `r`
    /// @return rawPrice price per raw collateral unit, Morpho scale, pre-haircut
    /// @return observedAt feed timestamp clamped to block.timestamp
    function _readAtlas(IRegimeRegistry.Regime r, uint256 m)
        internal
        view
        returns (bool ok, uint256 rawPrice, uint256 observedAt)
    {
        (bool okA, uint256 a, uint256 t) = _readFeed(address(ATLAS_FEED));
        if (!okA) return (false, 0, 0);
        if (t > block.timestamp) t = block.timestamp; // never trust a future timestamp beyond "now"
        if (block.timestamp - t > stalenessSec(r)) return (false, 0, 0);

        uint256 x = a * (FEED_PER_UI_SHARE ? m : 1e18); // <= 1e40 * 1e27, no overflow
        if (x > type(uint256).max / SCALE_MUL) return (false, 0, 0);
        uint256 p = (x * SCALE_MUL) / SCALE_DIV; // round down
        if (p < MIN_RAW_PRICE || p > MAX_RAW_PRICE) return (false, 0, 0);
        return (true, p, t);
    }

    /// @dev THE ONLY place that knows the Atlas read interface: latestRoundData() (latestTimestamp() reverts on
    ///      the real feeds). Never reverts. ok requires: call succeeded with >= 5 words of return data, round ids
    ///      in uint80 range, answer > 0 and <= MAX_ANSWER, updatedAt != 0, answeredInRound >= roundId.
    ///      The real feeds return roundId == answeredInRound (0 or 1) and startedAt ~ updatedAt, so there is no
    ///      roundId > 0 requirement and startedAt is ignored. updatedAt is returned unclamped.
    function _readFeed(address feed) internal view returns (bool ok, uint256 answer, uint256 updatedAt) {
        bytes memory data = abi.encodeWithSelector(IAtlasFeed.latestRoundData.selector);
        bytes memory buf = new bytes(0xa0); // fixed-size return buffer: no return-data bomb
        uint256 roundId;
        uint256 answeredIn;
        int256 ans;
        assembly ("memory-safe") {
            let out := add(buf, 0x20)
            ok := staticcall(gas(), feed, add(data, 0x20), mload(data), out, 0xa0)
            if lt(returndatasize(), 0xa0) { ok := 0 }
            roundId := mload(out)
            ans := mload(add(out, 0x20))
            updatedAt := mload(add(out, 0x60))
            answeredIn := mload(add(out, 0x80))
        }
        if (!ok || roundId > type(uint80).max || answeredIn > type(uint80).max || answeredIn < roundId) {
            return (false, 0, 0);
        }
        // A negative answer is rejected here; it must not be reinterpreted as a huge uint.
        if (ans <= 0 || uint256(ans) > MAX_ANSWER || updatedAt == 0) return (false, 0, 0);
        return (true, uint256(ans), updatedAt);
    }

    function _record(uint256 p, uint256 ts, uint256 m, bool force) internal {
        if (!force && ts < lastGoodAt) return; // ignore out-of-order observations
        lastGoodPrice = p;
        lastGoodAt = uint64(ts);
        lastMultiplier = m;
        emit PriceRecorded(p, uint64(ts), m);
    }

    function _continuous(uint256 p, uint256 ref) internal view returns (bool) {
        uint256 diff = p > ref ? p - ref : ref - p;
        return diff * BPS <= uint256(CONTINUITY_BAND_BPS) * ref; // both sides <= 1e64, no overflow
    }

    function _applyHaircut(uint256 p, uint256 hBps) internal pure returns (uint256) {
        return (p * (BPS - hBps)) / BPS; // p <= 1e60, hBps <= 5000
    }

    function _multiplier() internal view returns (bool ok, uint256 m) {
        (ok, m) = _staticUint(ASSET, abi.encodeWithSelector(IBStockLike.uiMultiplier.selector));
        if (ok && (m < MIN_MULTIPLIER || m > MAX_MULTIPLIER)) ok = false;
    }

    /// Registry failure or a garbage answer counts as HALTED (most conservative).
    function _currentRegime() internal view returns (IRegimeRegistry.Regime) {
        (bool ok, uint256 v) =
            _staticUint(address(REGISTRY), abi.encodeWithSelector(IRegimeRegistry.regime.selector, ASSET));
        if (!ok || v > uint256(type(IRegimeRegistry.Regime).max)) return IRegimeRegistry.Regime.HALTED;
        return IRegimeRegistry.Regime(v);
    }

    /// Low-level staticcall that never reverts: copies at most one word of return data
    /// (no return-data bomb), fails on missing code or short return data.
    function _staticUint(address target, bytes memory data) internal view returns (bool ok, uint256 v) {
        assembly ("memory-safe") {
            ok := staticcall(gas(), target, add(data, 0x20), mload(data), 0x00, 0x20)
            if lt(returndatasize(), 0x20) { ok := 0 }
            v := mload(0x00)
        }
        if (!ok) v = 0;
    }
}
