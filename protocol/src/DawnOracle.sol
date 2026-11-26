// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IOracle} from "./interfaces/IOracle.sol";
import {IAtlasFeed} from "./interfaces/IAtlasFeed.sol";
import {IBStockLike} from "./interfaces/IBStockLike.sol";
import {IRegimeRegistry, RegimeLib} from "./interfaces/IRegimeRegistry.sol";

/// @title DawnOracle
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
///
/// @dev price() never reverts once a first good price exists: every external read is a bounded low-level
///      staticcall with return-size checks, and all arithmetic is range-checked before use. The only revert is
///      NoPrice() before the oracle has ever observed a valid price.
///      Rounding: every step rounds down, i.e. collateral is never overvalued by rounding.
///      The oracle has no owner. The only privileged call is forceUnfreeze (registry admin, after maxFreeze).
contract DawnOracle is IOracle {
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
    }

    uint256 internal constant BPS = 10_000;
    uint256 public constant MAX_HAIRCUT_BPS = 5_000;
    uint256 public constant MIN_MULTIPLIER = 1e9; // bStock SecuritiesToken bound
    uint256 public constant MAX_MULTIPLIER = 1e27; // bStock SecuritiesToken bound
    uint256 public constant MAX_ANSWER = 1e40;
    uint256 public constant MIN_RAW_PRICE = 1e4; // keeps price() > 0 after max haircuts (>= 25% left)
    uint256 public constant MAX_RAW_PRICE = 1e60; // far above any real price; keeps Morpho math in range

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

    event Frozen(uint64 at);
    event Unfrozen(uint256 price);
    event PriceRecorded(uint256 rawPrice, uint64 observedAt, uint256 multiplier);

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

        // Haircuts must be bounded and non-decreasing in conservativeness order
        // OPEN, EXTENDED, CLOSED, WEEKEND, CORP_ACTION, HALTED, so that a more conservative regime
        // (the only move a keeper can make) never raises the price.
        uint8[6] memory order = [0, 1, 2, 3, 5, 4];
        for (uint256 i; i < 6; ++i) {
            if (c.haircutsBps[i] > MAX_HAIRCUT_BPS || c.stalenessSec[i] == 0) revert InvalidConfig();
            if (i > 0 && c.haircutsBps[order[i]] < c.haircutsBps[order[i - 1]]) revert InvalidConfig();
        }

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
            (bool okA, uint256 a) =
                _staticUint(c.atlasFeed, abi.encodeWithSelector(IAtlasFeed.latestAnswer.selector));
            (bool okT, uint256 t) =
                _staticUint(c.atlasFeed, abi.encodeWithSelector(IAtlasFeed.latestTimestamp.selector));
            if (okA && okT && a > 0 && a <= MAX_ANSWER && t != 0 && t <= block.timestamp) {
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
        return _price(_currentRegime());
    }

    /// Price the oracle would return if the effective regime were `r` (UI "health at weekend", router previews).
    function priceForRegime(IRegimeRegistry.Regime r) external view returns (uint256) {
        return _price(r);
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
        return frozenSince != 0 || _currentRegime().isFreezeRegime() || !mOk || m != lastMultiplier;
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
            // Stay frozen while the registry says so, or while the multiplier cannot be read.
            if (freezeRegime || !mOk) return lastGoodPrice;
            // Normal regime with a new multiplier: fall through and try the continuity check right away
            // (e.g. a dividend reinvestment where feed and multiplier moved together).
        }

        (bool ok, uint256 p, uint256 ts) = _readAtlas(r, m);
        if (!ok) return lastGoodPrice;

        if (frozenSince != 0) {
            uint256 ref = lastGoodPrice;
            if (ref != 0 && !_continuous(p, ref)) return ref; // stay frozen
            frozenSince = 0;
            frozenRegime = IRegimeRegistry.Regime.OPEN;
            _record(p, ts, m, true);
            emit Unfrozen(p);
            return p;
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
        _record(p, ts, m, true);
        emit Unfrozen(p);
    }

    // ================================================================ internals

    function _price(IRegimeRegistry.Regime r) internal view returns (uint256) {
        (bool mOk, uint256 m) = _multiplier();
        bool mChanged = !mOk || m != lastMultiplier;
        uint64 fs = frozenSince;

        if (fs == 0 && !r.isFreezeRegime() && !mChanged) {
            (bool ok, uint256 p,) = _readAtlas(r, m);
            if (ok) return _applyHaircut(p, haircutBps(r));
            // Feed missing/stale/reverting: fall back to the last good price (same multiplier).
            return _servedLastGood(haircutBps(r));
        }

        IRegimeRegistry.Regime hr = r;
        if (fs != 0) hr = RegimeLib.moreConservative(hr, frozenRegime);
        if (mChanged) hr = RegimeLib.moreConservative(hr, IRegimeRegistry.Regime.CORP_ACTION);
        return _servedLastGood(haircutBps(hr));
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
    ///      [U] Units: per UI share (x uiMultiplier) vs per raw token is unverified; selected by FEED_PER_UI_SHARE.
    ///      [U] Read access: if Dawn is not whitelisted the calls revert, which is handled as "no price".
    ///      [U] USDT is treated as exactly 1 USD; the feed is assumed to be USD-quoted.
    /// @return ok      false if the read failed, the answer is non-positive/out of range, or stale for `r`
    /// @return rawPrice price per raw collateral unit, Morpho scale, pre-haircut
    /// @return observedAt feed timestamp clamped to block.timestamp
    function _readAtlas(IRegimeRegistry.Regime r, uint256 m)
        internal
        view
        returns (bool ok, uint256 rawPrice, uint256 observedAt)
    {
        (bool okA, uint256 a) =
            _staticUint(address(ATLAS_FEED), abi.encodeWithSelector(IAtlasFeed.latestAnswer.selector));
        // A negative int256 reads as a huge uint256, so the MAX_ANSWER bound also rejects it.
        if (!okA || a == 0 || a > MAX_ANSWER) return (false, 0, 0);

        (bool okT, uint256 t) =
            _staticUint(address(ATLAS_FEED), abi.encodeWithSelector(IAtlasFeed.latestTimestamp.selector));
        if (!okT || t == 0) return (false, 0, 0);
        if (t > block.timestamp) t = block.timestamp; // never trust a future timestamp beyond "now"
        if (block.timestamp - t > stalenessSec(r)) return (false, 0, 0);

        uint256 x = a * (FEED_PER_UI_SHARE ? m : 1e18); // <= 1e40 * 1e27, no overflow
        if (x > type(uint256).max / SCALE_MUL) return (false, 0, 0);
        uint256 p = (x * SCALE_MUL) / SCALE_DIV; // round down
        if (p < MIN_RAW_PRICE || p > MAX_RAW_PRICE) return (false, 0, 0);
        return (true, p, t);
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
