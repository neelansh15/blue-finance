// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {BlueV3Deployment} from "./BlueV3Deployment.sol";

/// @notice BNB Chain mainnet addresses for Blue's first listing.
/// @dev Verified on-chain on 2026-11-27: each token's symbol, 18 decimals and uiMultiplier, and each feed's
///      description, 8 decimals and a round under one hour old. Atlas feed addresses are the instances Lista
///      lists; reads are open to any caller. Confirm with Atlas which instance Blue should use before launch.
///      Price bands are roughly 1/10 to 10 times the price on 2026-11-27, per raw token.
abstract contract BscMainnet is BlueV3Deployment {
    uint256 internal constant BSC_CHAIN_ID = 56;
    address internal constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address internal constant USDT_USD_FEED = 0xB97Ad0E74fa7d920791E90258A6E2085088b4320; // Chainlink

    address internal constant TSLAB = 0x5b1910eAaD6450E50f816082Aa078C41F10C292f;
    address internal constant NVDAB = 0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436;
    address internal constant QQQB = 0x205812CdBed920aFf76C6580abD681a46D11efc7;
    address internal constant SPCXB = 0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1;
    address internal constant GOOGLB = 0x3F53De71c126BdaBAe20f9cD64848d317f6C3238;

    address internal constant TSLAB_USD_FEED = 0xf569C3e52e797219eCFDc1659c3250B0BbDC693C;
    address internal constant NVDAB_USD_FEED = 0x2bd759006b423BFF444181A13C96a6b134E557BB;
    address internal constant QQQB_USD_FEED = 0xA94918f11c9e7703426CCD494A4a999924942DDD;
    address internal constant SPCXB_USD_FEED = 0xdf8b61796436eD39F406623aa2166a7f185185Cb;
    address internal constant GOOGLB_USD_FEED = 0x9A47A6560E224a26F663675D5c76888A26cac6C3;

    /// @dev Values USDT within $0.90 to $1.10. Chainlink USDT/USD on BNB has a 15-minute heartbeat and 0.1%
    ///      deviation, so a round over an hour old stops new borrowing. Valuation tolerates a day.
    function _bscUsdFeed() internal pure returns (UsdFeed memory) {
        return UsdFeed({
            feed: IPriceFeed(USDT_USD_FEED),
            borrowMaxAge: 1 hours,
            valuationMaxAge: 24 hours,
            minPrice: 0.9e8,
            maxPrice: 1.1e8
        });
    }

    /// @notice The listing priced by Atlas alone. See AproCrossCheck.sol for the optional second source.
    function _bscStocks() internal pure returns (StockListing[] memory stocks) {
        stocks = new StockListing[](5);
        stocks[0] = _listing(TSLAB, TSLAB_USD_FEED, 40e8, 4_000e8);
        stocks[1] = _listing(NVDAB, NVDAB_USD_FEED, 15e8, 1_500e8);
        stocks[2] = _listing(QQQB, QQQB_USD_FEED, 60e8, 6_000e8);
        stocks[3] = _listing(SPCXB, SPCXB_USD_FEED, 13e8, 1_300e8);
        stocks[4] = _listing(GOOGLB, GOOGLB_USD_FEED, 25e8, 2_500e8);
    }

    function _listing(address token, address feed, uint256 minPrice, uint256 maxPrice)
        private
        pure
        returns (StockListing memory)
    {
        return StockListing({
            token: token,
            feed: IPriceFeed(feed),
            feedPerDisplayedUnit: false,
            minPrice: minPrice,
            maxPrice: maxPrice,
            crossCheckFeed: IPriceFeed(address(0))
        });
    }
}
