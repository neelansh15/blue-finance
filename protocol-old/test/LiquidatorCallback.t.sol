// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LiquidatorCallback} from "../src/LiquidatorCallback.sol";
import {MockBStock} from "../src/mocks/MockBStock.sol";
import {IMorpho, MarketParams} from "../src/interfaces/IMorpho.sol";

interface IERC20T {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

/// Behaves like Morpho's liquidate: collateral out, callback, loan token in. 1:1 repay for simplicity.
contract FakeMorpho {
    function liquidate(MarketParams memory p, address, uint256 seized, uint256 repaidShares, bytes memory data)
        external
        returns (uint256, uint256)
    {
        uint256 repaid = repaidShares == 0 ? seized : repaidShares;
        IERC20T(p.collateralToken).transfer(msg.sender, seized == 0 ? repaidShares : seized);
        LiquidatorCallback(msg.sender).onMorphoLiquidate(repaid, data);
        IERC20T(p.loanToken).transferFrom(msg.sender, address(this), repaid);
        return (seized, repaid);
    }
}

/// Swapper: takes all collateral approved to it and pays loan token 1:1.
contract FakeSwapper {
    function swap(address col, address loan, address from, uint256 amt) external {
        IERC20T(col).transferFrom(from, address(this), amt);
        IERC20T(loan).transfer(from, amt);
    }
}

contract LiquidatorCallbackTest is Test {
    MockBStock col;
    MockBStock loan;
    FakeMorpho morpho;
    LiquidatorCallback liq;
    FakeSwapper swapper;
    MarketParams params;
    address owner = address(0xA11CE);

    function setUp() public {
        col = new MockBStock("Col", "COL");
        loan = new MockBStock("Loan", "LOAN");
        morpho = new FakeMorpho();
        liq = new LiquidatorCallback(IMorpho(address(morpho)), owner);
        swapper = new FakeSwapper();
        params = MarketParams(address(loan), address(col), address(0), address(0), 0.625e18);
        col.mint(address(morpho), 1000e18);
    }

    function test_PreFundedLiquidation() public {
        loan.mint(address(liq), 100e18);
        vm.prank(owner);
        (uint256 s, uint256 r) = liq.liquidate(params, address(1), 40e18, 0, address(0), "");
        assertEq(s, 40e18);
        assertEq(r, 40e18);
        assertEq(col.balanceOf(address(liq)), 40e18);
        assertEq(loan.balanceOf(address(morpho)), 40e18);
        vm.prank(owner);
        liq.sweep(address(col), owner);
        assertEq(col.balanceOf(owner), 40e18);
    }

    function test_SwapLiquidation() public {
        loan.mint(address(swapper), 100e18);
        bytes memory sd = abi.encodeCall(FakeSwapper.swap, (address(col), address(loan), address(liq), 40e18));
        vm.prank(owner);
        liq.liquidate(params, address(1), 40e18, 0, address(swapper), sd);
        assertEq(loan.balanceOf(address(morpho)), 40e18);
        assertEq(col.balanceOf(address(swapper)), 40e18);
    }

    function test_RevertsWhenRepayNotCovered() public {
        loan.mint(address(liq), 10e18);
        vm.prank(owner);
        vm.expectRevert(LiquidatorCallback.InsufficientLoanToken.selector);
        liq.liquidate(params, address(1), 40e18, 0, address(0), "");
    }

    function test_OnlyOwnerAndOnlyMorpho() public {
        vm.expectRevert(LiquidatorCallback.Unauthorized.selector);
        liq.liquidate(params, address(1), 1, 0, address(0), "");
        vm.expectRevert(LiquidatorCallback.Unauthorized.selector);
        liq.onMorphoLiquidate(1, "");
        vm.expectRevert(LiquidatorCallback.Unauthorized.selector);
        liq.sweep(address(col), address(this));
        // Morpho calling outside a liquidation started by the owner is rejected
        vm.prank(address(morpho));
        vm.expectRevert(LiquidatorCallback.NotInLiquidation.selector);
        liq.onMorphoLiquidate(1, abi.encode(address(col), address(0), bytes("")));
    }
}
