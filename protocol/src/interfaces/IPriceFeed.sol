// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Chainlink-style round feed. Atlas SingleFeeds for bStocks and the Chainlink USDT/USD feed on BNB Chain
///         both expose this surface. Atlas feeds revert on latestTimestamp() and latestRound(), so Blue reads
///         latestRoundData() only (verified against BNB mainnet on 2026-11-26 and 2026-11-27).
interface IPriceFeed {
    function latestAnswer() external view returns (int256);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}
