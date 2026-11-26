// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EasternCalendar
/// @notice Pure date helpers for US Eastern time with the post-2007 US DST rule:
///         DST starts the second Sunday of March at 02:00 EST (07:00 UTC) and
///         ends the first Sunday of November at 02:00 EDT (06:00 UTC).
/// @dev Civil date conversion follows Howard Hinnant's days_from_civil / civil_from_days,
///      restricted to dates on or after 1970-01-01 (all values unsigned).
library EasternCalendar {
    uint256 internal constant SECONDS_PER_DAY = 86_400;
    uint256 internal constant HOUR = 3_600;
    uint256 internal constant EST_OFFSET = 5 * HOUR; // UTC-5
    uint256 internal constant EDT_OFFSET = 4 * HOUR; // UTC-4

    /// Days since 1970-01-01 to (year, month 1-12, day 1-31).
    function daysToDate(uint256 day) internal pure returns (uint256 y, uint256 m, uint256 d) {
        uint256 z = day + 719_468;
        uint256 era = z / 146_097;
        uint256 doe = z - era * 146_097; // [0, 146096]
        uint256 yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
        uint256 mp = (5 * doy + 2) / 153; // [0, 11]
        d = doy - (153 * mp + 2) / 5 + 1;
        m = mp < 10 ? mp + 3 : mp - 9;
        y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    }

    /// (year >= 1970, month, day) to days since 1970-01-01.
    function daysFromDate(uint256 y, uint256 m, uint256 d) internal pure returns (uint256) {
        if (m <= 2) y -= 1;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        uint256 doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146_097 + doe - 719_468;
    }

    /// 0 = Sunday ... 6 = Saturday (1970-01-01 was a Thursday).
    function dayOfWeek(uint256 day) internal pure returns (uint256) {
        return (day + 4) % 7;
    }

    /// Days-since-epoch of the first Sunday of (y, m).
    function firstSunday(uint256 y, uint256 m) internal pure returns (uint256) {
        uint256 d1 = daysFromDate(y, m, 1);
        return d1 + (7 - dayOfWeek(d1)) % 7;
    }

    /// True if UTC timestamp t falls inside US daylight saving time.
    function isDst(uint256 t) internal pure returns (bool) {
        (uint256 y,,) = daysToDate(t / SECONDS_PER_DAY);
        uint256 start = (firstSunday(y, 3) + 7) * SECONDS_PER_DAY + 7 * HOUR; // 2nd Sunday March 02:00 EST
        uint256 end = firstSunday(y, 11) * SECONDS_PER_DAY + 6 * HOUR; // 1st Sunday Nov 02:00 EDT
        return t >= start && t < end;
    }

    /// UTC timestamp to "local Eastern seconds since epoch" (wall clock encoded as if it were UTC).
    function toEastern(uint256 t) internal pure returns (uint256) {
        uint256 offset = isDst(t) ? EDT_OFFSET : EST_OFFSET;
        return t > offset ? t - offset : 0;
    }

    /// Encodes a days-since-epoch value as yyyymmdd.
    function toYmd(uint256 day) internal pure returns (uint32) {
        (uint256 y, uint256 m, uint256 d) = daysToDate(day);
        return uint32(y * 10_000 + m * 100 + d);
    }

    /// Basic yyyymmdd sanity check (month 1-12, day 1-31, year 1970-2999).
    function isValidYmd(uint32 ymd) internal pure returns (bool) {
        uint256 y = ymd / 10_000;
        uint256 m = (ymd / 100) % 100;
        uint256 d = ymd % 100;
        if (y < 1970 || y > 2999 || m == 0 || m > 12 || d == 0 || d > 31) return false;
        // Round-trip check rejects e.g. Feb 30.
        return toYmd(daysFromDate(y, m, d)) == ymd;
    }
}
