// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RegimeRegistry} from "../src/RegimeRegistry.sol";
import {IRegimeRegistry} from "../src/interfaces/IRegimeRegistry.sol";
import {EasternCalendar} from "../src/libraries/EasternCalendar.sol";

/// Expected UTC timestamps were generated independently of the contract with Node's Intl
/// (America/New_York tz database), not with EasternCalendar.
abstract contract EtTimes {
    // Regular week, EST (after DST end on Nov 1, 2026)
    uint256 internal constant FRI_NOV20_1559_59 = 1795208399;
    uint256 internal constant FRI_NOV20_1600 = 1795208400;
    uint256 internal constant FRI_NOV20_1959_59 = 1795222799;
    uint256 internal constant FRI_NOV20_2000 = 1795222800;
    uint256 internal constant SAT_NOV21_1200 = 1795280400;
    uint256 internal constant SUN_NOV22_1959_59 = 1795395599;
    uint256 internal constant SUN_NOV22_2000 = 1795395600;
    uint256 internal constant MON_NOV23_0359_59 = 1795424399;
    uint256 internal constant MON_NOV23_0400 = 1795424400;
    uint256 internal constant MON_NOV23_0929_59 = 1795444199;
    uint256 internal constant MON_NOV23_0930 = 1795444200;
    uint256 internal constant TUE_NOV24_2000 = 1795568400;
    // Thanksgiving (Thu holiday) and Black Friday early close
    uint256 internal constant WED_NOV25_1959_59 = 1795654799;
    uint256 internal constant WED_NOV25_2000 = 1795654800;
    uint256 internal constant THU_NOV26_1200 = 1795712400;
    uint256 internal constant THU_NOV26_2000 = 1795741200;
    uint256 internal constant FRI_NOV27_0400 = 1795770000;
    uint256 internal constant FRI_NOV27_1259_59 = 1795802399;
    uint256 internal constant FRI_NOV27_1300 = 1795802400;
    uint256 internal constant FRI_NOV27_1659_59 = 1795816799;
    uint256 internal constant FRI_NOV27_1700 = 1795816800;
    // Labor Day (Mon holiday), EDT
    uint256 internal constant SUN_SEP06_2000 = 1788739200;
    uint256 internal constant MON_SEP07_1000 = 1788789600;
    uint256 internal constant MON_SEP07_2000 = 1788825600;
    uint256 internal constant TUE_SEP08_0400 = 1788854400;
    // Good Friday (Fri holiday), EDT
    uint256 internal constant THU_APR02_2000 = 1775174400;
    uint256 internal constant FRI_APR03_1000 = 1775224800;
    uint256 internal constant SUN_APR05_2000 = 1775433600;
    // DST start weekend (Sun Mar 8, 2026)
    uint256 internal constant FRI_MAR06_1559_59 = 1772830799;
    uint256 internal constant FRI_MAR06_1600 = 1772830800;
    uint256 internal constant SUN_MAR08_1959_59 = 1773014399;
    uint256 internal constant SUN_MAR08_2000 = 1773014400;
    uint256 internal constant MON_MAR09_0929_59 = 1773062999;
    uint256 internal constant MON_MAR09_0930 = 1773063000;
    // DST end weekend (Sun Nov 1, 2026)
    uint256 internal constant FRI_OCT30_1559_59 = 1793390399;
    uint256 internal constant FRI_OCT30_1600 = 1793390400;
    uint256 internal constant SUN_NOV01_1959_59 = 1793581199;
    uint256 internal constant SUN_NOV01_2000 = 1793581200;
    uint256 internal constant MON_NOV02_0929_59 = 1793629799;
    uint256 internal constant MON_NOV02_0930 = 1793629800;
    uint256 internal constant MON_NOV02_1600 = 1793653200;
    // Year boundary: New Year's Day 2027 is a Friday holiday
    uint256 internal constant THU_DEC31_1959_59 = 1798765199;
    uint256 internal constant THU_DEC31_2000 = 1798765200;
    uint256 internal constant MON_JAN04_0930 = 1799073000;
    // DST switch instants (UTC)
    uint256 internal constant DST_START_2026 = 1772953200;
    uint256 internal constant DST_END_2026 = 1793512800;
    uint256 internal constant DST_START_2027 = 1805007600;
    uint256 internal constant DST_END_2027 = 1825567200;
}

