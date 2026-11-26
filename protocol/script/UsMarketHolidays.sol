// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MarketCalendar} from "../src/MarketCalendar.sol";

/// @notice NYSE full-day holidays and 1:00pm ET early closes from November 26, 2026 through 2028.
/// @dev Source: NYSE Group's "2026, 2027 and 2028 Holiday and Early Closings Calendar" (December 23, 2025):
///      https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/default.aspx
///      The calendar admin must add 2029 onward, and any unscheduled closure, before it happens.
abstract contract UsMarketHolidays {
    /// @dev The caller must be the calendar admin.
    function _seedHolidays(MarketCalendar calendar) internal {
        uint32[21] memory holidays = [
            // 2026
            uint32(20261126),
            20261225,
            // 2027
            20270101,
            20270118,
            20270215,
            20270326,
            20270531,
            20270618,
            20270705,
            20270906,
            20271125,
            20271224,
            // 2028
            20280117,
            20280221,
            20280414,
            20280529,
            20280619,
            20280704,
            20280904,
            20281123,
            20281225
        ];
        uint32[5] memory earlyCloses = [uint32(20261127), 20261224, 20271126, 20280703, 20281124];

        uint32[] memory dates = new uint32[](holidays.length);
        for (uint256 i; i < holidays.length; ++i) {
            dates[i] = holidays[i];
        }
        calendar.setHolidays(dates, true);
        dates = new uint32[](earlyCloses.length);
        for (uint256 i; i < earlyCloses.length; ++i) {
            dates[i] = earlyCloses[i];
        }
        calendar.setEarlyCloses(dates, true);
    }
}
