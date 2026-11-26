// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BlueOracle} from "../src/BlueOracle.sol";
import {RegimeRegistry} from "../src/RegimeRegistry.sol";
import {MockAtlasFeed} from "../src/mocks/MockAtlasFeed.sol";
import {MockBStock} from "../src/mocks/MockBStock.sol";

/// Feed shaped like the REAL Atlas SingleFeed: no latestTimestamp(), latestRoundData() only, fully settable.
contract RealShapeFeed {
    uint80 public roundId;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public answeredIn;
    uint256 public startedAt;
    bool public bomb;

    function set(uint80 r, int256 a, uint256 s, uint256 u, uint80 ar) external {
        (roundId, answer, startedAt, updatedAt, answeredIn) = (r, a, s, u, ar);
    }

    function setBomb(bool b) external {
        bomb = b;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestAnswer() external view returns (int256) {
        return answer;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (bomb) {
            assembly {
                revert(0, 0x100000) // huge revert payload
            }
        }
        return (roundId, answer, startedAt, updatedAt, answeredIn);
    }
}

/// Adapter behaviour (latestRoundData read path) against feeds shaped like the real Atlas feeds.
contract AtlasAdapterTest is Test {
    uint256 constant T0 = 1_795_444_200 + 1 hours; // Mon Nov 23 2026 10:30 ET
    RealShapeFeed feed;
    MockBStock stock;
    RegimeRegistry reg;
    BlueOracle oracle;

    function setUp() public {
        vm.warp(T0);
        feed = new RealShapeFeed();
        feed.set(1, 100e8, T0 - 10, T0 - 9, 1);
        stock = new MockBStock("Blue bAAPL", "bAAPL");
        reg = new RegimeRegistry(address(this), address(this), 1 days, false);
        reg.setHolidays(new uint32[](0), true);
        oracle = _deploy(false);
    }

    function _deploy(bool perUI) internal returns (BlueOracle) {
        BlueOracle.Config memory c;
        c.atlasFeed = address(feed);
        c.registry = address(reg);
        c.asset = address(stock);
        c.loanDecimals = 18;
        c.collateralDecimals = 18;
        c.feedDecimals = 8;
        c.feedPerUIShare = perUI;
        c.haircutsBps = [uint16(0), 300, 500, 1000, 1500, 1200];
        c.stalenessSec = [uint32(2 hours), 2 hours, 4 hours, 6 hours, 1 hours, 1 hours];
        c.maxFreeze = 12 hours;
        c.continuityBandBps = 500;
        c.expiredFreezeHaircutBps = 1000;
        return new BlueOracle(c);
    }

    function test_RealShapedFeed_SeedsAndPrices() public view {
        assertEq(oracle.lastGoodPrice(), 100e36);
        assertEq(oracle.lastGoodAt(), T0 - 9, "updatedAt is the observation time");
    }

    function test_RoundZero_Accepted() public {
        // Some real feeds report roundId == answeredInRound == 0.
        feed.set(0, 101e8, T0, T0, 0);
        (bool ok, uint256 p,) = oracle.liveRawPrice();
        assertTrue(ok);
        assertEq(p, 101e36);
    }

    function test_AnsweredInRoundBehindRound_Rejected() public {
        feed.set(5, 101e8, T0, T0, 4);
        (bool ok,,) = oracle.liveRawPrice();
        assertFalse(ok);
        assertEq(oracle.price(), 100e36, "falls back to last good, no revert");
    }

    function test_NonPositiveAnswer_Rejected() public {
        feed.set(1, 0, T0, T0, 1);
        (bool ok,,) = oracle.liveRawPrice();
        assertFalse(ok);
        feed.set(1, -1, T0, T0, 1);
        (ok,,) = oracle.liveRawPrice();
        assertFalse(ok);
        assertEq(oracle.price(), 100e36);
    }

    function test_ZeroUpdatedAt_Rejected() public {
        feed.set(1, 101e8, 0, 0, 1);
        (bool ok,,) = oracle.liveRawPrice();
        assertFalse(ok);
    }

    function test_StaleByUpdatedAt() public {
        feed.set(1, 101e8, T0 - 3 hours, T0 - 3 hours, 1);
        (bool ok,,) = oracle.liveRawPrice(); // OPEN staleness is 2h here
        assertFalse(ok);
        feed.set(1, 101e8, T0 - 1 hours, T0 - 1 hours, 1);
        (ok,,) = oracle.liveRawPrice();
        assertTrue(ok);
    }

    function test_DirtyRoundIdBits_Rejected() public {
        // Hand-built return data with an out-of-range roundId word.
        DirtyFeed d = new DirtyFeed();
        BlueOracle.Config memory c;
        c.atlasFeed = address(d);
        c.registry = address(reg);
        c.asset = address(stock);
        c.loanDecimals = 18;
        c.collateralDecimals = 18;
        c.feedDecimals = 8;
        c.haircutsBps = [uint16(0), 300, 500, 1000, 1500, 1200];
        c.stalenessSec = [uint32(2 hours), 2 hours, 4 hours, 6 hours, 1 hours, 1 hours];
        c.maxFreeze = 12 hours;
        c.continuityBandBps = 500;
        c.expiredFreezeHaircutBps = 1000;
        BlueOracle o = new BlueOracle(c);
        (bool ok,,) = o.liveRawPrice();
        assertFalse(ok);
        vm.expectRevert(BlueOracle.NoPrice.selector);
        o.price();
    }

    function test_RevertBomb_NoRevert() public {
        feed.setBomb(true);
        assertEq(oracle.price(), 100e36);
        oracle.update();
    }

    function test_PerRawVsPerUI_Scaling() public {
        stock.setUIMultiplierNow(8e18);
        // multiplier changed after deploy -> CORP_ACTION path; deploy fresh oracles instead
        BlueOracle perRaw = _deploy(false);
        BlueOracle perUI = _deploy(true);
        assertEq(perRaw.lastGoodPrice(), 100e36, "per raw token: answer used as is");
        assertEq(perUI.lastGoodPrice(), 800e36, "per UI share: x uiMultiplier");
    }

    function test_Mock_StaysCompatible() public {
        MockAtlasFeed m = new MockAtlasFeed(8, 100e8);
        (uint80 r, int256 a,, uint256 u, uint80 ar) = m.latestRoundData();
        assertEq(a, 100e8);
        assertEq(u, T0);
        assertGe(ar, r);
    }
}

contract DirtyFeed {
    function decimals() external pure returns (uint8) {
        return 8;
    }

    fallback() external {
        assembly {
            mstore(0x00, shl(100, 1)) // roundId > uint80
            mstore(0x20, 100000000)
            mstore(0x40, 1)
            mstore(0x60, timestamp())
            mstore(0x80, shl(100, 1))
            return(0x00, 0xa0)
        }
    }
}
