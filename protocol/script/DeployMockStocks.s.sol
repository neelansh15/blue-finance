// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MockBStock} from "../src/mocks/MockBStock.sol";

/// @notice Deploys five mock stock tokens, mints 100,000 of each and hands ownership to `owner`, all in one
///         transaction. The batch contract keeps no rights over the tokens afterwards.
/// @dev These are NOT Binance bStocks and have no value. Names and symbols are marked as mocks.
contract MockStockBatch {
    uint256 public constant AMOUNT = 100_000 ether;

    address[5] public tokens;

    constructor(address owner, address recipient) {
        require(owner != address(0) && recipient != address(0), "zero address");
        tokens[0] = _create("Blue Mock Tesla", "mTSLAB", owner, recipient);
        tokens[1] = _create("Blue Mock NVIDIA", "mNVDAB", owner, recipient);
        tokens[2] = _create("Blue Mock Invesco QQQ", "mQQQB", owner, recipient);
        tokens[3] = _create("Blue Mock SpaceX", "mSPCXB", owner, recipient);
        tokens[4] = _create("Blue Mock Alphabet", "mGOOGLB", owner, recipient);
    }

    function _create(string memory name, string memory symbol, address owner, address recipient)
        private
        returns (address)
    {
        MockBStock token = new MockBStock(name, symbol);
        token.mint(recipient, AMOUNT);
        token.transferOwnership(owner);
        return address(token);
    }
}

/// @notice Sends the batch on BNB Chain. The broadcaster owns every token. MOCK_RECIPIENT defaults to the
///         broadcaster. This does not list the tokens in the Blue pool.
contract DeployMockStocks is Script {
    function run() external {
        require(block.chainid == 56, "BNB Chain required");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        address recipient = vm.envOr("MOCK_RECIPIENT", deployer);
        MockStockBatch batch = new MockStockBatch(deployer, recipient);
        vm.stopBroadcast();

        console2.log("Recipient", recipient);
        for (uint256 i; i < 5; ++i) {
            address token = batch.tokens(i);
            console2.log(MockBStock(token).symbol(), token);
        }
    }
}
