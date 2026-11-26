// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {BscMainnet} from "./BscMainnet.sol";

/// @notice Deploys Blue with the real bStocks, Atlas feeds and USDT on BNB Chain.
/// @dev Runs against a local Anvil fork by default. A mainnet broadcast also needs BLUE_ALLOW_MAINNET=true and
///      explicit owner approval. Roles must be set explicitly: BLUE_ADMIN, BLUE_KEEPER, BLUE_GUARDIAN and
///      BLUE_SIGNER. BLUE_ADMIN is the deployer or a contract; a contract admin must then call acceptAdmin() on the
///      market calendar. BLUE_SEED_USDT (raw 18-decimal units) optionally supplies USDT from the deployer.
contract DeployBsc is Script, BscMainnet {
    using SafeERC20 for IERC20;

    function run() external {
        require(block.chainid == BSC_CHAIN_ID && USDT.code.length != 0, "BNB Chain required");
        if (!vm.envOr("BLUE_ALLOW_MAINNET", false)) {
            // Anvil answers this method; a mainnet RPC does not.
            vm.rpc("anvil_nodeInfo", "[]");
        }

        address admin = vm.envAddress("BLUE_ADMIN");
        address keeper = vm.envAddress("BLUE_KEEPER");
        address guardian = vm.envAddress("BLUE_GUARDIAN");
        address signer = vm.envAddress("BLUE_SIGNER");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        Deployment memory d = _launchBsc(deployer, admin, keeper, guardian, signer);
        uint256 seed = vm.envOr("BLUE_SEED_USDT", uint256(0));
        if (seed != 0) {
            IERC20(USDT).forceApprove(address(d.pool), seed);
            d.pool.supply(USDT, seed, deployer, 0);
        }
        vm.stopBroadcast();

        console2.log("Pool", address(d.pool));
        console2.log("Addresses provider", address(d.provider));
        console2.log("Configurator", address(d.configurator));
        console2.log("Borrow controls", address(d.controls));
        console2.log("Market calendar", address(d.calendar));
        console2.log("Oracle", address(d.oracle));
        console2.log("USDT price source", address(d.usdtPrice));
        console2.log("Admin", admin);
        StockListing[] memory stocks = _bscStocks();
        for (uint256 i; i < stocks.length; ++i) {
            console2.log(
                string.concat(IERC20Metadata(stocks[i].token).symbol(), " price source"), address(d.stockPrices[i])
            );
        }
        if (admin != deployer) {
            console2.log("ACTION REQUIRED: the admin must call acceptAdmin() on the market calendar.");
            console2.log("Until then the deployer still administers the calendar, borrow controls and price sources.");
        }
    }
}
