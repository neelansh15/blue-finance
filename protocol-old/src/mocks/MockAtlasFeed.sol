// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAtlasFeed} from "../interfaces/IAtlasFeed.sol";

/// @title MockAtlasFeed
/// @notice Chainlink/Atlas-style feed for tests and the demo. Owner-controlled.
///         Can be switched to revert on every read to simulate a whitelist removal or outage.
contract MockAtlasFeed is IAtlasFeed {
    address public owner;
    uint8 public immutable decimals;
    int256 internal _answer;
    uint256 internal _timestamp;
    uint80 internal _roundId;
    bool public reverting;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    error Unauthorized();
    error FeedReverted();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(uint8 decimals_, int256 initialAnswer) {
        owner = msg.sender;
        decimals = decimals_;
        _set(initialAnswer, block.timestamp);
    }

    // ---- Atlas / Chainlink reads

    function latestAnswer() external view returns (int256) {
        if (reverting) revert FeedReverted();
        return _answer;
    }

    function latestTimestamp() external view returns (uint256) {
        if (reverting) revert FeedReverted();
        return _timestamp;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        if (reverting) revert FeedReverted();
        return (_roundId, _answer, _timestamp, _timestamp, _roundId);
    }

    // ---- controls

    function setAnswer(int256 answer) external onlyOwner {
        _set(answer, block.timestamp);
    }

    function setAnswerAt(int256 answer, uint256 timestamp) external onlyOwner {
        _set(answer, timestamp);
    }

    function setReverting(bool on) external onlyOwner {
        reverting = on;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function _set(int256 answer, uint256 timestamp) internal {
        _answer = answer;
        _timestamp = timestamp;
        _roundId++;
        emit AnswerUpdated(answer, _roundId, timestamp);
    }
}
