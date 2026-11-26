// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Id} from "../src/interfaces/IMorpho.sol";
import {DawnDeploy} from "./DawnDeploy.sol";

/// @title DeployMainnet
/// @notice BNB Chain mainnet (chain id 56) deployment of one Dawn market on a REAL bStock and its REAL Atlas feed,
///         using the same DawnDeploy helpers as script/Deploy.s.sol. Deploys RegimeRegistry, DawnOracle (per raw
///         token feed, 2h live staleness) and DawnRouter, creates the bStock/USDT market on Morpho Blue
///         (62.5% LLTV, AdaptiveCurveIrm) and lists it with LOW placeholder caps. No mocks, no demo signer, no seed.
///
/// Required env: ATLAS_FEED, BSTOCK, ELIGIBILITY_SIGNER, GUARDIAN (must differ from the deployer; it can pause and
///               can only LOWER caps via router.lowerCaps).
/// Optional env: KEEPER (registry keeper, default: deployer), SEED_SUPPLY (USDT, 18 dec, default 0).
///
/// Key handling: the key is NEVER read from a file and never logged. Use one of
///   forge script script/DeployMainnet.s.sol --rpc-url $BSC_RPC_URL --account <keystore name> --sender <addr>
///   forge script script/DeployMainnet.s.sol --rpc-url $BSC_RPC_URL --ledger --sender <addr>
///   PRIVATE_KEY=<hex> forge script ...   (supplied at run time only, e.g. from a prompt, not stored)
/// Without --broadcast this is a dry run (simulation only).
///
/// ALL RISK PARAMETERS ARE UNCALIBRATED PLACEHOLDERS. Caps are deliberately tiny; raise them only through
/// router.setCaps (admin) after review.
contract DeployMainnet is Script, DawnDeploy {
    using stdJson for string;

    // Total borrow cap and per-regime caps on market totalBorrowAssets (USDT, 18 decimals).
    // Index = Regime: OPEN, EXTENDED, CLOSED, WEEKEND, HALTED, CORP_ACTION.
    uint256 internal constant CAP_TOTAL = 1_000e18;
    uint256 internal constant CAP_OPEN = 1_000e18;
    uint256 internal constant CAP_EXTENDED = 500e18;
    uint256 internal constant CAP_CLOSED = 250e18;
    uint256 internal constant CAP_WEEKEND = 250e18;

    function _totalCap() internal pure override returns (uint256) {
        return CAP_TOTAL;
    }

    function _regimeCaps() internal pure override returns (uint256[6] memory) {
        return [CAP_OPEN, CAP_EXTENDED, CAP_CLOSED, CAP_WEEKEND, 0, 0];
    }

    function run() external returns (Deployment memory d) {
        require(block.chainid == 56, "DeployMainnet: chainid != 56");

        realAtlasFeed = vm.envAddress("ATLAS_FEED");
        realBStock = vm.envAddress("BSTOCK");
        address signer = vm.envAddress("ELIGIBILITY_SIGNER");
        address guardian = vm.envAddress("GUARDIAN");
        require(realAtlasFeed.code.length != 0, "ATLAS_FEED has no code");
        require(realBStock.code.length != 0, "BSTOCK has no code");
        require(signer != address(0) && guardian != address(0), "signer/guardian required");

        // Key comes from --account / --ledger / --private-keys, or PRIVATE_KEY at run time. Never printed.
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        require(deployer != guardian, "guardian must differ from deployer/admin");

        DeployParams memory p = DeployParams({
            deployer: deployer,
            keeper: vm.envOr("KEEPER", deployer),
            signer: signer,
            guardian: guardian,
            seedSupply: vm.envOr("SEED_SUPPLY", uint256(0)),
            initialPrice: 0 // unused with a real feed
        });
        d = _deployDawn(p);
        vm.stopBroadcast();

        // Post-conditions (simulated before broadcast, checked again in the dry run).
        require(d.router.admin() == deployer && d.router.guardian() == guardian, "roles");
        require(d.router.marketConfig(d.marketId).totalCap == CAP_TOTAL, "cap");
        require(address(d.feed) == address(0), "mock feed deployed");

        console2.log("RegimeRegistry", address(d.registry));
        console2.log("DawnOracle    ", address(d.oracle));
        console2.log("DawnRouter    ", address(d.router));
        console2.log("MarketId");
        console2.logBytes32(Id.unwrap(d.marketId));
        console2.log("admin (deployer)", deployer);
        console2.log("guardian", guardian);
        console2.log("signer", signer);
        console2.log("keeper", p.keeper);
        console2.log("Low placeholder caps set; seed holidays/early closes are in the registry, see README.");
    }
}
