// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Chainlink AggregatorV2/V3-compatible subset used by Dawn (see INTERFACES.md).
/// Atlas SingleFeed is documented as AggregatorV2V3-compatible; units and read access are unverified.
interface IAtlasFeed {
    function latestAnswer() external view returns (int256);
    function latestTimestamp() external view returns (uint256);
    function decimals() external view returns (uint8);
}
