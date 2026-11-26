// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AproCrossCheck} from "../script/AproCrossCheck.sol";

interface IAccessControlled {
    function accessController() external view returns (address);
}

interface IAccessController {
    function hasAccess(address user, bytes calldata data) external view returns (bool);
}

/// @notice The optional APRO cross-check against live APRO and Atlas feeds in a local BNB mainnet fork.
/// @dev Run with BLUE_RUN_BNB_FORK_TESTS=true and BSC_RPC_URL set to a BNB mainnet RPC.
contract AproCrossCheckForkTest is Test, AproCrossCheck {
    Deployment private d;

    function setUp() external {
        if (!vm.envOr("BLUE_RUN_BNB_FORK_TESTS", false)) vm.skip(true);
        vm.createSelectFork(vm.envString("BSC_RPC_URL"));
        require(block.chainid == BSC_CHAIN_ID, "BNB fork required");
        d = _deploy(
            USDT,
            Roles(address(this), address(this), address(0x123), address(this)),
            _bscUsdFeed(),
            _bscStocksWithApro()
        );
    }

    /// @dev Live data. Venus measured a median Atlas vs APRO difference of 7 to 18 basis points.
    function testAproAgreesWithAtlasOnceWhitelisted() external {
        _simulateWhitelisting();
        for (uint256 i; i < d.stockPrices.length; ++i) {
            (bool available,, uint256 deviation) = d.stockPrices[i].crossCheck();
            if (i == 4) {
                assertEq(address(d.stockPrices[i].crossCheckFeed()), address(0)); // GOOGLB
                assertFalse(available);
            } else {
                assertTrue(available);
                assertLt(deviation, 200);
            }
        }
    }

    function testAproDeniesUnlistedContracts() external view {
        for (uint256 i; i < 4; ++i) {
            (bool available,,) = d.stockPrices[i].crossCheck();
            assertFalse(available);
            assertFalse(d.stockPrices[i].usableForBorrow());
            assertGt(d.oracle.getAssetPrice(_bscStocks()[i].token), 0); // Valuation still uses Atlas.
        }
    }

    /// @dev APRO feeds only answer whitelisted contracts. Simulate APRO adding Blue's price sources.
    function _simulateWhitelisting() private {
        for (uint256 i; i < d.stockPrices.length; ++i) {
            address feed = address(d.stockPrices[i].crossCheckFeed());
            if (feed == address(0)) continue;
            vm.mockCall(
                IAccessControlled(feed).accessController(),
                abi.encodeWithSelector(IAccessController.hasAccess.selector, address(d.stockPrices[i])),
                abi.encode(true)
            );
        }
    }
}
