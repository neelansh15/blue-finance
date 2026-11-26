// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAtlasFeed} from "./interfaces/IAtlasFeed.sol";
import {IBStockLike} from "./interfaces/IBStockLike.sol";
import {IMarketCalendar} from "./interfaces/IMarketCalendar.sol";

/// @notice Presents a validated USD price (8 decimals) to Aave.
/// @dev Two standards apply, following Zona Lend:
///      - Valuation (`latestAnswer`, used for health and liquidation) reads the live Atlas round. It needs a
///        complete round within `liquidationMaxAge`, a price inside the absolute band, the multiplier that the
///        last accepted price used, and no corporate action in progress. Large moves are accepted, so a real
///        gap reaches liquidators without waiting for review.
///      - New borrowing (`usableForBorrow`) also needs the reporter to have accepted the live round within
///        `borrowMaxAge`. Acceptance rejects a move larger than `continuityBps` from the last accepted price,
///        so a gap or an unannounced split stops new loans until the admin accepts a new reference.
contract StockPriceSource {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PRICE = 1e16;
    uint8 public constant decimals = 8;

    address public immutable admin;
    address public immutable reporter;
    address public immutable guardian;
    IAtlasFeed public immutable feed;
    IBStockLike public immutable stock;
    IMarketCalendar public immutable calendar;
    bool public immutable feedPerDisplayedUnit;
    uint32 public immutable borrowMaxAge;
    uint32 public immutable liquidationMaxAge;
    uint16 public immutable continuityBps;

    uint256 public price;
    uint256 public observedAt;
    uint256 public multiplier;
    uint256 public minPrice;
    uint256 public maxPrice;
    bool public suspended;

    error Unauthorized();
    error InvalidConfig();
    error InvalidRound();
    error UnusablePrice();
    error DiscontinuousPrice();

    event PriceAccepted(uint256 price, uint256 observedAt, uint256 multiplier);
    event PriceSuspended();
    event BandSet(uint256 minPrice, uint256 maxPrice);

    struct Config {
        address admin;
        address reporter;
        address guardian;
        IAtlasFeed feed;
        IBStockLike stock;
        IMarketCalendar calendar;
        bool feedPerDisplayedUnit;
        uint32 borrowMaxAge;
        uint32 liquidationMaxAge;
        uint16 continuityBps;
        uint256 minPrice;
        uint256 maxPrice;
    }

    constructor(Config memory c) {
        if (
            c.admin == address(0) || c.reporter == address(0) || c.guardian == address(0)
                || address(c.feed) == address(0) || address(c.calendar) == address(0) || c.feed.decimals() != decimals
                || c.borrowMaxAge == 0 || c.borrowMaxAge > c.liquidationMaxAge || c.continuityBps == 0
                || c.continuityBps >= BPS || (c.feedPerDisplayedUnit && address(c.stock) == address(0))
        ) revert InvalidConfig();
        admin = c.admin;
        reporter = c.reporter;
        guardian = c.guardian;
        feed = c.feed;
        stock = c.stock;
        calendar = c.calendar;
        feedPerDisplayedUnit = c.feedPerDisplayedUnit;
        borrowMaxAge = c.borrowMaxAge;
        liquidationMaxAge = c.liquidationMaxAge;
        continuityBps = c.continuityBps;
        _setBand(c.minPrice, c.maxPrice);
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

    /// @notice Sets the absolute range outside which a round is treated as invalid.
    function setBand(uint256 minPrice_, uint256 maxPrice_) external {
        if (msg.sender != admin) revert Unauthorized();
        _setBand(minPrice_, maxPrice_);
    }

    /// @dev Aave's oracle expects a positive latestAnswer and bubbles up a source revert, which stops
    ///      liquidation for accounts using this asset until the price is valid again.
    function latestAnswer() external view returns (int256) {
        if (!_valuationUsable()) revert UnusablePrice();
        (uint256 current, uint256 updatedAt) = _livePrice();
        if (current == 0 || block.timestamp - updatedAt > liquidationMaxAge) revert UnusablePrice();
        return int256(current);
    }

    function usableForBorrow() external view returns (bool) {
        if (!_valuationUsable() || block.timestamp - observedAt > borrowMaxAge) return false;
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

    function _setBand(uint256 minPrice_, uint256 maxPrice_) private {
        if (minPrice_ == 0 || minPrice_ >= maxPrice_ || maxPrice_ > MAX_PRICE) revert InvalidConfig();
        minPrice = minPrice_;
        maxPrice = maxPrice_;
        emit BandSet(minPrice_, maxPrice_);
    }

    /// @dev A changed multiplier means a corporate action took effect after the last accepted price. The admin
    ///      must accept a round that reflects it before the price is used again.
    function _valuationUsable() private view returns (bool) {
        if (suspended || price == 0 || _multiplier() != multiplier) return false;
        return
            address(stock) == address(0) || calendar.status(address(stock)) != IMarketCalendar.MarketStatus.CORP_ACTION;
    }

    function _livePrice() private view returns (uint256 normalized, uint256 updatedAt) {
        try feed.latestRoundData() returns (uint80 id, int256 answer, uint256, uint256 stamp, uint80 answered) {
            if (answer <= 0 || uint256(answer) > MAX_PRICE || stamp == 0 || stamp > block.timestamp || answered < id) {
                return (0, 0);
            }
            normalized = uint256(answer);
            if (feedPerDisplayedUnit) normalized = normalized * _multiplier() / 1e18;
            if (normalized < minPrice || normalized > maxPrice) return (0, 0);
            return (normalized, stamp);
        } catch {
            return (0, 0);
        }
    }

    function _discontinuous(uint256 current) private view returns (bool) {
        uint256 difference = current > price ? current - price : price - current;
        return difference * BPS > price * continuityBps;
    }

    function _multiplier() private view returns (uint256 current) {
        if (address(stock) == address(0)) return 1e18;
        current = stock.uiMultiplier();
        if (current < 1e9 || current > 1e27) revert UnusablePrice();
    }
}
