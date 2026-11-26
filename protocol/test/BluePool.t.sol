// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ICreditDelegationToken} from "aave/interfaces/ICreditDelegationToken.sol";
import {IMarketCalendar} from "../src/interfaces/IMarketCalendar.sol";
import {MockBStock} from "../src/mocks/MockBStock.sol";
import {BluePool} from "../src/BluePool.sol";
import {StockBorrowControls} from "../src/StockBorrowControls.sol";
import {StockPriceSource} from "../src/StockPriceSource.sol";
import {BlueV3Deployment} from "../script/BlueV3Deployment.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "USDT") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

abstract contract BluePoolScenarios is Test, BlueV3Deployment {
    uint256 private constant SIGNER_KEY = 0xA11CE;
    address private constant GUARDIAN = address(0x123);
    address private constant TESLA_BORROWER = address(0x456);
    address private constant NVIDIA_BORROWER = address(0x789);
    uint256 private constant VARIABLE = 2;
    uint256 private constant TESLA = 0;
    uint256 private constant NVIDIA = 1;

    Deployment private d;
    IERC20 private usdt;

    function _loanToken() internal virtual returns (IERC20);
    function _fundUsdt(address account, uint256 amount) internal virtual;

    function setUp() external {
        vm.warp(1_795_532_400); // Nov 24, 2026, during regular US trading hours once recovery finishes.
        usdt = _loanToken();
        d = _deploy(address(usdt), Roles(address(this), address(this), GUARDIAN, vm.addr(SIGNER_KEY)));
        _fundUsdt(address(this), 1_000 ether);
        usdt.approve(address(d.pool), type(uint256).max);
        d.pool.supply(address(usdt), 1_000 ether, address(this), 0);
        _supplyStock(d.stocks[TESLA].token, TESLA_BORROWER, 3 ether);
        _supplyStock(d.stocks[NVIDIA].token, NVIDIA_BORROWER, 3 ether);

        for (uint256 i; i <= 5; ++i) {
            for (uint256 j; j < STOCK_COUNT; ++j) {
                d.controls.report(address(d.stocks[j].token), true);
            }
            if (i != 5) vm.warp(block.timestamp + 6 minutes);
        }
        _eligibility(TESLA_BORROWER, address(d.stocks[TESLA].token));
        _eligibility(NVIDIA_BORROWER, address(d.stocks[NVIDIA].token));
    }

    function testSharedBudgetBindsAggregateDebtAcrossStocks() external {
        d.controls.setSharedLimits(100 ether, 10_000);
        _borrow(TESLA_BORROWER, 70 ether);
        vm.expectRevert(StockBorrowControls.InvalidPolicy.selector);
        _borrow(NVIDIA_BORROWER, 31 ether);
        _borrow(NVIDIA_BORROWER, 30 ether);
    }

    function testStockConcentrationUsesConfiguredBudgetAndGuardianOnlyTightens() external {
        d.controls.setSharedLimits(100 ether, 6_000);
        _borrow(TESLA_BORROWER, 60 ether);
        vm.expectRevert(StockBorrowControls.InvalidPolicy.selector);
        _borrow(TESLA_BORROWER, 1 ether);
        _borrow(NVIDIA_BORROWER, 30 ether);
        vm.startPrank(GUARDIAN);
        d.controls.setSharedLimits(90 ether, 5_000);
        vm.expectRevert(StockBorrowControls.InvalidPolicy.selector);
        d.controls.setSharedLimits(100 ether, 5_000);
        vm.expectRevert(StockBorrowControls.InvalidPolicy.selector);
        d.controls.setSharedLimits(90 ether, 6_000);
        vm.stopPrank();
        assertGt(d.pool.stockDebt(address(d.stocks[TESLA].token)), 0);
    }

    function testAllMockStocksDrawFromOneReserve() external {
        assertEq(d.pool.getReservesCount(), STOCK_COUNT + 1);
        address aUsdt = d.pool.getReserveAToken(address(usdt));
        assertEq(IERC20Metadata(aUsdt).symbol(), "bluUSDT");
        assertEq(IERC20Metadata(d.pool.getReserveVariableDebtToken(address(usdt))).symbol(), "bluDebtUSDT");
        _borrow(TESLA_BORROWER, 70 ether);
        _borrow(NVIDIA_BORROWER, 30 ether);
        assertEq(d.pool.stockDebt(address(d.stocks[TESLA].token)), 70 ether);
        assertEq(d.pool.stockDebt(address(d.stocks[NVIDIA].token)), 30 ether);

        string[3] memory addedSymbols = ["QQQb", "SPCXb", "GOOGLb"];
        for (uint256 i; i < addedSymbols.length; ++i) {
            MockBStock stock = d.stocks[i + 2].token;
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
        d.controls.report(address(d.stocks[TESLA].token), false);
        d.calendar.setOverride(address(d.stocks[TESLA].token), IMarketCalendar.MarketStatus.HALTED, 1 hours);

        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(d.stocks[TESLA].token))
        );
        _borrow(TESLA_BORROWER, 1 ether);
        _borrow(NVIDIA_BORROWER, 30 ether);

        vm.startPrank(TESLA_BORROWER);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(d.stocks[TESLA].token))
        );
        d.pool.withdraw(address(d.stocks[TESLA].token), 1 ether, TESLA_BORROWER);
        IERC20 aStock = IERC20(d.pool.getReserveAToken(address(d.stocks[TESLA].token)));
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(d.stocks[TESLA].token))
        );
        aStock.transfer(NVIDIA_BORROWER, 1 ether);
        usdt.approve(address(d.pool), type(uint256).max);
        d.pool.repay(address(usdt), type(uint256).max, VARIABLE, TESLA_BORROWER);
        d.pool.withdraw(address(d.stocks[TESLA].token), type(uint256).max, TESLA_BORROWER);
        vm.stopPrank();

        assertEq(d.pool.stockDebt(address(d.stocks[TESLA].token)), 0);
        assertEq(d.pool.debtStock(TESLA_BORROWER), address(0));
    }

    function testKeeperSilenceAndGuardianHoldRequireRecovery() external {
        vm.warp(block.timestamp + HEARTBEAT);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(d.stocks[TESLA].token))
        );
        _borrow(TESLA_BORROWER, 1 ether);
        d.controls.report(address(d.stocks[TESLA].token), true);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(d.stocks[TESLA].token))
        );
        _borrow(TESLA_BORROWER, 1 ether);

        vm.prank(GUARDIAN);
        d.controls.setHold(address(d.stocks[NVIDIA].token), true);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(d.stocks[NVIDIA].token))
        );
        d.controls.report(address(d.stocks[NVIDIA].token), true);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(d.stocks[NVIDIA].token))
        );
        _borrow(NVIDIA_BORROWER, 1 ether);
    }

    function testMonitoringLapseStillAllowsWithdrawalWithinLimit() external {
        address tesla = address(d.stocks[TESLA].token);
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
        address tesla = address(d.stocks[TESLA].token);
        _borrow(TESLA_BORROWER, 100 ether);
        vm.warp(block.timestamp + LIQUIDATION_MAX_AGE + 1);
        vm.expectRevert(StockPriceSource.UnusablePrice.selector);
        vm.prank(TESLA_BORROWER);
        d.pool.withdraw(tesla, 0.1 ether, TESLA_BORROWER);
    }

    function testExpiredOverrideCannotReopenUsingOldPermission() external {
        d.calendar.setOverride(address(d.stocks[TESLA].token), IMarketCalendar.MarketStatus.CORP_ACTION, 2 minutes);
        vm.warp(block.timestamp + 2 minutes);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(d.stocks[TESLA].token))
        );
        _borrow(TESLA_BORROWER, 1 ether);
        d.controls.report(address(d.stocks[TESLA].token), true);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, address(d.stocks[TESLA].token))
        );
        _borrow(TESLA_BORROWER, 1 ether);
    }

    function testStockDebtCapAndLtvRevertEntireBorrow() external {
        uint128[4] memory caps = [uint128(80 ether), 80 ether, 80 ether, 80 ether];
        vm.prank(GUARDIAN);
        d.controls.setCaps(address(d.stocks[TESLA].token), caps);
        _borrow(TESLA_BORROWER, 80 ether);
        vm.expectRevert(BluePool.StockDebtCapExceeded.selector);
        _borrow(TESLA_BORROWER, 1 ether);
        assertEq(usdt.balanceOf(TESLA_BORROWER), 80 ether);

        // In the weekend status the native 50% LTV would allow this draw, but Blue allows 42.5%.
        d.calendar.setOverride(address(d.stocks[NVIDIA].token), IMarketCalendar.MarketStatus.WEEKEND, 1 hours);
        d.controls.setCaps(address(d.stocks[NVIDIA].token), [uint128(400 ether), 400 ether, 400 ether, 400 ether]);
        vm.expectRevert(BluePool.AboveStockLtv.selector);
        _borrow(NVIDIA_BORROWER, 170 ether);
        assertEq(d.pool.stockDebt(address(d.stocks[NVIDIA].token)), 0);
    }

    function testNoNewDebtWithoutAccountEligibility() external {
        address delegate = address(0x987);
        address newAccount = address(0x654);
        _supplyStock(d.stocks[TESLA].token, newAccount, 1 ether);
        ICreditDelegationToken debtToken = ICreditDelegationToken(d.pool.getReserveVariableDebtToken(address(usdt)));
        vm.prank(newAccount);
        debtToken.approveDelegation(delegate, 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(StockBorrowControls.Ineligible.selector, newAccount, address(d.stocks[TESLA].token))
        );
        vm.prank(delegate);
        d.pool.borrow(address(usdt), 1 ether, VARIABLE, 0, newAccount);

        vm.expectRevert(BluePool.FlashLoansDisabled.selector);
        d.pool.flashLoan(address(0), new address[](0), new uint256[](0), new uint256[](0), newAccount, "", 0);
    }

    function testBorrowerCannotAddAnotherActiveStockWhileInDebt() external {
        _borrow(TESLA_BORROWER, 70 ether);
        d.stocks[NVIDIA].token.mint(TESLA_BORROWER, 1 ether);
        vm.startPrank(TESLA_BORROWER);
        d.stocks[NVIDIA].token.approve(address(d.pool), 1 ether);
        d.pool.supply(address(d.stocks[NVIDIA].token), 1 ether, TESLA_BORROWER, 0);
        vm.expectRevert();
        d.pool.setUserUseReserveAsCollateral(address(d.stocks[NVIDIA].token), true);
        vm.expectRevert();
        d.pool.setUserUseReserveAsCollateral(address(d.stocks[TESLA].token), false);
        vm.stopPrank();
        assertEq(d.pool.debtStock(TESLA_BORROWER), address(d.stocks[TESLA].token));
    }

    function testStockDebtAccruesAndReconcilesPartialRepayment() external {
        _borrow(TESLA_BORROWER, 70 ether);
        vm.warp(block.timestamp + 1 days);
        IERC20 debtToken = IERC20(d.pool.getReserveVariableDebtToken(address(usdt)));
        assertGt(d.pool.stockDebt(address(d.stocks[TESLA].token)), 70 ether);
        vm.startPrank(TESLA_BORROWER);
        usdt.approve(address(d.pool), type(uint256).max);
        d.pool.repay(address(usdt), 20 ether, VARIABLE, TESLA_BORROWER);
        vm.stopPrank();
        assertEq(d.pool.stockDebt(address(d.stocks[TESLA].token)), debtToken.balanceOf(TESLA_BORROWER));
        assertEq(d.pool.debtStock(TESLA_BORROWER), address(d.stocks[TESLA].token));
    }

    function testGenuineGapBlocksBorrowButLiquidationUsesLivePrice() external {
        address tesla = address(d.stocks[TESLA].token);
        _borrow(TESLA_BORROWER, 150 ether);
        vm.warp(block.timestamp + 1);
        // A 76% drop with no corporate action: outside the continuity band, inside the absolute band.
        d.stocks[TESLA].feed.setAnswer(60e8);

        assertFalse(d.stocks[TESLA].source.usableForBorrow());
        vm.expectRevert(StockPriceSource.DiscontinuousPrice.selector);
        d.stocks[TESLA].source.refresh();
        vm.expectRevert(abi.encodeWithSelector(StockBorrowControls.NewRiskBlocked.selector, tesla));
        _borrow(TESLA_BORROWER, 1 ether);

        assertEq(d.stocks[TESLA].source.latestAnswer(), 60e8);
        (,,,,, uint256 health) = d.pool.getUserAccountData(TESLA_BORROWER);
        assertLt(health, 1e18);
        uint256 debtBefore = d.pool.stockDebt(tesla);
        _fundUsdt(address(this), 200 ether); // Covers accrued interest.
        d.pool.liquidationCall(tesla, address(usdt), TESLA_BORROWER, type(uint256).max, false);
        assertLt(d.pool.stockDebt(tesla), debtBefore);

        // Borrowing reopens only after the admin accepts the new reference.
        d.stocks[TESLA].source.acceptReference();
        assertTrue(d.stocks[TESLA].source.usableForBorrow());
    }

    function testAnnouncedSplitBlocksBorrowAndLiquidationButRepayWorks() external {
        address tesla = address(d.stocks[TESLA].token);
        _borrow(TESLA_BORROWER, 80 ether);
        d.calendar.setOverride(tesla, IMarketCalendar.MarketStatus.CORP_ACTION, 1 days);
        vm.warp(block.timestamp + 1);
        // Feed-first 2:1 split: the price halves before the multiplier changes.
        d.stocks[TESLA].feed.setAnswer(125e8);
        assertFalse(d.stocks[TESLA].source.usableForBorrow());
        vm.expectRevert(StockPriceSource.UnusablePrice.selector);
        d.stocks[TESLA].source.latestAnswer();

        _fundUsdt(TESLA_BORROWER, 1 ether);
        vm.startPrank(TESLA_BORROWER);
        usdt.approve(address(d.pool), type(uint256).max);
        d.pool.repay(address(usdt), type(uint256).max, VARIABLE, TESLA_BORROWER);
        vm.stopPrank();
        assertEq(d.pool.stockDebt(tesla), 0);
    }

    function testChangedMultiplierNeedsNewReference() external {
        d.stocks[TESLA].token.setUIMultiplierNow(2e18);
        vm.expectRevert(StockPriceSource.UnusablePrice.selector);
        d.stocks[TESLA].source.latestAnswer();
        assertFalse(d.stocks[TESLA].source.usableForBorrow());

        vm.warp(block.timestamp + 1);
        d.stocks[TESLA].feed.setAnswer(250e8);
        d.stocks[TESLA].source.acceptReference();
        assertEq(d.stocks[TESLA].source.latestAnswer(), 250e8);
    }

    function testPriceOutsideAbsoluteBandIsUnusable() external {
        vm.warp(block.timestamp + 1);
        d.stocks[TESLA].feed.setAnswer(10e8); // Below 1/20 of the 250 launch price.
        vm.expectRevert(StockPriceSource.UnusablePrice.selector);
        d.stocks[TESLA].source.latestAnswer();
        assertFalse(d.stocks[TESLA].source.usableForBorrow());
    }

    function testLiquidationReconcilesStockDebtIncludingDeficit() external {
        _borrow(TESLA_BORROWER, 150 ether);
        vm.warp(block.timestamp + 1);
        d.stocks[TESLA].feed.setAnswer(20e8);
        d.controls.report(address(d.stocks[TESLA].token), false);
        _fundUsdt(address(this), 150 ether);
        d.pool.liquidationCall(address(d.stocks[TESLA].token), address(usdt), TESLA_BORROWER, type(uint256).max, false);

        assertGt(d.pool.getReserveDeficit(address(usdt)), 0);
        assertEq(d.pool.stockDebt(address(d.stocks[TESLA].token)), 0);
        assertEq(d.pool.debtStock(TESLA_BORROWER), address(0));
    }

    function _supplyStock(MockBStock stock, address account, uint256 amount) private {
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
    MockUSDT private mock;

    function _loanToken() internal override returns (IERC20) {
        mock = new MockUSDT();
        return mock;
    }

    function _fundUsdt(address account, uint256 amount) internal override {
        mock.mint(account, amount);
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
