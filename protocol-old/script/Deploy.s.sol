// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";
import {Id} from "../src/interfaces/IMorpho.sol";
import {BlueDeploy} from "./BlueDeploy.sol";

interface IERC20Bal {
    function balanceOf(address) external view returns (uint256);
}

/// @title Deploy
/// @notice Deploys RegimeRegistry, MockBStock, MockAtlasFeed, BlueOracle and BlueRouter, creates the bStock/USDT
///         Morpho market (62.5% LLTV, AdaptiveCurveIrm), lists it on the router, seeds supply and writes
///         deployments/<chainid>.json. Intended for a BNB Chain fork (anvil --fork-url). Not for mainnet as is:
///         the collateral and feed are mocks and the eligibility signer defaults to a public demo key.
///
/// Env (all optional):
///   PRIVATE_KEY            deployer key (default: anvil account 0, a public test key)
///   KEEPER                 registry keeper (default: deployer)
///   GUARDIAN               router guardian (default: none)
///   ELIGIBILITY_SIGNER     signer address (default: address of the public DEMO_SIGNER_KEY)
///   SEED_SUPPLY            USDT (18 dec) to supply (default 100,000e18; skipped if the deployer has less)
///   INITIAL_PRICE          feed answer, 8 decimals (default 200e8)
///   ATLAS_FEED             real Atlas feed address (e.g. TSLAB/USD 0xf569C3e52e797219eCFDc1659c3250B0BbDC693C);
///                          default: deploy MockAtlasFeed. Configures the oracle per raw token, 2h live staleness
///   BSTOCK                 real bStock token address (optional, pair with ATLAS_FEED); default: MockBStock
///   ANVIL_FUND_USDT=true   on an anvil fork, write the deployer's USDT balance via anvil_setStorageAt first
///
/// Usage:
///   anvil --fork-url https://bsc-dataseed.binance.org
///   ANVIL_FUND_USDT=true forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
contract Deploy is Script, BlueDeploy {
    using stdJson for string;
    using stdStorage for StdStorage;

    uint256 internal constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external returns (Deployment memory d) {
        uint256 pk = vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
        address deployer = vm.addr(pk);
        uint256 seed = vm.envOr("SEED_SUPPLY", uint256(100_000e18));

        if (vm.envOr("ANVIL_FUND_USDT", false)) _anvilFundUsdt(deployer, seed);
        if (IERC20Bal(USDT).balanceOf(deployer) < seed) {
            console2.log("Deployer USDT below SEED_SUPPLY, skipping seed supply");
            seed = 0;
        }

        DeployParams memory p = DeployParams({
            deployer: deployer,
            keeper: vm.envOr("KEEPER", deployer),
            signer: vm.envOr("ELIGIBILITY_SIGNER", vm.addr(DEMO_SIGNER_KEY)),
            guardian: vm.envOr("GUARDIAN", address(0)),
            seedSupply: seed,
            initialPrice: int256(vm.envOr("INITIAL_PRICE", uint256(200e8)))
        });

        realAtlasFeed = vm.envOr("ATLAS_FEED", address(0));
        realBStock = vm.envOr("BSTOCK", address(0));

        vm.startBroadcast(pk);
        d = _deployBlue(p);
        vm.stopBroadcast();

        _write(d, p);
    }

    /// Sets the deployer's USDT balance on an anvil node (and in the local simulation) so seeding works on a fork.
    function _anvilFundUsdt(address who, uint256 amount) internal {
        uint256 slot = stdstore.target(USDT).sig("balanceOf(address)").with_key(who).find();
        bytes32 value = bytes32(amount);
        vm.store(USDT, bytes32(slot), value);
        string memory params = string.concat(
            "[\"", vm.toString(USDT), "\",\"", vm.toString(bytes32(slot)), "\",\"", vm.toString(value), "\"]"
        );
        vm.rpc("anvil_setStorageAt", params);
    }

    function _write(Deployment memory d, DeployParams memory p) internal {
        string memory k = "blue";
        k.serialize("chainId", block.chainid);
        k.serialize("morpho", MORPHO);
        k.serialize("irm", IRM);
        k.serialize("usdt", USDT);
        k.serialize("lltv", LLTV);
        k.serialize("regimeRegistry", address(d.registry));
        k.serialize("mockAtlasFeed", address(d.feed));
        k.serialize("mockBStock", address(d.bStock));
        k.serialize("blueOracle", address(d.oracle));
        k.serialize("blueRouter", address(d.router));
        k.serialize("marketId", Id.unwrap(d.marketId));
        k.serialize("keeper", p.keeper);
        k.serialize("eligibilitySigner", p.signer);
        k.serialize("admin", p.deployer);
        k.serialize("seedSupply", p.seedSupply);
        string memory json = k.serialize("placeholderParams", true);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("Wrote", path);
    }
}
