// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ICreditDelegationToken} from "aave/interfaces/ICreditDelegationToken.sol";
import {IMarketCalendar} from "../src/interfaces/IMarketCalendar.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {TestBStock} from "./utils/TestBStock.sol";
import {TestPriceFeed} from "./utils/TestPriceFeed.sol";
import {BluePool} from "../src/BluePool.sol";
import {StockBorrowControls} from "../src/StockBorrowControls.sol";
import {StockPriceSource} from "../src/StockPriceSource.sol";
import {BlueV3Deployment} from "../script/BlueV3Deployment.sol";

contract TestUSDT is ERC20 {
    constructor() ERC20("Test USDT", "USDT") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

abstract contract BluePoolScenarios is Test, BlueV3Deployment {
    uint256 private constant SIGNER_KEY = 0xA11CE;
    address private constant GUARDIAN = address(0x123);
    address private immutable TESLA_BORROWER = makeAddr("teslaBorrower");
    address private immutable NVIDIA_BORROWER = makeAddr("nvidiaBorrower");
    uint256 private constant VARIABLE = 2;
    uint256 private constant TESLA = 0;
    uint256 private constant NVIDIA = 1;
    uint256 private constant ALPHABET = 4;

    uint256 private constant STOCK_COUNT = 5;

    struct TestStock {
        TestBStock token;
        TestPriceFeed feed;
        TestPriceFeed secondFeed;
        StockPriceSource source;
    }

    Deployment private d;
    IERC20 private usdt;
    TestPriceFeed private usdtFeed;
    TestStock[STOCK_COUNT] private stocks;

    function _loanToken() internal virtual returns (IERC20);
    function _fundUsdt(address account, uint256 amount) internal virtual;

    function setUp() external {
        vm.warp(1_795_532_400); // Nov 24, 2026, during regular US trading hours once recovery finishes.
        usdt = _loanToken();
        string[STOCK_COUNT] memory symbols = ["TSLAB", "NVDAB", "QQQB", "SPCXB", "GOOGLB"];
        int256[STOCK_COUNT] memory prices = [int256(250e8), 125e8, 500e8, 100e8, 200e8];
        StockListing[] memory listings = new StockListing[](STOCK_COUNT);
        for (uint256 i; i < STOCK_COUNT; ++i) {
            stocks[i].token = new TestBStock(string.concat("Test ", symbols[i]), symbols[i]);
            stocks[i].feed = new TestPriceFeed(8, prices[i]);
            // Alphabet has no cross-check, to cover a stock priced by one feed.
            if (i != ALPHABET) stocks[i].secondFeed = new TestPriceFeed(8, prices[i]);
            listings[i] = StockListing({
                token: address(stocks[i].token),
                feed: IPriceFeed(address(stocks[i].feed)),
                feedPerDisplayedUnit: false,
                minPrice: uint256(prices[i]) / 20,
                maxPrice: uint256(prices[i]) * 20,
                crossCheckFeed: IPriceFeed(address(stocks[i].secondFeed))
            });
        }
        usdtFeed = new TestPriceFeed(8, 1e8);
        UsdFeed memory usdFeed = UsdFeed({
            feed: IPriceFeed(address(usdtFeed)),
            borrowMaxAge: BORROW_MAX_AGE,
            valuationMaxAge: LIQUIDATION_MAX_AGE,
            minPrice: 0.9e8,
            maxPrice: 1.1e8
        });
        d = _deploy(
            address(usdt), Roles(address(this), address(this), GUARDIAN, vm.addr(SIGNER_KEY)), usdFeed, listings
        );
        for (uint256 i; i < STOCK_COUNT; ++i) {
            stocks[i].source = d.stockPrices[i];
        }
        _fundUsdt(address(this), 1_000 ether);
        usdt.approve(address(d.pool), type(uint256).max);
        d.pool.supply(address(usdt), 1_000 ether, address(this), 0);
        _supplyStock(stocks[TESLA].token, TESLA_BORROWER, 3 ether);
        _supplyStock(stocks[NVIDIA].token, NVIDIA_BORROWER, 3 ether);

        for (uint256 i; i <= 5; ++i) {
            for (uint256 j; j < STOCK_COUNT; ++j) {
                d.controls.report(address(stocks[j].token), true);
            }
            if (i != 5) vm.warp(block.timestamp + 6 minutes);
        }
        _eligibility(TESLA_BORROWER, address(stocks[TESLA].token));
        _eligibility(NVIDIA_BORROWER, address(stocks[NVIDIA].token));
    }

    function testAllStocksDrawFromOneReserve() external {
        assertEq(d.pool.getReservesCount(), STOCK_COUNT + 1);
        address aUsdt = d.pool.getReserveAToken(address(usdt));
        assertEq(IERC20Metadata(aUsdt).symbol(), "bluUSDT");
        assertEq(IERC20Metadata(d.pool.getReserveVariableDebtToken(address(usdt))).symbol(), "bluDebtUSDT");
        _borrow(TESLA_BORROWER, 70 ether);
        _borrow(NVIDIA_BORROWER, 30 ether);
        assertEq(d.pool.stockDebt(address(stocks[TESLA].token)), 70 ether);
        assertEq(d.pool.stockDebt(address(stocks[NVIDIA].token)), 30 ether);

        string[3] memory addedSymbols = ["QQQB", "SPCXB", "GOOGLB"];
        for (uint256 i; i < addedSymbols.length; ++i) {
            TestBStock stock = stocks[i + 2].token;
            assertEq(address(stocks[i + 2].source.crossCheckFeed()) == address(0), i + 2 == ALPHABET);
            address borrower = makeAddr(addedSymbols[i]);
            assertEq(stock.symbol(), addedSymbols[i]);
            assertGt(d.oracle.getAssetPrice(address(stock)), 0);
            _supplyStock(stock, borrower, 1 ether);
            _eligibility(borrower, address(stock));
            _borrow(borrower, 10 ether);
            assertEq(d.pool.stockDebt(address(stock)), 10 ether);

            vm.expectRevert(BluePool.UnsupportedDebtAsset.selector);
            vm.prank(borrower);
            d.pool.borrow(address(stock), 1 ether, VARIABLE, 0, borrower);
        }
        assertEq(usdt.balanceOf(aUsdt), 870 ether);
    }

    function testHaltBlocksOnlyTeslaAndAllowsRepay() external {
        _borrow(TESLA_BORROWER, 70 ether);
        d.controls.report(address(stocks[TESLA].token), false);
        d.calendar.setOverride(address(stocks[TESLA].token), IMarketCalendar.MarketStatus.HALTED, 1 hours);

        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(stocks[TESLA].token))
        );
        _borrow(TESLA_BORROWER, 1 ether);
        _borrow(NVIDIA_BORROWER, 30 ether);

        vm.startPrank(TESLA_BORROWER);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(stocks[TESLA].token))
        );
        d.pool.withdraw(address(stocks[TESLA].token), 1 ether, TESLA_BORROWER);
        IERC20 aStock = IERC20(d.pool.getReserveAToken(address(stocks[TESLA].token)));
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(stocks[TESLA].token))
        );
        aStock.transfer(NVIDIA_BORROWER, 1 ether);
        usdt.approve(address(d.pool), type(uint256).max);
        d.pool.repay(address(usdt), type(uint256).max, VARIABLE, TESLA_BORROWER);
        d.pool.withdraw(address(stocks[TESLA].token), type(uint256).max, TESLA_BORROWER);
        vm.stopPrank();

        assertEq(d.pool.stockDebt(address(stocks[TESLA].token)), 0);
        assertEq(d.pool.debtStock(TESLA_BORROWER), address(0));
    }

    function testKeeperSilenceAndGuardianHoldRequireRecovery() external {
        vm.warp(block.timestamp + HEARTBEAT);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(stocks[TESLA].token))
        );
        _borrow(TESLA_BORROWER, 1 ether);
        d.controls.report(address(stocks[TESLA].token), true);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(stocks[TESLA].token))
        );
        _borrow(TESLA_BORROWER, 1 ether);

        vm.prank(GUARDIAN);
        d.controls.setHold(address(stocks[NVIDIA].token), true);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(stocks[NVIDIA].token))
        );
        d.controls.report(address(stocks[NVIDIA].token), true);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(stocks[NVIDIA].token))
        );
        _borrow(NVIDIA_BORROWER, 1 ether);
    }

    function testMonitoringLapseStillAllowsWithdrawalWithinLimit() external {
        address tesla = address(stocks[TESLA].token);
        _borrow(TESLA_BORROWER, 100 ether);
        vm.warp(block.timestamp + HEARTBEAT);
        vm.expectRevert(abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, tesla));
        _borrow(TESLA_BORROWER, 1 ether);

        // $100 of debt at a 50% LTV needs 0.8 TSLAB. Aave's 62.5% liquidation threshold alone needs only 0.64.
        vm.startPrank(TESLA_BORROWER);
        d.pool.withdraw(tesla, 1 ether, TESLA_BORROWER);
        IERC20 aStock = IERC20(d.pool.getReserveAToken(tesla));
        aStock.transfer(NVIDIA_BORROWER, 0.5 ether);
        vm.expectRevert(BluePool.AboveStockLtv.selector);
        d.pool.withdraw(tesla, 0.8 ether, TESLA_BORROWER); // Leaves 0.7 TSLAB.
        vm.stopPrank();
    }

    function testWithdrawalWithDebtNeedsValidPrice() external {
        address tesla = address(stocks[TESLA].token);
        _borrow(TESLA_BORROWER, 100 ether);
        vm.warp(block.timestamp + LIQUIDATION_MAX_AGE + 1);
        vm.expectRevert(StockPriceSource.UnusablePrice.selector);
        vm.prank(TESLA_BORROWER);
        d.pool.withdraw(tesla, 0.1 ether, TESLA_BORROWER);
    }

    function testCrossCheckDisagreementBlocksOnlyNewBorrowing() external {
        address tesla = address(stocks[TESLA].token);
        _borrow(TESLA_BORROWER, 10 ether);
        vm.warp(block.timestamp + 1);
        stocks[TESLA].secondFeed.setAnswer(240e8); // Atlas is 4.2% higher; the OPEN tolerance is 2%.

        (bool available,, uint256 deviation) = stocks[TESLA].source.crossCheck();
        assertTrue(available);
        assertEq(deviation, 416);
        assertFalse(stocks[TESLA].source.usableForBorrow());
        vm.expectRevert(abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, tesla));
        _borrow(TESLA_BORROWER, 1 ether);

        assertEq(stocks[TESLA].source.latestAnswer(), 250e8);
        _borrow(NVIDIA_BORROWER, 10 ether);
        vm.prank(TESLA_BORROWER);
        d.pool.withdraw(tesla, 0.1 ether, TESLA_BORROWER);

        stocks[TESLA].secondFeed.setAnswer(249e8);
        _borrow(TESLA_BORROWER, 1 ether);
    }

    function testCrossCheckToleranceWidensWhileMarketIsClosed() external {
        vm.warp(block.timestamp + 1);
        stocks[TESLA].secondFeed.setAnswer(240e8); // Atlas is 4.2% higher.
        assertFalse(stocks[TESLA].source.usableForBorrow());
        d.calendar.setOverride(address(stocks[TESLA].token), IMarketCalendar.MarketStatus.WEEKEND, 1 hours);
        assertTrue(stocks[TESLA].source.usableForBorrow()); // The WEEKEND tolerance is 5%.
        _borrow(TESLA_BORROWER, 10 ether);
    }

    function testStaleCrossCheckBlocksNewBorrowing() external {
        stocks[TESLA].secondFeed.setAnswerAt(250e8, block.timestamp - CROSS_CHECK_MAX_AGE - 1);
        (bool available,,) = stocks[TESLA].source.crossCheck();
        assertFalse(available);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(stocks[TESLA].token))
        );
        _borrow(TESLA_BORROWER, 1 ether);
    }

    function testExpiredOverrideCannotReopenUsingOldPermission() external {
        d.calendar.setOverride(address(stocks[TESLA].token), IMarketCalendar.MarketStatus.CORP_ACTION, 2 minutes);
        vm.warp(block.timestamp + 2 minutes);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(stocks[TESLA].token))
        );
        _borrow(TESLA_BORROWER, 1 ether);
        d.controls.report(address(stocks[TESLA].token), true);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(stocks[TESLA].token))
        );
        _borrow(TESLA_BORROWER, 1 ether);
    }

    function testStockDebtCapAndLtvRevertEntireBorrow() external {
        uint128[4] memory caps = [uint128(80 ether), 80 ether, 80 ether, 80 ether];
        vm.prank(GUARDIAN);
        d.controls.setCaps(address(stocks[TESLA].token), caps);
        _borrow(TESLA_BORROWER, 80 ether);
        vm.expectRevert(BluePool.StockDebtCapExceeded.selector);
        _borrow(TESLA_BORROWER, 1 ether);
        assertEq(usdt.balanceOf(TESLA_BORROWER), 80 ether);

        // In the weekend status the native 50% LTV would allow this draw, but Blue allows 42.5%.
        d.calendar.setOverride(address(stocks[NVIDIA].token), IMarketCalendar.MarketStatus.WEEKEND, 1 hours);
        d.controls.setCaps(address(stocks[NVIDIA].token), [uint128(400 ether), 400 ether, 400 ether, 400 ether]);
        vm.expectRevert(BluePool.AboveStockLtv.selector);
        _borrow(NVIDIA_BORROWER, 170 ether);
        assertEq(d.pool.stockDebt(address(stocks[NVIDIA].token)), 0);
    }

    function testNoNewDebtWithoutAccountEligibility() external {
        address delegate = address(0x987);
        address newAccount = address(0x654);
        _supplyStock(stocks[TESLA].token, newAccount, 1 ether);
        ICreditDelegationToken debtToken = ICreditDelegationToken(d.pool.getReserveVariableDebtToken(address(usdt)));
        vm.prank(newAccount);
        debtToken.approveDelegation(delegate, 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.Ineligible.selector, newAccount, address(stocks[TESLA].token))
        );
        vm.prank(delegate);
        d.pool.borrow(address(usdt), 1 ether, VARIABLE, 0, newAccount);

        vm.expectRevert(BluePool.FlashLoansDisabled.selector);
        d.pool.flashLoan(address(0), new address[](0), new uint256[](0), new uint256[](0), newAccount, "", 0);
    }

    function testBorrowerCannotAddAnotherActiveStockWhileInDebt() external {
        _borrow(TESLA_BORROWER, 70 ether);
        stocks[NVIDIA].token.mint(TESLA_BORROWER, 1 ether);
        vm.startPrank(TESLA_BORROWER);
        stocks[NVIDIA].token.approve(address(d.pool), 1 ether);
        d.pool.supply(address(stocks[NVIDIA].token), 1 ether, TESLA_BORROWER, 0);
        vm.expectRevert();
        d.pool.setUserUseReserveAsCollateral(address(stocks[NVIDIA].token), true);
        vm.expectRevert();
        d.pool.setUserUseReserveAsCollateral(address(stocks[TESLA].token), false);
        vm.stopPrank();
        assertEq(d.pool.debtStock(TESLA_BORROWER), address(stocks[TESLA].token));
    }

    function testStockDebtAccruesAndReconcilesPartialRepayment() external {
        _borrow(TESLA_BORROWER, 70 ether);
        vm.warp(block.timestamp + 1 days);
        IERC20 debtToken = IERC20(d.pool.getReserveVariableDebtToken(address(usdt)));
        assertGt(d.pool.stockDebt(address(stocks[TESLA].token)), 70 ether);
        vm.startPrank(TESLA_BORROWER);
        usdt.approve(address(d.pool), type(uint256).max);
        d.pool.repay(address(usdt), 20 ether, VARIABLE, TESLA_BORROWER);
        vm.stopPrank();
        assertEq(d.pool.stockDebt(address(stocks[TESLA].token)), debtToken.balanceOf(TESLA_BORROWER));
        assertEq(d.pool.debtStock(TESLA_BORROWER), address(stocks[TESLA].token));
    }

    function testGenuineGapBlocksBorrowButLiquidationUsesLivePrice() external {
        address tesla = address(stocks[TESLA].token);
        _borrow(TESLA_BORROWER, 150 ether);
        vm.warp(block.timestamp + 1);
        // A 76% drop with no corporate action: outside the continuity band, inside the absolute band.
        stocks[TESLA].feed.setAnswer(60e8);

        assertFalse(stocks[TESLA].source.usableForBorrow());
        vm.expectRevert(StockPriceSource.DiscontinuousPrice.selector);
        stocks[TESLA].source.refresh();
        vm.expectRevert(abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, tesla));
        _borrow(TESLA_BORROWER, 1 ether);

        assertEq(stocks[TESLA].source.latestAnswer(), 60e8);
        (,,,,, uint256 health) = d.pool.getUserAccountData(TESLA_BORROWER);
        assertLt(health, 1e18);
        uint256 debtBefore = d.pool.stockDebt(tesla);
        _fundUsdt(address(this), 200 ether); // Covers accrued interest.
        d.pool.liquidationCall(tesla, address(usdt), TESLA_BORROWER, type(uint256).max, false);
        assertLt(d.pool.stockDebt(tesla), debtBefore);

        // Borrowing reopens only after the admin accepts the new reference and the second feed confirms it.
        stocks[TESLA].source.acceptReference();
        assertFalse(stocks[TESLA].source.usableForBorrow());
        stocks[TESLA].secondFeed.setAnswer(60e8);
        assertTrue(stocks[TESLA].source.usableForBorrow());
    }

    function testAnnouncedSplitBlocksBorrowAndLiquidationButRepayWorks() external {
        address tesla = address(stocks[TESLA].token);
        _borrow(TESLA_BORROWER, 80 ether);
        d.calendar.setOverride(tesla, IMarketCalendar.MarketStatus.CORP_ACTION, 1 days);
        vm.warp(block.timestamp + 1);
        // Feed-first 2:1 split: the price halves before the multiplier changes.
        stocks[TESLA].feed.setAnswer(125e8);
        assertFalse(stocks[TESLA].source.usableForBorrow());
        vm.expectRevert(StockPriceSource.UnusablePrice.selector);
        stocks[TESLA].source.latestAnswer();

        _fundUsdt(TESLA_BORROWER, 1 ether);
        vm.startPrank(TESLA_BORROWER);
        usdt.approve(address(d.pool), type(uint256).max);
        d.pool.repay(address(usdt), type(uint256).max, VARIABLE, TESLA_BORROWER);
        vm.stopPrank();
        assertEq(d.pool.stockDebt(tesla), 0);
    }

    function testChangedMultiplierNeedsNewReference() external {
        stocks[TESLA].token.setUIMultiplierNow(2e18);
        vm.expectRevert(StockPriceSource.UnusablePrice.selector);
        stocks[TESLA].source.latestAnswer();
        assertFalse(stocks[TESLA].source.usableForBorrow());

        vm.warp(block.timestamp + 1);
        stocks[TESLA].feed.setAnswer(250e8);
        stocks[TESLA].source.acceptReference();
        assertEq(stocks[TESLA].source.latestAnswer(), 250e8);
    }

    function testPriceOutsideAbsoluteBandIsUnusable() external {
        vm.warp(block.timestamp + 1);
        stocks[TESLA].feed.setAnswer(10e8); // Below 1/20 of the 250 launch price.
        vm.expectRevert(StockPriceSource.UnusablePrice.selector);
        stocks[TESLA].source.latestAnswer();
        assertFalse(stocks[TESLA].source.usableForBorrow());
    }

    function testLiquidationReconcilesStockDebtIncludingDeficit() external {
        _borrow(TESLA_BORROWER, 150 ether);
        vm.warp(block.timestamp + 1);
        stocks[TESLA].feed.setAnswer(20e8);
        d.controls.report(address(stocks[TESLA].token), false);
        _fundUsdt(address(this), 150 ether);
        d.pool.liquidationCall(address(stocks[TESLA].token), address(usdt), TESLA_BORROWER, type(uint256).max, false);

        assertGt(d.pool.getReserveDeficit(address(usdt)), 0);
        assertEq(d.pool.stockDebt(address(stocks[TESLA].token)), 0);
        assertEq(d.pool.debtStock(TESLA_BORROWER), address(0));
    }

    function _supplyStock(TestBStock stock, address account, uint256 amount) private {
        stock.mint(account, amount);
        vm.startPrank(account);
        stock.approve(address(d.pool), type(uint256).max);
        d.pool.supply(address(stock), amount, account, 0);
        d.pool.setUserUseReserveAsCollateral(address(stock), true);
        vm.stopPrank();
    }

    function _eligibility(address account, address stock) private {
        uint256 expiry = block.timestamp + 12 hours;
        bytes32 digest = d.controls.eligibilityDigest(account, stock, d.controls.nonces(account), expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        vm.prank(account);
        d.controls.registerEligibility(stock, expiry, abi.encodePacked(r, s, v));
    }

    function _borrow(address account, uint256 amount) private {
        vm.prank(account);
        d.pool.borrow(address(usdt), amount, VARIABLE, 0, account);
    }
}

contract BluePoolTest is BluePoolScenarios {
    TestUSDT private testUsdt;

    function _loanToken() internal override returns (IERC20) {
        testUsdt = new TestUSDT();
        return testUsdt;
    }

    function _fundUsdt(address account, uint256 amount) internal override {
        testUsdt.mint(account, amount);
    }
}

contract BluePoolBnbForkTest is BluePoolScenarios {
    IERC20 private constant BNB_USDT = IERC20(0x55d398326f99059fF775485246999027B3197955);

    function _loanToken() internal override returns (IERC20) {
        if (!vm.envOr("BLUE_RUN_BNB_FORK_TESTS", false)) vm.skip(true);
        uint256 scenarioTime = block.timestamp;
        vm.createSelectFork(vm.envString("BSC_RPC_URL"));
        require(block.chainid == 56 && address(BNB_USDT).code.length != 0, "BNB fork required");
        vm.warp(scenarioTime);
        return BNB_USDT;
    }

    function _fundUsdt(address account, uint256 amount) internal override {
        deal(address(BNB_USDT), account, BNB_USDT.balanceOf(account) + amount);
    }
}