contract RegimeRegistryTest is Test, EtTimes {
    RegimeRegistry reg;
    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");
    address stranger = makeAddr("stranger");
    address asset = makeAddr("asset");
    address asset2 = makeAddr("asset2");

    IRegimeRegistry.Regime constant OPEN = IRegimeRegistry.Regime.OPEN;
    IRegimeRegistry.Regime constant EXTENDED = IRegimeRegistry.Regime.EXTENDED;
    IRegimeRegistry.Regime constant CLOSED = IRegimeRegistry.Regime.CLOSED;
    IRegimeRegistry.Regime constant WEEKEND = IRegimeRegistry.Regime.WEEKEND;
    IRegimeRegistry.Regime constant HALTED = IRegimeRegistry.Regime.HALTED;
    IRegimeRegistry.Regime constant CORP = IRegimeRegistry.Regime.CORP_ACTION;

    function setUp() public {
        reg = new RegimeRegistry(admin, keeper, 2 days, false);
        uint32[] memory hol = new uint32[](4);
        hol[0] = 20261126; // Thanksgiving
        hol[1] = 20260907; // Labor Day
        hol[2] = 20260403; // Good Friday
        hol[3] = 20270101; // New Year's Day
        vm.startPrank(admin);
        reg.setHolidays(hol, true);
        reg.setEarlyClose(20261127, true);
        vm.stopPrank();
    }

    function _at(uint256 t) internal view returns (IRegimeRegistry.Regime) {
        return reg.calendarRegimeAt(t);
    }

    function _eq(IRegimeRegistry.Regime a, IRegimeRegistry.Regime b, string memory why) internal pure {
        assertEq(uint8(a), uint8(b), why);
    }

    // ------------------------------------------------------------ calendar: normal week

    function test_FridayClose() public view {
        _eq(_at(FRI_NOV20_1559_59), OPEN, "Fri 15:59:59 OPEN");
        _eq(_at(FRI_NOV20_1600), EXTENDED, "Fri 16:00 post");
        _eq(_at(FRI_NOV20_1959_59), EXTENDED, "Fri 19:59:59 post");
        _eq(_at(FRI_NOV20_2000), WEEKEND, "Fri 20:00 WEEKEND");
        _eq(_at(SAT_NOV21_1200), WEEKEND, "Sat");
        _eq(_at(SUN_NOV22_1959_59), WEEKEND, "Sun 19:59:59");
        _eq(_at(SUN_NOV22_2000), CLOSED, "Sun 20:00 overnight");
    }

    function test_MondayPreMarket() public view {
        _eq(_at(MON_NOV23_0359_59), CLOSED, "Mon 03:59:59");
        _eq(_at(MON_NOV23_0400), EXTENDED, "Mon 04:00 pre");
        _eq(_at(MON_NOV23_0929_59), EXTENDED, "Mon 09:29:59 pre");
        _eq(_at(MON_NOV23_0930), OPEN, "Mon 09:30 OPEN");
    }

    function test_WeekdayOvernight() public view {
        _eq(_at(TUE_NOV24_2000), CLOSED, "Tue 20:00 CLOSED");
        _eq(_at(TUE_NOV24_2000 + 7 hours + 59 minutes), CLOSED, "Wed 03:59");
    }

    // ------------------------------------------------------------ calendar: holidays

    function test_ThursdayHolidayAndEarlyClose() public view {
        _eq(_at(WED_NOV25_1959_59), EXTENDED, "Wed post before holiday");
        _eq(_at(WED_NOV25_2000), WEEKEND, "Wed 20:00 before holiday = WEEKEND");
        _eq(_at(THU_NOV26_1200), WEEKEND, "Thanksgiving noon");
        _eq(_at(THU_NOV26_2000), CLOSED, "Thanksgiving 20:00 -> overnight before Fri");
        _eq(_at(FRI_NOV27_0400), EXTENDED, "Fri pre");
        _eq(_at(FRI_NOV27_1259_59), OPEN, "early close day 12:59:59");
        _eq(_at(FRI_NOV27_1300), EXTENDED, "early close 13:00");
        _eq(_at(FRI_NOV27_1659_59), EXTENDED, "early close post 16:59:59");
        _eq(_at(FRI_NOV27_1700), WEEKEND, "early close Fri 17:00 WEEKEND");
    }

    function test_MondayHoliday() public view {
        _eq(_at(SUN_SEP06_2000), WEEKEND, "Sun 20:00 before Labor Day");
        _eq(_at(MON_SEP07_1000), WEEKEND, "Labor Day");
        _eq(_at(MON_SEP07_2000), CLOSED, "Labor Day 20:00");
        _eq(_at(TUE_SEP08_0400), EXTENDED, "Tue pre");
    }

    function test_FridayHoliday() public view {
        _eq(_at(THU_APR02_2000), WEEKEND, "Thu 20:00 before Good Friday");
        _eq(_at(FRI_APR03_1000), WEEKEND, "Good Friday");
        _eq(_at(SUN_APR05_2000), CLOSED, "Sun 20:00 after Good Friday");
    }

    function test_YearBoundaryHoliday() public view {
        // Thu Dec 31 2026 20:00 ET is already Jan 1 2027 in UTC.
        _eq(_at(THU_DEC31_1959_59), EXTENDED, "Dec 31 post");
        _eq(_at(THU_DEC31_2000), WEEKEND, "Dec 31 20:00 before Fri holiday");
        _eq(_at(MON_JAN04_0930), OPEN, "Mon Jan 4 open");
    }

    function test_HolidayToggleOff() public {
        vm.prank(admin);
        reg.setHoliday(20261126, false);
        _eq(_at(THU_NOV26_1200), OPEN, "no longer a holiday");
        _eq(_at(WED_NOV25_2000), CLOSED, "Wed overnight normal");
    }

    // ------------------------------------------------------------ calendar: DST

    function test_DstInstants() public pure {
        assertFalse(EasternCalendar.isDst(DST_START_2026 - 1));
        assertTrue(EasternCalendar.isDst(DST_START_2026));
        assertTrue(EasternCalendar.isDst(DST_END_2026 - 1));
        assertFalse(EasternCalendar.isDst(DST_END_2026));
        assertFalse(EasternCalendar.isDst(DST_START_2027 - 1));
        assertTrue(EasternCalendar.isDst(DST_START_2027));
        assertTrue(EasternCalendar.isDst(DST_END_2027 - 1));
        assertFalse(EasternCalendar.isDst(DST_END_2027));
    }

    function test_DstStartWeekend() public view {
        _eq(_at(FRI_MAR06_1559_59), OPEN, "Fri EST open");
        _eq(_at(FRI_MAR06_1600), EXTENDED, "Fri EST close");
        _eq(_at(DST_START_2026 - 1), WEEKEND, "switch -1s");
        _eq(_at(DST_START_2026), WEEKEND, "switch");
        _eq(_at(SUN_MAR08_1959_59), WEEKEND, "Sun 19:59:59 EDT");
        _eq(_at(SUN_MAR08_2000), CLOSED, "Sun 20:00 EDT");
        _eq(_at(MON_MAR09_0929_59), EXTENDED, "Mon 09:29:59 EDT");
        _eq(_at(MON_MAR09_0930), OPEN, "Mon 09:30 EDT = 13:30 UTC");
        // The EST 09:30 instant (14:30 UTC) would be 10:30 EDT: still OPEN; the EST pre-open instant is not.
        _eq(_at(MON_MAR09_0930 - 1 hours), EXTENDED, "08:30 EDT pre");
    }

    function test_DstEndWeekend() public view {
        _eq(_at(FRI_OCT30_1559_59), OPEN, "Fri EDT open");
        _eq(_at(FRI_OCT30_1600), EXTENDED, "Fri EDT close (20:00 UTC)");
        _eq(_at(DST_END_2026 - 1), WEEKEND, "switch -1s");
        _eq(_at(DST_END_2026), WEEKEND, "switch");
        _eq(_at(SUN_NOV01_1959_59), WEEKEND, "Sun 19:59:59 EST");
        _eq(_at(SUN_NOV01_2000), CLOSED, "Sun 20:00 EST");
        _eq(_at(MON_NOV02_0929_59), EXTENDED, "Mon 09:29:59 EST");
        _eq(_at(MON_NOV02_0930), OPEN, "Mon 09:30 EST = 14:30 UTC");
        _eq(_at(MON_NOV02_0930 - 1 hours), EXTENDED, "13:30 UTC is pre-market in EST");
        _eq(_at(MON_NOV02_1600 - 1), OPEN, "15:59:59 EST");
        _eq(_at(MON_NOV02_1600), EXTENDED, "16:00 EST");
    }

    function testFuzz_DateRoundTrip(uint256 day) public pure {
        day = bound(day, 0, 400_000); // through ~3065
        (uint256 y, uint256 m, uint256 d) = EasternCalendar.daysToDate(day);
        assertEq(EasternCalendar.daysFromDate(y, m, d), day);
        assertTrue(m >= 1 && m <= 12 && d >= 1 && d <= 31);
    }

    function testFuzz_CalendarNeverReverts(uint256 t) public view {
        t = bound(t, 0, 4_102_444_800); // up to 2100
        reg.calendarRegimeAt(t);
    }

    // ------------------------------------------------------------ overrides

    function test_OverrideAndExpiry() public {
        vm.warp(MON_NOV23_0930 + 1 hours); // OPEN
        _eq(reg.regime(asset), OPEN, "open");
        vm.prank(keeper);
        reg.setOverride(asset, HALTED, 1 hours);
        _eq(reg.regime(asset), HALTED, "halted");
        _eq(reg.regime(asset2), OPEN, "other asset unaffected");
        (IRegimeRegistry.Regime s, uint64 exp) = reg.overrideOf(asset);
        _eq(s, HALTED, "stored");
        assertEq(exp, block.timestamp + 1 hours);
        vm.warp(exp - 1);
        _eq(reg.regime(asset), HALTED, "just before expiry");
        vm.warp(exp);
        _eq(reg.regime(asset), OPEN, "expired at expiry");
    }

    function test_OverrideCannotRelaxCalendar() public {
        vm.warp(SAT_NOV21_1200); // WEEKEND
        vm.prank(keeper);
        reg.setOverride(asset, EXTENDED, 1 hours);
        _eq(reg.regime(asset), WEEKEND, "max(calendar, override)");
    }

    function test_GlobalOverride() public {
        vm.warp(MON_NOV23_0930 + 1 hours);
        vm.prank(keeper);
        reg.setOverride(address(0), HALTED, 1 hours);
        _eq(reg.regime(asset), HALTED, "global applies");
        _eq(reg.regime(asset2), HALTED, "global applies 2");
    }

    function test_KeeperOnlyMoreConservative() public {
        vm.warp(MON_NOV23_0930 + 1 hours);
        vm.startPrank(keeper);
        reg.setOverride(asset, HALTED, 2 hours);
        // Less conservative state while HALTED is active: rejected.
        vm.expectRevert(RegimeRegistry.NotMoreConservative.selector);
        reg.setOverride(asset, CORP, 2 hours);
        // Same state but shorter: rejected.
        vm.expectRevert(RegimeRegistry.NotMoreConservative.selector);
        reg.setOverride(asset, HALTED, 1 hours);
        // Same state, longer: allowed (extension).
        reg.setOverride(asset, HALTED, 3 hours);
        vm.stopPrank();

        // CORP_ACTION then escalate to HALTED: allowed.
        vm.prank(keeper);
        reg.setOverride(asset2, CORP, 1 hours);
        vm.prank(keeper);
        reg.setOverride(asset2, HALTED, 1 hours);
        _eq(reg.regime(asset2), HALTED, "escalated");

        // After expiry any non-OPEN state may be set again.
        vm.warp(block.timestamp + 4 hours);
        vm.prank(keeper);
        reg.setOverride(asset, CLOSED, 1 hours);
        _eq(reg.regime(asset), CLOSED, "new override after expiry");
    }

    function test_OverrideLimits() public {
        vm.startPrank(keeper);
        vm.expectRevert(RegimeRegistry.InvalidRegime.selector);
        reg.setOverride(asset, OPEN, 1 hours);
        vm.expectRevert(RegimeRegistry.InvalidDuration.selector);
        reg.setOverride(asset, HALTED, 0);
        vm.expectRevert(RegimeRegistry.InvalidDuration.selector);
        reg.setOverride(asset, HALTED, 2 days + 1);
        reg.setOverride(asset, HALTED, 2 days); // exactly MAX_OVERRIDE ok
        vm.stopPrank();
    }

    function test_RoleLimits() public {
        vm.prank(stranger);
        vm.expectRevert(RegimeRegistry.Unauthorized.selector);
        reg.setOverride(asset, HALTED, 1 hours);

        vm.prank(keeper);
        vm.expectRevert(RegimeRegistry.Unauthorized.selector);
        reg.setHoliday(20261225, true);

        vm.prank(keeper);
        vm.expectRevert(RegimeRegistry.Unauthorized.selector);
        reg.setEarlyClose(20261224, true);

        vm.prank(keeper);
        vm.expectRevert(RegimeRegistry.Unauthorized.selector);
        reg.setKeeper(stranger, true);

        // Admin may also set overrides under the same rules.
        vm.prank(admin);
        reg.setOverride(asset, CORP, 1 hours);
    }

    function test_ClearOverrideRoles() public {
        vm.warp(MON_NOV23_0930 + 1 hours);
        vm.prank(keeper);
        reg.setOverride(asset, HALTED, 1 hours);

        // keeperCanClear = false: keeper cannot clear.
        vm.prank(keeper);
        vm.expectRevert(RegimeRegistry.Unauthorized.selector);
        reg.clearOverride(asset);
        vm.prank(stranger);
        vm.expectRevert(RegimeRegistry.Unauthorized.selector);
        reg.clearOverride(asset);

        vm.prank(admin);
        reg.clearOverride(asset);
        _eq(reg.regime(asset), OPEN, "admin cleared");

        vm.prank(admin);
        reg.setKeeperCanClear(true);
        vm.prank(keeper);
        reg.setOverride(asset, HALTED, 1 hours);
        vm.prank(keeper);
        reg.clearOverride(asset);
        _eq(reg.regime(asset), OPEN, "keeper cleared");
    }

    function test_KeeperRevoked() public {
        vm.prank(admin);
        reg.setKeeper(keeper, false);
        vm.prank(keeper);
        vm.expectRevert(RegimeRegistry.Unauthorized.selector);
        reg.setOverride(asset, HALTED, 1 hours);
    }

    function test_InvalidDates() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(RegimeRegistry.InvalidDate.selector, uint32(20260230)));
        reg.setHoliday(20260230, true);
        vm.expectRevert(abi.encodeWithSelector(RegimeRegistry.InvalidDate.selector, uint32(20261301)));
        reg.setHoliday(20261301, true);
        vm.expectRevert(abi.encodeWithSelector(RegimeRegistry.InvalidDate.selector, uint32(20260000)));
        reg.setEarlyClose(20260000, true);
        reg.setHoliday(20280229, true); // leap day valid
        vm.stopPrank();
    }

    function test_AdminTransferTwoStep() public {
        vm.prank(admin);
        reg.transferAdmin(stranger);
        assertEq(reg.admin(), admin);
        vm.prank(keeper);
        vm.expectRevert(RegimeRegistry.Unauthorized.selector);
        reg.acceptAdmin();
        vm.prank(stranger);
        reg.acceptAdmin();
        assertEq(reg.admin(), stranger);
    }

    function test_ConstructorBounds() public {
        vm.expectRevert(RegimeRegistry.InvalidDuration.selector);
        new RegimeRegistry(admin, keeper, 31 days, false);
        vm.expectRevert(RegimeRegistry.ZeroAddress.selector);
        new RegimeRegistry(address(0), keeper, 1 days, false);
    }
}
