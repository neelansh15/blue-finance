// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {BscMainnet} from "./BscMainnet.sol";

/// @notice Optional APRO cross-check for new borrowing. Not used by DeployBsc; the demo prices with Atlas alone.
/// @dev APRO bStock feeds quote per raw token, like Atlas, and update on a 1% move and at least hourly
///      (docs.apro.com price feed list, 2026-11-27). Lista and Venus use them as their second source. APRO has no
///      GOOGLB feed. APRO feeds answer wallets directly but only whitelisted contracts, so APRO must whitelist each
///      deployed StockPriceSource before this works. Until then, new borrowing on these stocks stays blocked.
abstract contract AproCrossCheck is BscMainnet {
    address internal constant TSLAB_USD_APRO = 0xe1bc21701Bc8FFa39DaecDb8f58263C1d5e1c0bc;
    address internal constant NVDAB_USD_APRO = 0x310EFC9Fefe89B8085F89E91Ac782Bef6416499E;
    address internal constant QQQB_USD_APRO = 0x2708567c468db65a72095716FCff023dcDfEA07A;
    address internal constant SPCXB_USD_APRO = 0x44c4173459121690613Bc22C110c4f0624254f3E;

    /// @notice The BNB listing with APRO cross-checks on TSLAB, NVDAB, QQQB and SPCXB.
    function _bscStocksWithApro() internal pure returns (StockListing[] memory stocks) {
        stocks = _bscStocks();
        stocks[0].crossCheckFeed = IPriceFeed(TSLAB_USD_APRO);
        stocks[1].crossCheckFeed = IPriceFeed(NVDAB_USD_APRO);
        stocks[2].crossCheckFeed = IPriceFeed(QQQB_USD_APRO);
        stocks[3].crossCheckFeed = IPriceFeed(SPCXB_USD_APRO);
    }
}
