// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ScenarioBase, IERC20T} from "./ScenarioBase.sol";
import {MarketParams, MarketParamsLib} from "../../src/interfaces/IMorpho.sol";
import {IRegimeRegistry} from "../../src/interfaces/IRegimeRegistry.sol";
import {BlueRouter} from "../../src/BlueRouter.sol";
import {NaiveOracle} from "../../src/mocks/NaiveOracle.sol";

/// The four demo scenarios on a BNB Chain fork against the real Morpho Blue singleton, deployed with the same
/// BlueDeploy code as script/Deploy.s.sol (placeholder haircuts: OPEN 0, EXTENDED 4%, CLOSED 10%, WEEKEND 15%,
/// HALTED 25%, CORP_ACTION 10%, margin 2%, LLTV 62.5% => targetLTV 51.125%).
contract ScenariosForkTest is ScenarioBase {
    using MarketParamsLib for MarketParams;

    uint256 constant COLL = 10e18; // 10 bStock at $200 = $2,000
    uint256 constant TARGET_LTV = 0.51125e18;

    // ------------------------------------------------------------ 1. borrow in OPEN

    function test_Scenario1_BorrowInOpen() public onlyFork {
        assertEq(uint8(d.registry.regime(address(d.bStock))), uint8(IRegimeRegistry.Regime.OPEN));
        assertEq(d.router.targetLtv(d.marketId, IRegimeRegistry.Regime.OPEN), TARGET_LTV);
        assertEq(d.oracle.price(), 200e36, "OPEN: no haircut");

        uint256 amount = _openAtLimit(borrower, COLL);
        assertEq(amount, 1022.5e18, "10 x $200 x 51.125%");
        assertEq(IERC20T(USDT).balanceOf(borrower), amount);
        assertEq(_debt(d.marketParams, borrower), amount);

        // Health on Morpho: LLTV / targetLTV = 62.5 / 51.125 = 1.2225
        assertApproxEqRel(_health(d.marketParams, borrower), 1.2225e18, 1e14);

        // One more wei is above the router's limit (Morpho itself would still allow it).
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(BlueRouter.AboveTargetLtv.selector, amount + 1, amount));
        d.router.supplyCollateralAndBorrow(d.marketParams, 0, 1, borrower, a);
    }

    // ------------------------------------------------------------ 2. regime flip to WEEKEND

    function test_Scenario2_WeekendFlipTightensButNotLiquidatable() public onlyFork {
        uint256 amount = _openAtLimit(borrower, COLL);
        uint256 hOpen = _health(d.marketParams, borrower);

        // Keeper flips the asset to WEEKEND (e.g. holiday not yet in the table). Feed unchanged.
        vm.prank(keeper);
        d.registry.setOverride(address(d.bStock), IRegimeRegistry.Regime.WEEKEND, 1 days);
        _refresh(PRICE0);
        assertEq(d.oracle.price(), 170e36, "WEEKEND 15% haircut");

        // Borrow limit tightens: 10 x $170 x 51.125% = 869.125 < current debt.
        uint256 limit = d.router.borrowLimit(d.marketId, borrower);
        assertEq(limit, 869.125e18);
        assertLt(limit, amount);
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(BlueRouter.AboveTargetLtv.selector, amount + 1, limit));
        d.router.supplyCollateralAndBorrow(d.marketParams, 0, 1, borrower, a);

        // Health drops by exactly the haircut, but stays above 1: not liquidatable.
        uint256 hWeekend = _health(d.marketParams, borrower);
        assertLt(hWeekend, hOpen);
        assertApproxEqRel(hWeekend, (hOpen * 85) / 100, 1e14);
        assertGe(hWeekend, 1e18);
        assertFalse(_liquidatable(d.marketParams, borrower));
        _expectLiquidateReverts(d.marketParams, borrower);

        // A fresh position opened at the limit during WEEKEND is also safe (even more so).
        address b2 = makeAddr("weekendBorrower");
        uint256 amount2 = _openAtLimit(b2, COLL);
        assertEq(amount2, limit);
        assertGt(_health(d.marketParams, b2), 1e18);
    }

    /// The guarantee covers every routine regime, in any order the keeper can move it.
    function test_Scenario2b_EveryRoutineRegimeIsSafe() public onlyFork {
        _openAtLimit(borrower, COLL);
        IRegimeRegistry.Regime[3] memory rs =
            [IRegimeRegistry.Regime.EXTENDED, IRegimeRegistry.Regime.CLOSED, IRegimeRegistry.Regime.WEEKEND];
        for (uint256 i; i < 3; ++i) {
            vm.prank(keeper);
            d.registry.setOverride(address(d.bStock), rs[i], 1 days);
            _refresh(PRICE0);
            assertGe(_health(d.marketParams, borrower), 1e18, "routine regime never liquidates a fresh position");
        }
    }

    /// Documented limitation: HALTED (25%) is above h_max (15%), so a HALTED flag alone does make a position
    /// opened at targetLTV liquidatable: 62.5% x 75% = 46.9% < 51.125%.
    function test_Scenario2c_HaltedIsNotCovered() public onlyFork {
        _openAtLimit(borrower, COLL);
        vm.prank(keeper);
        d.registry.setOverride(address(d.bStock), IRegimeRegistry.Regime.HALTED, 1 hours);
        d.oracle.update();
        assertEq(d.oracle.price(), 150e36);
        assertTrue(_liquidatable(d.marketParams, borrower));
    }

    // ------------------------------------------------------------ 3. 2-for-1 multiplier update

    function test_Scenario3_SplitNaiveOracleLiquidatesBlueDoesNot() public onlyFork {
        // Baseline market: same tokens and LLTV, NaiveOracle (feed as-is, no multiplier handling).
        NaiveOracle naive = new NaiveOracle(address(d.feed), 18, 18, 8);
        MarketParams memory nmp = MarketParams({
            loanToken: USDT, collateralToken: address(d.bStock), oracle: address(naive), irm: IRM, lltv: LLTV
        });
        M.createMarket(nmp);
        deal(USDT, address(this), SEED);
        IERC20T(USDT).approve(MORPHO, SEED);
        M.supply(nmp, SEED, 0, address(this), "");

        // Same position on both: 10 bStock, 1,022.5 USDT (51.125% LTV at $200).
        uint256 amount = _openAtLimit(borrower, COLL);
        address nb = makeAddr("naiveBorrower");
        d.bStock.mint(nb, COLL);
        vm.startPrank(nb);
        d.bStock.approve(MORPHO, COLL);
        M.supplyCollateral(nmp, COLL, nb, "");
        M.borrow(nmp, amount, 0, nb, nb);
        vm.stopPrank();
        assertGt(_health(nmp, nb), 1e18);

        // 2-for-1 split: each raw token now shows as 2 UI shares at $100. Raw token value is unchanged.
        d.bStock.setUIMultiplierNow(2e18);
        d.feed.setAnswer(100e8);

        // Naive oracle halves the collateral value: health 1.2225 -> 0.61, liquidatable.
        assertEq(naive.price(), 100e36);
        assertTrue(_liquidatable(nmp, nb), "naive oracle: split looks like a 50% crash");
        // The naive position is underwater ($1,000 collateral < $1,022.5 debt), so seize all collateral
        // (repaying all shares would need more collateral than exists).
        deal(USDT, liquidator, 1_000_000e18);
        vm.startPrank(liquidator);
        IERC20T(USDT).approve(MORPHO, type(uint256).max);
        (uint256 seized,) = M.liquidate(nmp, nb, COLL, 0, "");
        vm.stopPrank();
        assertEq(seized, COLL, "naive position liquidated by the split alone");

        // Blue before anyone calls update(): multiplier changed => frozen last good, CORP_ACTION 10% haircut.
        assertTrue(d.oracle.isFrozen());
        assertEq(d.oracle.price(), 180e36);
        assertFalse(_liquidatable(d.marketParams, borrower));
        _expectLiquidateReverts(d.marketParams, borrower);

        // update(): feed x multiplier = $100 x 2 = $200 per raw token, within the 5% band => unfreeze, continuous.
        d.oracle.update();
        assertFalse(d.oracle.isFrozen());
        assertEq(d.oracle.price(), 200e36, "continuous across the split");
        assertApproxEqRel(_health(d.marketParams, borrower), 1.2225e18, 1e14);
    }

    /// Feed-first ordering: the feed halves before the multiplier lands. With the keeper's CORP_ACTION flag set
    /// first, the oracle freezes instead of reading a 50% "crash".
    function test_Scenario3b_FeedFirstWithKeeperFlagFreezes() public onlyFork {
        _openAtLimit(borrower, COLL);
        vm.prank(keeper);
        d.registry.setOverride(address(d.bStock), IRegimeRegistry.Regime.CORP_ACTION, 1 days);
        d.oracle.update();

        d.feed.setAnswer(100e8); // feed first
        d.oracle.update();
        assertTrue(d.oracle.isFrozen());
        assertEq(d.oracle.price(), 180e36);
        assertFalse(_liquidatable(d.marketParams, borrower));

        d.bStock.setUIMultiplierNow(2e18); // multiplier lands
        d.registry.clearOverride(address(d.bStock)); // admin clears after verification
        d.oracle.update();
        assertFalse(d.oracle.isFrozen());
        assertEq(d.oracle.price(), 200e36);
    }

    // ------------------------------------------------------------ 4. genuine price gap

    function test_Scenario4_PriceGapLiquidation() public onlyFork {
        uint256 amount = _openAtLimit(borrower, COLL);

        // 30% gap down in OPEN ($200 -> $140). Downward moves are never frozen, so Morpho sees it at once.
        _refresh(140e8);
        assertFalse(d.oracle.isFrozen());
        assertEq(d.oracle.price(), 140e36);
        assertTrue(_liquidatable(d.marketParams, borrower));

        (, uint128 sharesBefore, uint128 collBefore) = M.position(d.marketId, borrower);
        assertGt(sharesBefore, 0);
        (uint256 seized, uint256 repaid) = _liquidateAll(d.marketParams, borrower);

        (, uint128 sharesAfter, uint128 collAfter) = M.position(d.marketId, borrower);
        assertEq(sharesAfter, 0, "debt fully repaid by the liquidator");
        assertEq(collBefore - collAfter, seized);
        assertEq(d.bStock.balanceOf(liquidator), seized);
        assertApproxEqAbs(repaid, amount, 1e6, "liquidator repaid the debt");
        // LIF at 62.5% LLTV = 1 / (1 - 0.3 x 0.375) = 1.1268: seized value ~ repaid x 1.1268
        assertApproxEqRel((seized * 140e18) / repaid, 1.1268e18, 1e15);
        assertLt(seized, COLL, "no bad debt at a 30% gap");
    }
}
