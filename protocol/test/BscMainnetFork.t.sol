// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {BscMainnet} from "../script/BscMainnet.sol";

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

    Deployment private d;

    function setUp() external {
        if (!vm.envOr("BLUE_RUN_BNB_FORK_TESTS", false)) vm.skip(true);
        vm.createSelectFork(vm.envString("BSC_RPC_URL"));
        require(block.chainid == BSC_CHAIN_ID, "BNB fork required");
        d = _deploy(
            USDT, Roles(address(this), address(this), GUARDIAN, vm.addr(SIGNER_KEY)), _bscUsdFeed(), _bscStocks()
        );
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
