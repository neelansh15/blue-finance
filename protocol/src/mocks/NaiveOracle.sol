// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IOracle} from "../interfaces/IOracle.sol";
import {IAtlasFeed} from "../interfaces/IAtlasFeed.sol";

/// @title NaiveOracle
/// @notice TEST/DEMO ONLY. The "what goes wrong without Blue" baseline for scenario 3: it passes the feed answer
///         straight through as the price of one raw collateral token, with no multiplier handling, no haircut,
///         no staleness check and no freeze. After a 2-for-1 split the per-UI-share feed halves while each raw
///         token is still worth the same, so this oracle halves the collateral value. Never use it for a market.
contract NaiveOracle is IOracle {
    IAtlasFeed public immutable FEED;
    uint256 public immutable SCALE; // 10^(36 + loanDec - collDec - feedDec)

    constructor(address feed, uint8 loanDecimals, uint8 collateralDecimals, uint8 feedDecimals) {
        FEED = IAtlasFeed(feed);
        SCALE = 10 ** (36 + uint256(loanDecimals) - uint256(collateralDecimals) - uint256(feedDecimals));
    }

    function price() external view returns (uint256) {
        return uint256(FEED.latestAnswer()) * SCALE;
    }
}
