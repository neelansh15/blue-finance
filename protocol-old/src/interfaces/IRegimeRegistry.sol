// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Shared interface, see protocol-old/INTERFACES.md. Enum order is part of the ABI: do not reorder.
interface IRegimeRegistry {
    enum Regime {
        OPEN,
        EXTENDED,
        CLOSED,
        WEEKEND,
        HALTED,
        CORP_ACTION
    }

    event OverrideSet(address indexed asset, Regime r, uint64 expiry, address by);
    event OverrideCleared(address indexed asset, address by);

    /// Effective regime: the more conservative of the calendar regime, the asset's override and the global
    /// override (asset = address(0)), ignoring expired overrides.
    function regime(address asset) external view returns (Regime);
    function calendarRegime() external view returns (Regime);
    function overrideOf(address asset) external view returns (Regime state, uint64 expiry);
    function setOverride(address asset, Regime r, uint64 duration) external;
    function clearOverride(address asset) external;
    function setHoliday(uint32 yyyymmdd, bool closed) external;
    function setEarlyClose(uint32 yyyymmdd, bool early) external;

    /// Additions (see INTERFACES.md "Changes").
    function admin() external view returns (address);
    function isKeeper(address account) external view returns (bool);
    function calendarRegimeAt(uint256 timestamp) external view returns (Regime);
}

/// Conservativeness order: OPEN < EXTENDED < CLOSED < WEEKEND < CORP_ACTION < HALTED.
library RegimeLib {
    function rank(IRegimeRegistry.Regime r) internal pure returns (uint8) {
        if (r == IRegimeRegistry.Regime.HALTED) return 5;
        if (r == IRegimeRegistry.Regime.CORP_ACTION) return 4;
        return uint8(r); // OPEN=0, EXTENDED=1, CLOSED=2, WEEKEND=3
    }

    function moreConservative(IRegimeRegistry.Regime a, IRegimeRegistry.Regime b)
        internal
        pure
        returns (IRegimeRegistry.Regime)
    {
        return rank(a) >= rank(b) ? a : b;
    }

    /// Regimes in which the oracle serves the frozen last good price instead of the live feed.
    function isFreezeRegime(IRegimeRegistry.Regime r) internal pure returns (bool) {
        return r == IRegimeRegistry.Regime.HALTED || r == IRegimeRegistry.Regime.CORP_ACTION;
    }
}
