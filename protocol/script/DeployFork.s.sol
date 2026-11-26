// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {BlueV3Deployment} from "./BlueV3Deployment.sol";

contract DeployFork is Script, BlueV3Deployment {
    using SafeERC20 for IERC20;

    address internal constant BNB_USDT = 0x55d398326f99059fF775485246999027B3197955;

    function run() external {
        require(block.chainid == 56 && BNB_USDT.code.length != 0, "BNB fork required");
        // The RPC must provide Anvil's node-info method. This script is for local deployments.
        vm.rpc("anvil_nodeInfo", "[]");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        Roles memory roles = Roles({
            admin: deployer,
            keeper: vm.envOr("BLUE_KEEPER", deployer),
            guardian: vm.envAddress("BLUE_GUARDIAN"),
            signer: vm.envOr("BLUE_SIGNER", deployer)
        });
        require(roles.guardian != deployer, "separate guardian required");
        Deployment memory d = _deploy(BNB_USDT, roles);
        uint256 seed = vm.envOr("BLUE_SEED_USDT", uint256(0));
        if (seed != 0) {
            IERC20(BNB_USDT).forceApprove(address(d.pool), seed);
            d.pool.supply(BNB_USDT, seed, deployer, 0);
        }
        vm.stopBroadcast();

        console2.log("Pool", address(d.pool));
        console2.log("Addresses provider", address(d.provider));
        console2.log("Configurator", address(d.configurator));
        console2.log("Borrow controls", address(d.controls));
        console2.log("Market calendar", address(d.calendar));
        console2.log("Oracle", address(d.oracle));
        console2.log("USDT", BNB_USDT);
        console2.log("USDT feed", address(d.usdtFeed));
        console2.log("USDT price source", address(d.usdtPrice));
        for (uint256 i; i < STOCK_COUNT; ++i) {
            Stock memory stock = d.stocks[i];
            string memory symbol = stock.token.symbol();
            console2.log(symbol, address(stock.token));
            console2.log(string.concat(symbol, " feed"), address(stock.feed));
            console2.log(string.concat(symbol, " price source"), address(stock.source));
        }
    }
}
