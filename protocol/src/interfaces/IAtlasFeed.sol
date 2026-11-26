// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Atlas SingleFeed subset used by Dawn (see INTERFACES.md). Verified against the real BSC feeds on 2026-11-26:
/// decimals(), latestAnswer() and latestRoundData() exist; latestTimestamp() and latestRound() REVERT, so Dawn
/// reads latestRoundData() only (through DawnOracle._readFeed).
interface IAtlasFeed {
    function latestAnswer() external view returns (int256);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}
