// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";

/// @notice Deploys mock USDT on BNB Chain and mints 100,000 in one transaction. The broadcaster owns the token.
///         MOCK_RECIPIENT defaults to the broadcaster.
contract DeployMockUsdt is Script {
    function run() external {
        require(block.chainid == 56, "BNB Chain required");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        address recipient = vm.envOr("MOCK_RECIPIENT", deployer);
        MockUSDT token = new MockUSDT(deployer, recipient, 100_000 ether);
        vm.stopBroadcast();

        console2.log("mUSDT", address(token));
        console2.log("Recipient", recipient);
    }
}
