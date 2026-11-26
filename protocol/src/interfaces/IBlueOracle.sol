// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOracle} from "./IOracle.sol";
import {IRegimeRegistry} from "./IRegimeRegistry.sol";

/// BlueOracle surface used by BlueRouter, keepers and the frontend.
interface IBlueOracle is IOracle {
    function ASSET() external view returns (address);
    function REGISTRY() external view returns (IRegimeRegistry);
    function haircutBps(IRegimeRegistry.Regime r) external view returns (uint16);
    function priceForRegime(IRegimeRegistry.Regime r) external view returns (uint256);
    function isFrozen() external view returns (bool);
    function liveRawPrice() external view returns (bool ok, uint256 rawPrice, uint256 observedAt);
    function update() external returns (uint256);
}
