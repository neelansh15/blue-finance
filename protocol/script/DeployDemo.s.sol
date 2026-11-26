// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {BscMainnet} from "./BscMainnet.sol";

/// @notice Deploys a second, separate Blue pool on BNB Chain that uses our mock USDT and mock stocks.
/// @dev The live pool is not touched. Prices come from the same feeds as the live pool. A throwaway key
///      (DEMO_DEPLOYER_KEY) sends every transaction and hands all admin rights to ADMIN, which must then call
///      acceptAdmin() on the new market calendar. ADMIN is fixed here because the Aave roles move in one step.
contract DeployDemo is Script, BscMainnet {
    address internal constant ADMIN = 0xf475D99Be3241c69454eA8AF7B12F38078F697bc;
    /// @dev Keeper and guardian of the live pool too.
    address internal constant OPERATOR = 0x68c09dcC4d11D7974BA3E8e96D69CED9C31e733A;

    address internal constant MOCK_USDT = 0x7698257D4200A2d3E6A47Ce3BBffEb3aEe0445f9;

    function run() external {
        require(block.chainid == BSC_CHAIN_ID && MOCK_USDT.code.length != 0, "BNB Chain required");

        StockListing[] memory stocks = _bscStocks();
        stocks[0].token = 0xA75f781454764A3E50B9381f7e4A68e617D2a1c8;
        stocks[1].token = 0xCfA61BEb931eF2E20e7a017C47f1c494a2556e89;
        stocks[2].token = 0xA93364Cf343495846fC2a89D54f90452FEfD5b91;
        stocks[3].token = 0x1871c0511AC66Ee8D153932A620cCCb9AB6E69F8;
        stocks[4].token = 0x6Dd6fd3f283233aF264aa3958F7Fef2b0d8ef09B;

        uint256 key = vm.envUint("DEMO_DEPLOYER_KEY");
        address deployer = vm.addr(key);

        vm.startBroadcast(key);
        Deployment memory d =
            _deploy(MOCK_USDT, Roles(deployer, OPERATOR, OPERATOR, ADMIN, ADMIN), _bscUsdFeed(), stocks);
        _seedHolidays(d.calendar);
        _handOver(d, deployer, ADMIN);
        vm.stopBroadcast();

        string memory out = "demo";
        vm.serializeUint(out, "chainId", block.chainid);
        vm.serializeAddress(out, "pool", address(d.pool));
        vm.serializeAddress(out, "provider", address(d.provider));
        vm.serializeAddress(out, "dataProvider", d.provider.getPoolDataProvider());
        vm.serializeAddress(out, "controls", address(d.controls));
        vm.serializeAddress(out, "calendar", address(d.calendar));
        vm.serializeAddress(out, "oracle", address(d.oracle));
        vm.serializeAddress(out, "usdt", MOCK_USDT);
        vm.serializeAddress(out, "usdtSource", address(d.usdtPrice));

        string[5] memory ids = ["TSLAB", "NVDAB", "QQQB", "SPCXB", "GOOGLB"];
        string memory list = "stocks";
        string memory listed;
        for (uint256 i; i < stocks.length; ++i) {
            address[] memory pair = new address[](2);
            pair[0] = stocks[i].token;
            pair[1] = address(d.stockPrices[i]);
            listed = vm.serializeAddress(list, ids[i], pair);
        }
        vm.writeJson(vm.serializeString(out, "stocks", listed), "./deployments/bsc-demo.json");
        console2.log("Demo pool", address(d.pool));
    }
}
