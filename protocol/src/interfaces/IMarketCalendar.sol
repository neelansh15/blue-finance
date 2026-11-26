// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Trading status of a stock, from least to most restrictive for new borrowing.
/// @dev Enum order is part of the ABI and indexes per-status borrow limits: do not reorder.
interface IMarketCalendar {
    enum MarketStatus {
        OPEN,
        EXTENDED,
        CLOSED,
        WEEKEND,
        HALTED,
        CORP_ACTION
    }

    event OverrideSet(address indexed asset, MarketStatus state, uint64 expiry, address by);
    event OverrideCleared(address indexed asset, address by);

    /// Effective status: the most restrictive of the scheduled status, the asset's override and the global
    /// override (asset = address(0)), ignoring expired overrides.
    function status(address asset) external view returns (MarketStatus);
    function scheduledStatus() external view returns (MarketStatus);
    function scheduledStatusAt(uint256 timestamp) external view returns (MarketStatus);
    function overrideOf(address asset) external view returns (MarketStatus state, uint64 expiry);
    function setOverride(address asset, MarketStatus state, uint64 duration) external;
    function clearOverride(address asset) external;
    function setHoliday(uint32 yyyymmdd, bool closed) external;
    function setEarlyClose(uint32 yyyymmdd, bool early) external;
    function admin() external view returns (address);
    function isKeeper(address account) external view returns (bool);
}

/// Restrictiveness order: OPEN < EXTENDED < CLOSED < WEEKEND < CORP_ACTION < HALTED.
library MarketStatusLib {
    function rank(IMarketCalendar.MarketStatus s) internal pure returns (uint8) {
        if (s == IMarketCalendar.MarketStatus.HALTED) return 5;
        if (s == IMarketCalendar.MarketStatus.CORP_ACTION) return 4;
        return uint8(s); // OPEN=0, EXTENDED=1, CLOSED=2, WEEKEND=3
    }

    function moreConservative(IMarketCalendar.MarketStatus a, IMarketCalendar.MarketStatus b)
        internal
        pure
        returns (IMarketCalendar.MarketStatus)
    {
        return rank(a) >= rank(b) ? a : b;
    }
}
