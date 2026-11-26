// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {BlueRiskParameters as Risk} from "../src/generated/BlueRiskParameters.sol";
import {BlueRouter} from "../src/BlueRouter.sol";
import {BlueRiskExecutor} from "../src/BlueRiskExecutor.sol";

/// @notice Simulation by default. Governance must separately accept the pending admin transfer.
///         Never reads a private key from a file or prints one; use --account/--ledger/--sender.
contract DeployRiskExecutor is Script {
    function run() external returns (BlueRiskExecutor executor) {
        BlueRouter router = BlueRouter(vm.envAddress("BLUE_ROUTER"));
        address governance = vm.envAddress("GOVERNANCE");
        address guardian = vm.envAddress("GUARDIAN");
        vm.startBroadcast();
        executor = new BlueRiskExecutor(router, governance, guardian, Risk.RELAXATION_DELAY_SECONDS);
        router.transferAdmin(address(executor));
        vm.stopBroadcast();
        console2.log("Risk executor", address(executor));
        console2.log("Governance must call acceptRouterAdmin() on the executor before use.");
    }
}
