// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IMorpho, MarketParams, MarketParamsLib, Id} from "../../src/interfaces/IMorpho.sol";
import {BlueOracle} from "../../src/BlueOracle.sol";
import {RegimeRegistry} from "../../src/RegimeRegistry.sol";
import {MockAtlasFeed} from "../../src/mocks/MockAtlasFeed.sol";
import {MockBStock} from "../../src/mocks/MockBStock.sol";

interface IERC20Min {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// BNB Chain fork test against the canonical Morpho Blue singleton.
/// RPC: BSC_RPC_URL env var, else the public endpoint. Skipped if the fork cannot be created.
contract MorphoBnbForkTest is Test {
    using MarketParamsLib for MarketParams;

    IMorpho constant MORPHO = IMorpho(0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a);
    address constant IRM = 0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979; // AdaptiveCurveIrm
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955; // BSC-USD, 18 decimals
    uint256 constant LLTV = 0.625e18;

    bool forked;
    MockBStock stock;
    MockAtlasFeed feed;
    RegimeRegistry reg;
    BlueOracle oracle;
    MarketParams mp;

    function setUp() public {
        string memory url = vm.envOr("BSC_RPC_URL", string("https://bsc-dataseed.binance.org"));
        try vm.createSelectFork(url) {
            forked = true;
        } catch {
            forked = false;
        }
        if (!forked) return;

        stock = new MockBStock("Mock bAAPL", "bAAPL");
        feed = new MockAtlasFeed(8, 200e8);
        reg = new RegimeRegistry(address(this), address(this), 1 days, false);
        BlueOracle.Config memory c;
        c.atlasFeed = address(feed);
        c.registry = address(reg);
        c.asset = address(stock);
        c.loanDecimals = 18;
        c.collateralDecimals = 18;
        c.feedDecimals = 8;
        c.feedPerUIShare = true;
        c.haircutsBps = [uint16(0), 300, 500, 1000, 1500, 1200];
        c.stalenessSec = [uint32(1 hours), 1 hours, 4 hours, 6 hours, 1 hours, 1 hours];
        c.maxFreeze = 12 hours;
        c.continuityBandBps = 500;
        c.expiredFreezeHaircutBps = 1000;
        oracle = new BlueOracle(c);

        mp = MarketParams({
            loanToken: USDT, collateralToken: address(stock), oracle: address(oracle), irm: IRM, lltv: LLTV
        });
    }

    modifier onlyFork() {
        vm.skip(!forked);
        _;
    }

    function test_Fork_MorphoParamsEnabled() public onlyFork {
        assertGt(address(MORPHO).code.length, 0, "Morpho deployed");
        assertTrue(MORPHO.isLltvEnabled(LLTV), "62.5% LLTV enabled");
        assertTrue(MORPHO.isIrmEnabled(IRM), "AdaptiveCurveIrm enabled");
    }

    function test_Fork_CreateMarketSupplyBorrow() public onlyFork {
        MORPHO.createMarket(mp);
        Id id = mp.id();
        (address loan, address coll, address orc, address irm, uint256 lltv) = MORPHO.idToMarketParams(id);
        assertEq(loan, USDT);
        assertEq(coll, address(stock));
        assertEq(orc, address(oracle));
        assertEq(irm, IRM);
        assertEq(lltv, LLTV);

        // Lender supplies 10,000 USDT.
        address lender = makeAddr("lender");
        deal(USDT, lender, 10_000e18);
        vm.startPrank(lender);
        IERC20Min(USDT).approve(address(MORPHO), type(uint256).max);
        (uint256 supplied,) = MORPHO.supply(mp, 10_000e18, 0, lender, "");
        vm.stopPrank();
        assertEq(supplied, 10_000e18);
        (uint128 totalSupplyAssets,,,,,) = MORPHO.market(id);
        assertEq(totalSupplyAssets, 10_000e18);

        // Borrower posts 10 bStock ($2,000) and borrows 500 USDT (25% LTV), which calls oracle.price().
        address borrower = makeAddr("borrower");
        stock.mint(borrower, 10e18);
        vm.startPrank(borrower);
        stock.approve(address(MORPHO), type(uint256).max);
        MORPHO.supplyCollateral(mp, 10e18, borrower, "");
        MORPHO.borrow(mp, 500e18, 0, borrower, borrower);
        vm.stopPrank();
        assertEq(IERC20Min(USDT).balanceOf(borrower), 500e18);
        (, uint128 borrowShares, uint128 collateral) = MORPHO.position(id, borrower);
        assertGt(borrowShares, 0);
        assertEq(collateral, 10e18);

        // Total debt 1,300 USDT exceeds even the OPEN-regime limit (62.5% x $2,000 = 1,250): must revert.
        vm.prank(borrower);
        vm.expectRevert();
        MORPHO.borrow(mp, 800e18, 0, borrower, borrower);
    }
}
