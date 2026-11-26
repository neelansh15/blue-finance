// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IMarketCalendar} from "../src/interfaces/IMarketCalendar.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {UsMarketHolidays} from "../script/UsMarketHolidays.sol";

contract UsMarketHolidaysTest is Test, UsMarketHolidays {
    MarketCalendar private calendar;

    function setUp() external {
        calendar = new MarketCalendar(address(this), address(0), 7 days, false);
        _seedHolidays(calendar);
    }

    function testThanksgivingIsClosedAllDay() external view {
        // Thursday, November 26, 2026, 15:00 ET.
        _assertStatus(1_795_723_200, IMarketCalendar.MarketStatus.WEEKEND);
    }

    function testDayAfterThanksgivingClosesEarly() external view {
        // Friday, November 27, 2026: 12:59, 13:00 and 17:00 ET.
        _assertStatus(1_795_802_340, IMarketCalendar.MarketStatus.OPEN);
        _assertStatus(1_795_802_400, IMarketCalendar.MarketStatus.EXTENDED);
        _assertStatus(1_795_816_800, IMarketCalendar.MarketStatus.WEEKEND);
    }

    function testObservedHolidayInSummerTime() external view {
        // Monday, July 5, 2027, 11:00 ET, observing Independence Day.
        _assertStatus(1_814_799_600, IMarketCalendar.MarketStatus.WEEKEND);
    }

    function testNoHolidayOnNewYearsEve2027() external view {
        // Friday, December 31, 2027, 11:00 ET. NYSE does not observe Saturday, January 1, 2028.
        _assertStatus(1_830_268_800, IMarketCalendar.MarketStatus.OPEN);
    }

    function testLastSeededDates() external view {
        assertTrue(calendar.isEarlyClose(20280703));
        assertTrue(calendar.isEarlyClose(20281124));
        assertTrue(calendar.isHoliday(20281225));
    }

    function _assertStatus(uint256 timestamp, IMarketCalendar.MarketStatus expected) private view {
        assertEq(uint256(calendar.scheduledStatusAt(timestamp)), uint256(expected));
    }
}
