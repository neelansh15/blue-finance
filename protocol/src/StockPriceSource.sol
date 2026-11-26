// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAtlasFeed} from "morpho-prototype/interfaces/IAtlasFeed.sol";
import {IBStockLike} from "morpho-prototype/interfaces/IBStockLike.sol";

/// @notice Presents a validated USD price (8 decimals) to Aave. The reporter refreshes it from an Atlas round.
contract StockPriceSource {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PRICE = 1e16;
    uint8 public constant decimals = 8;

    address public immutable admin;
    address public immutable reporter;
    address public immutable guardian;
    IAtlasFeed public immutable feed;
    IBStockLike public immutable stock;
    bool public immutable feedPerDisplayedUnit;
    uint32 public immutable borrowMaxAge;
    uint32 public immutable liquidationMaxAge;
    uint16 public immutable continuityBps;

    uint256 public price;
    uint256 public observedAt;
    uint256 public multiplier;
    bool public suspended;

    error Unauthorized();
    error InvalidConfig();
    error InvalidRound();
    error UnusablePrice();
    error DiscontinuousPrice();

    event PriceAccepted(uint256 price, uint256 observedAt, uint256 multiplier);
    event PriceSuspended();

    constructor(
        address admin_,
        address reporter_,
        address guardian_,
        IAtlasFeed feed_,
        IBStockLike stock_,
        bool feedPerDisplayedUnit_,
        uint32 borrowMaxAge_,
        uint32 liquidationMaxAge_,
        uint16 continuityBps_
    ) {
        if (
            admin_ == address(0) || reporter_ == address(0) || guardian_ == address(0) || address(feed_) == address(0)
                || feed_.decimals() != decimals || borrowMaxAge_ == 0 || borrowMaxAge_ > liquidationMaxAge_
                || continuityBps_ == 0 || continuityBps_ >= BPS
                || (feedPerDisplayedUnit_ && address(stock_) == address(0))
        ) revert InvalidConfig();
        admin = admin_;
        reporter = reporter_;
        guardian = guardian_;
        feed = feed_;
        stock = stock_;
        feedPerDisplayedUnit = feedPerDisplayedUnit_;
        borrowMaxAge = borrowMaxAge_;
        liquidationMaxAge = liquidationMaxAge_;
        continuityBps = continuityBps_;
    }

    function refresh() external {
        if (msg.sender != reporter && msg.sender != admin) revert Unauthorized();
        if (suspended) revert UnusablePrice();
        _accept(false);
    }

    /// @notice Governance accepts a new reference after checking a large gap or a corporate action.
    function acceptReference() external {
        if (msg.sender != admin) revert Unauthorized();
        _accept(true);
        suspended = false;
    }

    function suspend() external {
        if (msg.sender != reporter && msg.sender != guardian && msg.sender != admin) revert Unauthorized();
        suspended = true;
        emit PriceSuspended();
    }

    /// @dev Aave's oracle expects a positive latestAnswer and bubbles up a source revert.
    function latestAnswer() external view returns (int256) {
        if (!_usable(liquidationMaxAge)) revert UnusablePrice();
        (uint256 current, uint256 updatedAt) = _livePrice();
        if (updatedAt >= observedAt && current != 0 && _discontinuous(current)) revert UnusablePrice();
        return int256(price);
    }

    function usableForBorrow() external view returns (bool) {
        if (!_usable(borrowMaxAge)) return false;
        (uint256 current, uint256 updatedAt) = _livePrice();
        return updatedAt == observedAt && current == price;
    }

    function _accept(bool newReference) private {
        (uint256 normalized, uint256 updatedAt) = _livePrice();
        if (normalized == 0 || updatedAt <= observedAt || block.timestamp - updatedAt > borrowMaxAge) {
            revert InvalidRound();
        }
        if (!newReference && price != 0 && _discontinuous(normalized)) revert DiscontinuousPrice();
        price = normalized;
        observedAt = updatedAt;
        multiplier = _multiplier();
        emit PriceAccepted(normalized, updatedAt, multiplier);
    }

    function _livePrice() private view returns (uint256 normalized, uint256 updatedAt) {
        try feed.latestRoundData() returns (uint80 id, int256 answer, uint256, uint256 stamp, uint80 answered) {
            if (answer <= 0 || uint256(answer) > MAX_PRICE || stamp == 0 || stamp > block.timestamp || answered < id) {
                return (0, 0);
            }
            normalized = uint256(answer);
            if (feedPerDisplayedUnit) normalized = normalized * _multiplier() / 1e18;
            if (normalized == 0 || normalized > MAX_PRICE) return (0, 0);
            return (normalized, stamp);
        } catch {
            return (0, 0);
        }
    }

    function _discontinuous(uint256 current) private view returns (bool) {
        uint256 difference = current > price ? current - price : price - current;
        return difference * BPS > price * continuityBps;
    }

    function _usable(uint256 maxAge) private view returns (bool) {
        if (suspended || price == 0 || block.timestamp - observedAt > maxAge) return false;
        return _multiplier() == multiplier;
    }

    function _multiplier() private view returns (uint256 current) {
        if (address(stock) == address(0)) return 1e18;
        current = stock.uiMultiplier();
        if (current < 1e9 || current > 1e27) revert UnusablePrice();
    }
}
