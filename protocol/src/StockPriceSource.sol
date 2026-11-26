// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPriceFeed} from "./interfaces/IPriceFeed.sol";
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
///      - Optionally, a second feed in the same units cross-checks new borrowing: it must be fresh and agree
///        with the primary price within a tolerance for the stock's market status. It is off when the feed is
///        zero. The cross-check never affects valuation or liquidation.
contract StockPriceSource {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PRICE = 1e16;
    uint8 public constant decimals = 8;

    address public reporter;
    address public guardian;
    IPriceFeed public immutable feed;
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

    /// @notice Secondary feed in the same units as the primary feed, or zero for no cross-check.
    IPriceFeed public crossCheckFeed;
    uint32 public crossCheckMaxAge;
    /// @notice Largest allowed difference from the cross-check, in basis points, per MarketStatus OPEN..WEEKEND.
    uint16[4] public crossCheckBps;

    error Unauthorized();
    error InvalidConfig();
    error InvalidRound();
    error UnusablePrice();
    error DiscontinuousPrice();

    event PriceAccepted(uint256 price, uint256 observedAt, uint256 multiplier);
    event PriceSuspended();
    event RolesSet(address reporter, address guardian);
    event BandSet(uint256 minPrice, uint256 maxPrice);
    event CrossCheckSet(address feed, uint32 maxAge, uint16[4] toleranceBps);

    struct Config {
        address reporter;
        address guardian;
        IPriceFeed feed;
        IBStockLike stock;
        IMarketCalendar calendar;
        bool feedPerDisplayedUnit;
        uint32 borrowMaxAge;
        uint32 liquidationMaxAge;
        uint16 continuityBps;
        uint256 minPrice;
        uint256 maxPrice;
        IPriceFeed crossCheckFeed;
        uint32 crossCheckMaxAge;
        uint16[4] crossCheckBps;
    }

    constructor(Config memory c) {
        if (
            address(c.feed) == address(0) || address(c.calendar) == address(0) || c.feed.decimals() != decimals
                || c.borrowMaxAge == 0 || c.borrowMaxAge > c.liquidationMaxAge || c.continuityBps == 0
                || c.continuityBps >= BPS || (c.feedPerDisplayedUnit && address(c.stock) == address(0))
        ) revert InvalidConfig();
        _setRoles(c.reporter, c.guardian);
        feed = c.feed;
        stock = c.stock;
        calendar = c.calendar;
        feedPerDisplayedUnit = c.feedPerDisplayedUnit;
        borrowMaxAge = c.borrowMaxAge;
        liquidationMaxAge = c.liquidationMaxAge;
        continuityBps = c.continuityBps;
        _setBand(c.minPrice, c.maxPrice);
        _setCrossCheck(c.crossCheckFeed, c.crossCheckMaxAge, c.crossCheckBps);
    }

    /// @notice The market calendar's admin administers this source, so one handover moves every Blue role.
    function admin() public view returns (address) {
        return calendar.admin();
    }

    /// @notice Replaces the reporter and guardian.
    function setRoles(address reporter_, address guardian_) external {
        if (msg.sender != admin()) revert Unauthorized();
        _setRoles(reporter_, guardian_);
    }

    function refresh() external {
        if (msg.sender != reporter && msg.sender != admin()) revert Unauthorized();
        if (suspended) revert UnusablePrice();
        _accept(false);
    }

    /// @notice Governance accepts a new reference after checking a large gap or a corporate action.
    function acceptReference() external {
        if (msg.sender != admin()) revert Unauthorized();
        _accept(true);
        suspended = false;
    }

    function suspend() external {
        if (msg.sender != reporter && msg.sender != guardian && msg.sender != admin()) revert Unauthorized();
        suspended = true;
        emit PriceSuspended();
    }

    /// @notice Sets the absolute range outside which a round is treated as invalid.
    function setBand(uint256 minPrice_, uint256 maxPrice_) external {
        if (msg.sender != admin()) revert Unauthorized();
        _setBand(minPrice_, maxPrice_);
    }

    /// @notice Sets or clears (feed = 0) the secondary feed that new borrowing must agree with.
    function setCrossCheck(IPriceFeed feed_, uint32 maxAge, uint16[4] calldata toleranceBps) external {
        if (msg.sender != admin()) revert Unauthorized();
        _setCrossCheck(feed_, maxAge, toleranceBps);
    }

    /// @notice The cross-check price and its difference from the primary price.
    /// @return available False when no cross-check is set or its round is invalid or too old.
    function crossCheck() external view returns (bool available, uint256 referencePrice, uint256 deviationBps) {
        (uint256 primary,) = _livePrice();
        uint256 updatedAt;
        (referencePrice, updatedAt) = _crossCheckPrice();
        if (referencePrice == 0 || primary == 0 || block.timestamp - updatedAt > crossCheckMaxAge) {
            return (false, referencePrice, 0);
        }
        uint256 difference = primary > referencePrice ? primary - referencePrice : referencePrice - primary;
        return (true, referencePrice, difference * BPS / referencePrice);
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
        return updatedAt == observedAt && current == price && _agreesWithCrossCheck(current);
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

    function _setRoles(address reporter_, address guardian_) private {
        if (reporter_ == address(0) || guardian_ == address(0)) revert InvalidConfig();
        reporter = reporter_;
        guardian = guardian_;
        emit RolesSet(reporter_, guardian_);
    }

    function _setBand(uint256 minPrice_, uint256 maxPrice_) private {
        if (minPrice_ == 0 || minPrice_ >= maxPrice_ || maxPrice_ > MAX_PRICE) revert InvalidConfig();
        minPrice = minPrice_;
        maxPrice = maxPrice_;
        emit BandSet(minPrice_, maxPrice_);
    }

    function _setCrossCheck(IPriceFeed feed_, uint32 maxAge, uint16[4] memory toleranceBps) private {
        if (address(feed_) != address(0)) {
            if (address(stock) == address(0) || feed_.decimals() != decimals || maxAge == 0) revert InvalidConfig();
            for (uint256 i; i < 4; ++i) {
                if (toleranceBps[i] == 0 || toleranceBps[i] >= BPS) revert InvalidConfig();
            }
        }
        crossCheckFeed = feed_;
        crossCheckMaxAge = maxAge;
        crossCheckBps = toleranceBps;
        emit CrossCheckSet(address(feed_), maxAge, toleranceBps);
    }

    function _agreesWithCrossCheck(uint256 primary) private view returns (bool) {
        if (address(crossCheckFeed) == address(0)) return true;
        uint256 marketStatus = uint256(calendar.status(address(stock)));
        if (marketStatus >= 4) return false;
        (uint256 reference_, uint256 updatedAt) = _crossCheckPrice();
        if (reference_ == 0 || block.timestamp - updatedAt > crossCheckMaxAge) return false;
        uint256 difference = primary > reference_ ? primary - reference_ : reference_ - primary;
        return difference * BPS <= reference_ * crossCheckBps[marketStatus];
    }

    function _crossCheckPrice() private view returns (uint256 converted, uint256 updatedAt) {
        if (address(crossCheckFeed) == address(0)) return (0, 0);
        try crossCheckFeed.latestRoundData() returns (
            uint80 id, int256 answer, uint256, uint256 stamp, uint80 answered
        ) {
            if (answer <= 0 || uint256(answer) > MAX_PRICE || stamp == 0 || stamp > block.timestamp || answered < id) {
                return (0, 0);
            }
            uint256 converted_ = uint256(answer);
            if (feedPerDisplayedUnit) converted_ = converted_ * _multiplier() / 1e18;
            return (converted_, stamp);
        } catch {
            return (0, 0);
        }
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
