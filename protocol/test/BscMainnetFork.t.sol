// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ACLManager} from "aave/protocol/configuration/ACLManager.sol";
import {IAToken} from "aave/interfaces/IAToken.sol";
import {IMarketCalendar} from "../src/interfaces/IMarketCalendar.sol";
import {BscMainnet} from "../script/BscMainnet.sol";

contract StandInMultisig {}

/// @notice Deploys Blue in a local BNB mainnet fork with the real bStocks, Atlas feeds, Chainlink USDT/USD and
///         USDT, then runs a TSLAB loan through supply, borrow, repay and withdraw.
/// @dev Uses live state, not a pinned block, so prices and feed ages vary between runs. Balances are set with
///      deal(); the tokens' pause and compliance checks are the live ones. Nothing is sent to BNB mainnet.
///      Run with BLUE_RUN_BNB_FORK_TESTS=true and BSC_RPC_URL set to a BNB mainnet RPC.
contract BscMainnetForkTest is Test, BscMainnet {
    uint256 private constant SIGNER_KEY = 0xB0B;
    address private constant GUARDIAN = address(0x123);
    address private immutable LENDER = makeAddr("blueLender");
    address private immutable BORROWER = makeAddr("blueBorrower");
    address private immutable KEEPER = makeAddr("blueKeeper");

    /// @dev Stands in for the multisig. The launch requires a separate admin to be a contract.
    address private admin;
    Deployment private d;

    function setUp() external {
        if (!vm.envOr("BLUE_RUN_BNB_FORK_TESTS", false)) vm.skip(true);
        vm.createSelectFork(vm.envString("BSC_RPC_URL"));
        require(block.chainid == BSC_CHAIN_ID, "BNB fork required");
        admin = address(new StandInMultisig());
        d = _launchBsc(address(this), admin, KEEPER, GUARDIAN, vm.addr(SIGNER_KEY));
        vm.prank(admin);
        d.calendar.acceptAdmin();
    }

    function testLaunchHandsEveryAdminRightToTheMultisig() external view {
        ACLManager acl = ACLManager(d.provider.getACLManager());
        assertEq(d.provider.owner(), admin);
        assertEq(d.provider.getACLAdmin(), admin);
        assertTrue(acl.isPoolAdmin(admin));
        assertFalse(acl.isPoolAdmin(address(this)));
        assertFalse(acl.hasRole(acl.DEFAULT_ADMIN_ROLE(), address(this)));
        assertEq(d.calendar.admin(), admin);
        assertEq(d.controls.admin(), admin);
        assertEq(d.usdtPrice.admin(), admin);
        for (uint256 i; i < d.stockPrices.length; ++i) {
            assertEq(d.stockPrices[i].admin(), admin);
            assertEq(d.stockPrices[i].reporter(), KEEPER);
            address bluToken = d.pool.getReserveAToken(_bscStocks()[i].token);
            assertEq(IAToken(bluToken).RESERVE_TREASURY_ADDRESS(), admin);
        }
        assertEq(IAToken(d.pool.getReserveAToken(USDT)).RESERVE_TREASURY_ADDRESS(), admin);
    }

    function testLaunchRegistersKeeperAndSeedsHolidays() external {
        assertTrue(d.calendar.isKeeper(KEEPER));
        assertTrue(d.calendar.isHoliday(20261126));
        assertTrue(d.calendar.isEarlyClose(20261127));
        vm.prank(KEEPER);
        d.calendar.setOverride(TSLAB, IMarketCalendar.MarketStatus.HALTED, 1 hours);
        assertEq(uint256(d.calendar.status(TSLAB)), uint256(IMarketCalendar.MarketStatus.HALTED));
    }

    function testLaunchRefusesAnAdminWithoutCode() external {
        vm.expectRevert("admin must be deployer or contract");
        this.launchWithAdmin(makeAddr("walletAdmin"));
    }

    /// @dev External so that a revert inside the launch can be expected as one call.
    function launchWithAdmin(address newAdmin) external {
        _launchBsc(address(this), newAdmin, KEEPER, GUARDIAN, vm.addr(SIGNER_KEY));
    }

    function testListsTheRealBStocks() external view {
        StockListing[] memory stocks = _bscStocks();
        string[5] memory symbols = ["TSLAB", "NVDAB", "QQQB", "SPCXB", "GOOGLB"];
        assertEq(d.pool.getReservesCount(), stocks.length + 1);
        assertEq(IERC20Metadata(d.pool.getReserveAToken(USDT)).symbol(), "bluUSDT");
        for (uint256 i; i < stocks.length; ++i) {
            assertEq(IERC20Metadata(stocks[i].token).symbol(), symbols[i]);
            assertEq(
                IERC20Metadata(d.pool.getReserveAToken(stocks[i].token)).symbol(), string.concat("blu", symbols[i])
            );
            assertEq(address(d.stockPrices[i].crossCheckFeed()), address(0)); // Atlas only
        }
    }

    function testRealTslabLoanCycle() external {
        assertGt(d.oracle.getAssetPrice(TSLAB), 0);
        assertGt(d.oracle.getAssetPrice(USDT), 0.9e8);

        deal(USDT, LENDER, 1_000 ether);
        vm.startPrank(LENDER);
        IERC20(USDT).approve(address(d.pool), type(uint256).max);
        d.pool.supply(USDT, 1_000 ether, LENDER, 0);
        vm.stopPrank();

        deal(TSLAB, BORROWER, 1 ether);
        vm.startPrank(BORROWER);
        IERC20(TSLAB).approve(address(d.pool), type(uint256).max);
        d.pool.supply(TSLAB, 1 ether, BORROWER, 0);
        d.pool.setUserUseReserveAsCollateral(TSLAB, true);
        vm.stopPrank();

        for (uint256 i; i <= 5; ++i) {
            vm.prank(KEEPER);
            d.controls.report(TSLAB, true);
            if (i != 5) vm.warp(block.timestamp + 6 minutes);
        }
        uint256 expiry = block.timestamp + 12 hours;
        bytes32 digest = d.controls.eligibilityDigest(BORROWER, TSLAB, d.controls.nonces(BORROWER), expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        vm.prank(BORROWER);
        d.controls.registerEligibility(TSLAB, expiry, abi.encodePacked(r, s, v));

        vm.startPrank(BORROWER);
        d.pool.borrow(USDT, 50 ether, 2, 0, BORROWER);
        assertEq(IERC20(USDT).balanceOf(BORROWER), 50 ether);
        assertEq(d.pool.stockDebt(TSLAB), 50 ether);

        deal(USDT, BORROWER, 51 ether);
        IERC20(USDT).approve(address(d.pool), type(uint256).max);
        d.pool.repay(USDT, type(uint256).max, 2, BORROWER);
        d.pool.withdraw(TSLAB, type(uint256).max, BORROWER);
        vm.stopPrank();

        assertEq(d.pool.stockDebt(TSLAB), 0);
        assertEq(IERC20(TSLAB).balanceOf(BORROWER), 1 ether);
    }
}
