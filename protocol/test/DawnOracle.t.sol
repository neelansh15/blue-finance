// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DawnOracle} from "../src/DawnOracle.sol";
import {RegimeRegistry} from "../src/RegimeRegistry.sol";
import {IRegimeRegistry} from "../src/interfaces/IRegimeRegistry.sol";
import {MockAtlasFeed} from "../src/mocks/MockAtlasFeed.sol";
import {MockBStock} from "../src/mocks/MockBStock.sol";

/// Registry stand-in: returns any raw value (including out-of-range enums), can revert or return short data.
contract RegimeStub {
    uint256 public value;
    uint8 public mode; // 0 normal, 1 revert, 2 empty return data
    address public admin;

    constructor(address admin_) {
        admin = admin_;
    }

    function set(uint256 v) external {
        value = v;
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function regime(address) external view returns (uint256) {
        if (mode == 1) revert("registry down");
        if (mode == 2) {
            assembly {
                return(0, 0)
            }
        }
        return value;
    }
}

/// Collateral stand-in with an arbitrary (possibly out-of-bounds) multiplier and a revert switch.
contract AssetStub {
    uint256 public m = 1e18;
    bool public reverting;

    function set(uint256 v) external {
        m = v;
    }

    function setReverting(bool r) external {
        reverting = r;
    }

    function uiMultiplier() external view returns (uint256) {
        if (reverting) revert("paused");
        return m;
    }
}

/// Feed that returns nothing (short return data) from every read.
contract ShortFeed {
    fallback() external {
        assembly {
            return(0, 0)
        }
    }
}

contract DawnOracleTest is Test {
    uint8 constant OPEN = 0;
    uint8 constant EXTENDED = 1;
    uint8 constant CLOSED = 2;
    uint8 constant WEEKEND = 3;
    uint8 constant HALTED = 4;
    uint8 constant CORP = 5;

    uint256 constant P100 = 100e36; // $100 per token, 18/18 decimals, Morpho scale
    uint256 constant T0 = 1_795_444_200 + 1 hours; // Mon Nov 23 2026 10:30 ET

    address admin = makeAddr("admin");
    MockAtlasFeed feed;
    MockBStock stock;
    AssetStub assetStub;
    RegimeStub regStub;
    DawnOracle oracle;

    function setUp() public {
        vm.warp(T0);
        feed = new MockAtlasFeed(8, 100e8);
        stock = new MockBStock("Dawn bAAPL", "bAAPL");
        assetStub = new AssetStub();
        regStub = new RegimeStub(admin);
        oracle = new DawnOracle(_cfg(address(feed), address(regStub), address(stock), 18, true));
    }

    function _cfg(address f, address r, address a, uint8 loanDec, bool perUI)
        internal
        pure
        returns (DawnOracle.Config memory c)
    {
        c.atlasFeed = f;
        c.registry = r;
        c.asset = a;
        c.loanDecimals = loanDec;
        c.collateralDecimals = 18;
        c.feedDecimals = 8;
        c.feedPerUIShare = perUI;
        c.haircutsBps = [uint16(0), 300, 500, 1000, 1500, 1200];
        c.stalenessSec = [uint32(1 hours), 1 hours, 4 hours, 6 hours, 1 hours, 1 hours];
        c.maxFreeze = 12 hours;
        c.continuityBandBps = 500;
        c.expiredFreezeHaircutBps = 1000;
    }

    function _r(uint8 v) internal pure returns (IRegimeRegistry.Regime) {
        return IRegimeRegistry.Regime(v);
    }

    function _hc(uint256 p, uint256 bps) internal pure returns (uint256) {
        return (p * (10_000 - bps)) / 10_000;
    }

    // ------------------------------------------------------------ basics

    function test_SeededAtConstruction() public view {
        assertEq(oracle.lastGoodPrice(), P100);
        assertEq(oracle.lastGoodAt(), T0);
        assertEq(oracle.lastMultiplier(), 1e18);
        assertEq(oracle.price(), P100);
    }

    function test_HaircutPerRegime() public {
        uint16[6] memory h = [uint16(0), 300, 500, 1000, 1500, 1200];
        for (uint8 i; i < 4; ++i) {
            regStub.set(i);
            assertEq(oracle.price(), _hc(P100, h[i]), "live regime haircut");
            assertEq(oracle.priceForRegime(_r(i)), _hc(P100, h[i]));
            assertEq(oracle.haircutBps(_r(i)), h[i]);
        }
        regStub.set(HALTED);
        assertEq(oracle.price(), 85e36);
        regStub.set(CORP);
        assertEq(oracle.price(), 88e36);
        assertEq(oracle.priceForRegime(_r(WEEKEND)), 90e36);
        assertEq(oracle.priceForRegime(_r(EXTENDED)), 97e36);
        assertEq(oracle.priceForRegime(_r(CLOSED)), 95e36);
    }

    function test_DecimalsScaling() public {
        DawnOracle o6 = new DawnOracle(_cfg(address(feed), address(regStub), address(stock), 6, true));
        assertEq(o6.price(), 100e24, "USDC-style 6-dec loan token");
        assertEq(o6.SCALE_DIV(), 100);
        assertEq(oracle.SCALE_MUL(), 1e10);
    }

    function test_RoundingDown() public {
        feed.setAnswer(33_333_333_33); // $33.3333333
        regStub.set(EXTENDED);
        uint256 raw = uint256(33_333_333_33) * 1e18 * 1e10;
        uint256 p = oracle.price();
        assertEq(p, (raw * 9700) / 10_000);
        assertLe(p * 10_000, raw * 9700);
    }

    // ------------------------------------------------------------ real registry integration

    function test_WithRealRegistry() public {
        RegimeRegistry reg = new RegimeRegistry(admin, address(this), 1 days, false);
        DawnOracle o = new DawnOracle(_cfg(address(feed), address(reg), address(stock), 18, true));
        assertEq(o.price(), P100, "Mon 10:30 ET OPEN");

        vm.warp(1_795_280_400 + 1 weeks); // Sat Nov 28 12:00 ET
        feed.setAnswer(100e8);
        assertEq(o.price(), 90e36, "WEEKEND 10%");

        vm.warp(T0 + 1 weeks);
        feed.setAnswer(100e8);
        o.update();
        reg.setOverride(address(stock), IRegimeRegistry.Regime.HALTED, 1 hours);
        feed.setAnswer(40e8); // feed moves during halt: ignored
        assertEq(o.price(), 85e36, "HALTED serves frozen last good");
        o.update();
        assertTrue(o.isFrozen());
        vm.warp(block.timestamp + 1 hours); // override expires
        feed.setAnswer(102e8);
        o.update();
        assertFalse(o.isFrozen());
        assertEq(o.price(), 102e36);
    }

    // ------------------------------------------------------------ 2-for-1 split continuity

    /// Multiplier moves first, feed (per UI share) catches up later.
    function test_Split_MultiplierFirst() public {
        stock.setUIMultiplierNow(2e18);
        // Feed still quotes the old per-share $100 => naive raw price would be $200.
        assertTrue(oracle.isFrozen());
        assertEq(oracle.price(), 88e36, "multiplier change => frozen with CORP haircut");
        oracle.update();
        assertEq(oracle.frozenSince(), T0);
        assertEq(uint8(oracle.frozenRegime()), CORP);
        assertEq(oracle.lastGoodPrice(), P100, "$200 jump rejected by continuity band");

        vm.warp(T0 + 5 minutes);
        feed.setAnswer(50e8);
        assertEq(oracle.price(), 88e36, "still frozen until update()");
        oracle.update();
        assertFalse(oracle.isFrozen());
        assertEq(oracle.lastMultiplier(), 2e18);
        assertEq(oracle.price(), P100, "per raw token value unchanged across split");
    }

    /// Keeper flags CORP_ACTION first; feed moves to post-split price before the multiplier.
    function test_Split_FeedFirstWithKeeperFlag() public {
        regStub.set(CORP);
        oracle.update();
        feed.setAnswer(50e8);
        assertEq(oracle.price(), 88e36, "post-split feed ignored during CORP_ACTION");
        stock.setUIMultiplierNow(2e18);
        oracle.update();
        assertEq(oracle.price(), 88e36);

        regStub.set(OPEN);
        assertEq(oracle.price(), 88e36, "frozenRegime keeps the CORP haircut until unfreeze");
        oracle.update();
        assertEq(oracle.price(), P100);
        assertEq(oracle.frozenSince(), 0);
    }

    /// Feed quoting per raw token: split does not move the raw price; freeze and unfreeze in one update().
    function test_Split_PerRawFeedUnfreezesInOneCall() public {
        DawnOracle o = new DawnOracle(_cfg(address(feed), address(regStub), address(stock), 18, false));
        stock.setUIMultiplierNow(2e18);
        assertEq(o.price(), 88e36);
        vm.expectEmit(address(o));
        emit DawnOracle.Frozen(uint64(T0));
        vm.expectEmit(address(o));
        emit DawnOracle.Unfrozen(P100);
        o.update();
        assertEq(o.price(), P100);
        assertEq(o.lastMultiplier(), 2e18);
    }

    /// Known limitation (documented): without a keeper flag, a per-UI feed that moves before the multiplier
    /// is taken at face value for that window.
    function test_Split_FeedFirstWithoutFlag_IsLiveGap() public {
        feed.setAnswer(50e8);
        assertEq(oracle.price(), 50e36);
    }

    function test_ContinuityFailureStaysFrozen() public {
        regStub.set(HALTED);
        oracle.update();
        regStub.set(OPEN);
        feed.setAnswer(106e8); // +6% > 5% band
        oracle.update();
        assertTrue(oracle.isFrozen());
        assertEq(oracle.price(), 85e36, "HALTED haircut retained while frozen");
        feed.setAnswer(105e8); // exactly +5%: inside band (inclusive)
        oracle.update();
        assertFalse(oracle.isFrozen());
        assertEq(oracle.price(), 105e36);
    }

    function test_FrozenRegimeEscalates() public {
        regStub.set(CORP);
        oracle.update();
        regStub.set(HALTED);
        oracle.update();
        assertEq(uint8(oracle.frozenRegime()), HALTED);
        regStub.set(CORP);
        oracle.update();
        assertEq(uint8(oracle.frozenRegime()), HALTED, "never de-escalates while frozen");
    }

    // ------------------------------------------------------------ staleness and freeze expiry

    function test_StalenessFallback() public {
        vm.warp(T0 + 10 minutes);
        feed.setAnswer(110e8); // not recorded (no update)
        vm.warp(T0 + 10 minutes + 1 hours + 1);
        assertEq(oracle.priceForRegime(_r(OPEN)), P100, "OPEN: stale => last good");
        assertEq(oracle.priceForRegime(_r(EXTENDED)), 97e36, "EXTENDED: stale => last good");
        assertEq(oracle.priceForRegime(_r(CLOSED)), _hc(110e36, 500), "CLOSED 4h: still live");
        assertEq(oracle.priceForRegime(_r(WEEKEND)), 99e36, "WEEKEND 6h: still live");
        assertEq(oracle.stalenessSec(_r(WEEKEND)), 6 hours);

        vm.warp(T0 + 10 minutes + 6 hours);
        assertEq(oracle.priceForRegime(_r(WEEKEND)), 99e36, "exactly at limit: live");
        vm.warp(T0 + 10 minutes + 6 hours + 1);
        assertEq(oracle.priceForRegime(_r(WEEKEND)), 90e36, "past limit: last good");
    }

    function test_StaleUpdateDoesNotRecord() public {
        vm.warp(T0 + 2 hours);
        oracle.update();
        assertEq(oracle.lastGoodAt(), T0);
    }

    function test_OutOfOrderObservationIgnored() public {
        vm.warp(T0 + 30 minutes);
        feed.setAnswer(101e8);
        oracle.update();
        feed.setAnswerAt(99e8, T0 + 10 minutes); // older observation
        oracle.update();
        assertEq(oracle.lastGoodPrice(), 101e36);
    }

    function test_FreezeExpiryExtraHaircut() public {
        regStub.set(HALTED);
        oracle.update();
        vm.warp(T0 + 12 hours);
        assertEq(oracle.price(), 85e36, "at maxFreeze: no extra");
        vm.warp(T0 + 12 hours + 1);
        assertEq(oracle.price(), _hc(85e36, 1000), "past maxFreeze: extra 10%");
    }

    function test_StaleFallbackExpiry() public {
        feed.setReverting(true);
        vm.warp(T0 + 13 hours);
        assertEq(oracle.price(), 90e36, "OPEN, feed down 13h: lastGood minus expired haircut");
    }

    function test_ForceUnfreeze() public {
        regStub.set(HALTED);
        oracle.update();
        regStub.set(OPEN);
        feed.setAnswer(150e8); // genuine gap
        oracle.update();
        assertTrue(oracle.isFrozen());

        vm.prank(admin);
        vm.expectRevert(DawnOracle.FreezeNotExpired.selector);
        oracle.forceUnfreeze();

        vm.warp(T0 + 12 hours + 1);
        feed.setAnswer(150e8);
        vm.expectRevert(DawnOracle.Unauthorized.selector);
        oracle.forceUnfreeze();

        regStub.set(HALTED);
        vm.prank(admin);
        vm.expectRevert(DawnOracle.StillFreezeRegime.selector);
        oracle.forceUnfreeze();

        regStub.set(OPEN);
        feed.setReverting(true);
        vm.prank(admin);
        vm.expectRevert(DawnOracle.LivePriceUnavailable.selector);
        oracle.forceUnfreeze();

        feed.setReverting(false);
        vm.prank(admin);
        oracle.forceUnfreeze();
        assertFalse(oracle.isFrozen());
        assertEq(oracle.price(), 150e36);
    }

    function test_ForceUnfreezeRequiresFreeze() public {
        vm.warp(T0 + 1 days);
        vm.prank(admin);
        vm.expectRevert(DawnOracle.FreezeNotExpired.selector);
        oracle.forceUnfreeze();
    }

    // ------------------------------------------------------------ failure modes: never revert

    function test_FeedRevertsNoRevert() public {
        feed.setReverting(true);
        assertEq(oracle.price(), P100, "fallback to last good");
        assertEq(oracle.update(), P100);
        (bool ok,,) = oracle.liveRawPrice();
        assertFalse(ok);
    }

    function test_FeedGarbage() public {
        feed.setAnswer(-1);
        assertEq(oracle.price(), P100, "negative");
        feed.setAnswer(0);
        assertEq(oracle.price(), P100, "zero");
        feed.setAnswer(type(int256).max);
        assertEq(oracle.price(), P100, "huge");
        feed.setAnswer(1e40 + 1);
        assertEq(oracle.price(), P100, "above MAX_ANSWER");
        feed.setAnswerAt(120e8, 0);
        assertEq(oracle.price(), P100, "zero timestamp");
        feed.setAnswerAt(120e8, T0 + 1 days);
        assertEq(oracle.price(), 120e36, "future timestamp clamped to now");
        oracle.update();
        assertEq(oracle.lastGoodAt(), T0, "recorded at block time, not the future");
    }

    function test_ShortReturnFeed() public {
        ShortFeed sf = new ShortFeed();
        DawnOracle o = new DawnOracle(_cfg(address(sf), address(regStub), address(stock), 18, true));
        vm.expectRevert(DawnOracle.NoPrice.selector);
        o.price();
        o.update(); // no revert
        assertEq(o.lastGoodPrice(), 0);
    }

    function test_NoPriceBeforeFirstObservation() public {
        feed.setReverting(true);
        DawnOracle o = new DawnOracle(_cfg(address(feed), address(regStub), address(stock), 18, true));
        assertEq(o.lastGoodPrice(), 0);
        vm.expectRevert(DawnOracle.NoPrice.selector);
        o.price();
        feed.setReverting(false);
        assertEq(o.price(), P100, "live path needs no history");
    }

    function test_RegistryFailureIsHalted() public {
        regStub.setMode(1);
        assertEq(oracle.price(), 85e36, "reverting registry => HALTED");
        regStub.setMode(2);
        assertEq(oracle.price(), 85e36, "empty return => HALTED");
        regStub.setMode(0);
        regStub.set(6);
        assertEq(oracle.price(), 85e36, "out of range enum => HALTED");
        regStub.set(type(uint256).max);
        assertEq(oracle.price(), 85e36);
    }

    function test_MultiplierFailureFreezes() public {
        DawnOracle o = new DawnOracle(_cfg(address(feed), address(regStub), address(assetStub), 18, true));
        assetStub.setReverting(true);
        assertEq(o.price(), 88e36, "unreadable multiplier => CORP haircut on last good");
        o.update();
        assertTrue(o.isFrozen());
        assetStub.setReverting(false);
        assetStub.set(0);
        assertEq(o.price(), 88e36, "zero multiplier treated as unreadable");
        assetStub.set(1e28);
        assertEq(o.price(), 88e36, "above bound");
        assetStub.set(1e18);
        o.update();
        assertFalse(o.isFrozen());
    }

    // ------------------------------------------------------------ constructor validation

    function test_ConstructorValidation() public {
        DawnOracle.Config memory c = _cfg(address(feed), address(regStub), address(stock), 18, true);

        c.atlasFeed = makeAddr("eoa");
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);

        c = _cfg(address(feed), address(regStub), address(stock), 18, true);
        c.feedDecimals = 18; // feed reports 8
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);

        c = _cfg(address(feed), address(regStub), address(stock), 18, true);
        c.haircutsBps[2] = 200; // CLOSED below EXTENDED
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);

        c = _cfg(address(feed), address(regStub), address(stock), 18, true);
        c.haircutsBps[4] = 1100; // HALTED below CORP_ACTION
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);

        c = _cfg(address(feed), address(regStub), address(stock), 18, true);
        c.haircutsBps[4] = 5001;
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);

        c = _cfg(address(feed), address(regStub), address(stock), 18, true);
        c.stalenessSec[3] = 0;
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);

        c = _cfg(address(feed), address(regStub), address(stock), 18, true);
        c.continuityBandBps = 0;
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);

        c = _cfg(address(feed), address(regStub), address(stock), 18, true);
        c.maxFreeze = 0;
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);

        c = _cfg(address(feed), address(regStub), address(stock), 37, true);
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);
    }

    // ------------------------------------------------------------ fuzz

    /// After an update, price is non-increasing in conservativeness and never zero.
    function testFuzz_MonotoneInRegime(uint256 answer, uint256 mult) public {
        answer = bound(answer, 1, 1e20);
        mult = bound(mult, 1e9, 1e27);
        DawnOracle o = new DawnOracle(_cfg(address(feed), address(regStub), address(assetStub), 18, true));
        assetStub.set(mult);
        feed.setAnswer(int256(answer));
        o.update(); // unfreezes if continuous, else stays frozen; either way the checks below must hold
        uint8[6] memory order = [OPEN, EXTENDED, CLOSED, WEEKEND, CORP, HALTED];
        uint256 prev = type(uint256).max;
        for (uint256 i; i < 6; ++i) {
            uint256 p = o.priceForRegime(_r(order[i]));
            assertGt(p, 0);
            assertLe(p, prev, "more conservative regime never prices higher");
            prev = p;
        }
    }

    /// Once a good price exists, price() never reverts and never returns 0, whatever the inputs do.
    function testFuzz_NeverReverts(int256 answer, uint256 ts, uint256 regimeVal, uint256 mult, uint256 dt, bool rev)
        public
    {
        DawnOracle o = new DawnOracle(_cfg(address(feed), address(regStub), address(assetStub), 18, true));
        dt = bound(dt, 0, 3650 days);
        vm.warp(block.timestamp + dt);
        feed.setAnswerAt(answer, ts);
        feed.setReverting(rev);
        regStub.set(regimeVal);
        assetStub.set(mult);
        o.update();
        uint256 p = o.price();
        assertGt(p, 0);
        assertLe(p, o.MAX_RAW_PRICE());
        for (uint8 i; i < 6; ++i) {
            assertGt(o.priceForRegime(_r(i)), 0);
        }
    }

    // ------------------------------------------------------------ upward jump breaker

    function _jumpOracle() internal returns (DawnOracle o) {
        DawnOracle.Config memory c = _cfg(address(feed), address(regStub), address(stock), 18, true);
        c.jumpBandBps = 3000; // +30%
        o = new DawnOracle(c);
    }

    function test_Jump_DisabledByDefault() public {
        feed.setAnswer(200e8);
        assertEq(oracle.price(), 200e36);
        assertFalse(oracle.isFrozen());
    }

    function test_Jump_WithinBandIsLive() public {
        DawnOracle o = _jumpOracle();
        feed.setAnswer(129e8);
        assertFalse(o.isFrozen());
        assertEq(o.price(), 129e36);
        o.update();
        assertEq(o.lastGoodPrice(), 129e36);
    }

    function test_Jump_UpwardHeldThenContinuousUnfreeze() public {
        DawnOracle o = _jumpOracle();
        feed.setAnswer(140e8); // +40%, e.g. feed-first reverse split or a bad print
        assertTrue(o.isFrozen(), "pending jump reported");
        assertEq(o.price(), P100, "pending jump never served");

        vm.expectEmit(address(o));
        emit DawnOracle.JumpRejected(140e36, P100);
        o.update();
        assertTrue(o.jumpFrozen());
        assertTrue(o.isFrozen());
        assertEq(o.lastGoodPrice(), P100, "jump not recorded");
        assertEq(o.price(), P100);

        regStub.set(WEEKEND); // routine regime change while jump-frozen: haircut still applies
        feed.setAnswer(140e8);
        assertEq(o.price(), 90e36);
        regStub.set(OPEN);

        feed.setAnswer(90e8); // live below last good while jump-frozen: lower price served at once
        assertEq(o.price(), 90e36);
        feed.setAnswer(103e8); // back within the 5% continuity band
        o.update();
        assertFalse(o.jumpFrozen());
        assertFalse(o.isFrozen());
        assertEq(o.price(), 103e36);
    }

    function test_Jump_FallBelowReferenceUnfreezes() public {
        DawnOracle o = _jumpOracle();
        feed.setAnswer(140e8);
        o.update();
        feed.setAnswer(60e8); // downward moves are accepted even from a jump freeze
        o.update();
        assertFalse(o.isFrozen());
        assertEq(o.lastGoodPrice(), 60e36);
        assertEq(o.price(), 60e36);
    }

    function test_Jump_DownwardNeverFrozen() public {
        DawnOracle o = _jumpOracle();
        feed.setAnswer(40e8); // -60% gap: must stay live so liquidations work
        assertFalse(o.isFrozen());
        assertEq(o.price(), 40e36);
        o.update();
        assertFalse(o.isFrozen());
        assertEq(o.lastGoodPrice(), 40e36);
    }

    function test_Jump_ForceUnfreezeAfterMaxFreeze() public {
        DawnOracle o = _jumpOracle();
        feed.setAnswer(140e8);
        o.update();
        vm.prank(admin);
        vm.expectRevert(DawnOracle.FreezeNotExpired.selector);
        o.forceUnfreeze();
        vm.warp(T0 + 12 hours + 1);
        feed.setAnswer(140e8);
        assertEq(o.price(), 90e36, "expired-freeze haircut while held");
        vm.prank(admin);
        o.forceUnfreeze();
        assertFalse(o.jumpFrozen());
        assertEq(o.price(), 140e36);
    }

    function test_Jump_SupersededByRegistryFreeze() public {
        DawnOracle o = _jumpOracle();
        feed.setAnswer(140e8);
        o.update();
        regStub.set(HALTED);
        o.update();
        assertFalse(o.jumpFrozen(), "now a HALTED freeze");
        assertEq(o.frozenRegime() == _r(HALTED), true);
        regStub.set(OPEN);
        feed.setAnswer(60e8); // below reference, but this is no longer a jump freeze: continuity rules
        o.update();
        assertTrue(o.isFrozen());
        assertEq(o.price(), 85e36, "HALTED haircut on frozen last good");
    }

    function test_Jump_ConstructorValidation() public {
        DawnOracle.Config memory c = _cfg(address(feed), address(regStub), address(stock), 18, true);
        c.jumpBandBps = 500; // must exceed the continuity band
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);
        c.jumpBandBps = 1_000_001;
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);
        c.jumpBandBps = 501;
        new DawnOracle(c);
    }

    /// Fuzz: with the breaker on, price() never exceeds the last good price by more than the band.
    function testFuzz_Jump_NeverServesAboveBand(uint256 answer, bool doUpdate) public {
        DawnOracle o = _jumpOracle();
        answer = bound(answer, 1, 1e12);
        feed.setAnswer(int256(answer));
        if (doUpdate) o.update();
        assertLe(o.price() * 10_000, P100 * 13_000);
    }

    // ------------------------------------------------------------ calendar haircut floor

    /// Frontend placeholders: CORP_ACTION (10%) below WEEKEND (15%). A keeper CORP_ACTION flag on a weekend
    /// must not lower the haircut: the calendar regime acts as a floor.
    function test_CalendarFloor_CorpActionBelowWeekend() public {
        RegimeRegistry reg = new RegimeRegistry(admin, address(this), 1 days, false);
        DawnOracle.Config memory c = _cfg(address(feed), address(reg), address(stock), 18, true);
        c.haircutsBps = [uint16(0), 400, 1000, 1500, 2500, 1000];
        DawnOracle o = new DawnOracle(c);

        vm.warp(1_795_280_400 + 1 weeks); // Sat Nov 28 12:00 ET
        feed.setAnswer(100e8);
        o.update();
        assertEq(o.price(), 85e36, "WEEKEND 15%");
        reg.setOverride(address(stock), IRegimeRegistry.Regime.CORP_ACTION, 1 hours);
        assertEq(o.price(), 85e36, "CORP_ACTION 10% floored at WEEKEND 15%");
        assertEq(o.priceForRegime(IRegimeRegistry.Regime.CORP_ACTION), 90e36, "preview has no floor");
        o.update();
        assertEq(o.price(), 85e36, "still floored once frozen");

        c.haircutsBps = [uint16(0), 400, 1000, 900, 2500, 1000]; // WEEKEND below CLOSED still rejected
        vm.expectRevert(DawnOracle.InvalidConfig.selector);
        new DawnOracle(c);
    }
}
