// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {PoolAddressesProvider} from "aave/protocol/configuration/PoolAddressesProvider.sol";
import {ACLManager} from "aave/protocol/configuration/ACLManager.sol";
import {PoolConfiguratorInstance} from "aave/instances/PoolConfiguratorInstance.sol";
import {ATokenInstance} from "aave/instances/ATokenInstance.sol";
import {VariableDebtTokenInstance} from "aave/instances/VariableDebtTokenInstance.sol";
import {ConfiguratorInputTypes} from "aave/protocol/libraries/types/ConfiguratorInputTypes.sol";
import {AaveProtocolDataProvider} from "aave/helpers/AaveProtocolDataProvider.sol";
import {AaveOracle} from "aave/misc/AaveOracle.sol";
import {DefaultReserveInterestRateStrategyV2} from "aave/misc/DefaultReserveInterestRateStrategyV2.sol";
import {IDefaultInterestRateStrategyV2} from "aave/interfaces/IDefaultInterestRateStrategyV2.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {IBStockLike} from "../src/interfaces/IBStockLike.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {BluePool} from "../src/BluePool.sol";
import {StockBorrowControls} from "../src/StockBorrowControls.sol";
import {StockPriceSource} from "../src/StockPriceSource.sol";

/// @notice Deploys Blue's Aave V3 pool for a given USDT token, USD price feed and list of bStocks.
/// @dev Risk parameters below are prototype values. Calibrate them before launch.
abstract contract BlueV3Deployment {
    uint256 internal constant USDT_CAP = 1_000;
    uint16 internal constant BASE_LTV = 5_000;
    uint256 internal constant LIQUIDATION_THRESHOLD = 6_250;
    uint256 internal constant LIQUIDATION_BONUS = 10_500;
    uint32 internal constant HEARTBEAT = 10 minutes;
    uint32 internal constant RECOVERY = 30 minutes;
    uint32 internal constant BORROW_MAX_AGE = 2 hours;
    uint32 internal constant LIQUIDATION_MAX_AGE = 24 hours;
    uint32 internal constant MAX_ELIGIBILITY = 1 days;
    uint16 internal constant CONTINUITY_BPS = 2_000;
    /// @dev Age limit for an optional cross-check feed that updates at least hourly.
    uint32 internal constant CROSS_CHECK_MAX_AGE = 2 hours;

    struct Roles {
        address admin;
        address keeper;
        address guardian;
        address signer;
    }

    /// @notice A bStock to list as collateral, its primary USD feed, and an optional cross-check feed.
    /// @dev Atlas bStock feeds quote per raw token, so `feedPerDisplayedUnit` is false for them. The optional
    ///      cross-check feed must use the same units; zero turns it off.
    struct StockListing {
        address token;
        IPriceFeed feed;
        bool feedPerDisplayedUnit;
        uint256 minPrice;
        uint256 maxPrice;
        IPriceFeed crossCheckFeed;
    }

    /// @notice The USD feed for the debt asset (USDT).
    struct UsdFeed {
        IPriceFeed feed;
        uint32 borrowMaxAge;
        uint32 valuationMaxAge;
        uint256 minPrice;
        uint256 maxPrice;
    }

    struct Deployment {
        PoolAddressesProvider provider;
        BluePool pool;
        PoolConfiguratorInstance configurator;
        MarketCalendar calendar;
        StockBorrowControls controls;
        AaveOracle oracle;
        StockPriceSource usdtPrice;
        StockPriceSource[] stockPrices;
    }

    /// @dev Execute with `roles.admin` as the deployer. A price source whose feed is too old to accept at
    ///      deployment is left for the keeper to refresh.
    function _deploy(address usdt, Roles memory roles, UsdFeed memory usdFeed, StockListing[] memory stocks)
        internal
        returns (Deployment memory d)
    {
        d.provider = new PoolAddressesProvider("Blue Finance", roles.admin);
        d.provider.setACLAdmin(roles.admin);
        ACLManager acl = new ACLManager(d.provider);
        d.provider.setACLManager(address(acl));
        acl.addPoolAdmin(roles.admin);
        d.calendar = new MarketCalendar(roles.admin, address(0), 7 days, false);

        d.usdtPrice = _priceSource(
            roles,
            d.calendar,
            usdFeed.feed,
            IBStockLike(address(0)),
            false,
            usdFeed.borrowMaxAge,
            usdFeed.valuationMaxAge,
            usdFeed.minPrice,
            usdFeed.maxPrice,
            IPriceFeed(address(0))
        );
        d.stockPrices = new StockPriceSource[](stocks.length);
        address[] memory assets = new address[](stocks.length + 1);
        address[] memory sources = new address[](assets.length);
        assets[0] = usdt;
        sources[0] = address(d.usdtPrice);
        for (uint256 i; i < stocks.length; ++i) {
            StockListing memory listing = stocks[i];
            d.stockPrices[i] = _priceSource(
                roles,
                d.calendar,
                listing.feed,
                IBStockLike(listing.token),
                listing.feedPerDisplayedUnit,
                BORROW_MAX_AGE,
                LIQUIDATION_MAX_AGE,
                listing.minPrice,
                listing.maxPrice,
                listing.crossCheckFeed
            );
            assets[i + 1] = listing.token;
            sources[i + 1] = address(d.stockPrices[i]);
        }
        d.oracle = new AaveOracle(d.provider, assets, sources, address(0), address(0), 1e8);
        d.provider.setPriceOracle(address(d.oracle));

        d.controls = new StockBorrowControls(
            roles.admin,
            roles.keeper,
            roles.guardian,
            roles.signer,
            d.provider,
            d.calendar,
            d.usdtPrice,
            HEARTBEAT,
            RECOVERY,
            MAX_ELIGIBILITY
        );
        uint16[4] memory discounts = [uint16(0), 400, 1_000, 1_500];
        uint128[4] memory caps = [uint128(400 ether), 300 ether, 200 ether, 100 ether];
        for (uint256 i; i < stocks.length; ++i) {
            d.controls.configureStock(stocks[i].token, d.stockPrices[i], BASE_LTV, discounts, caps);
        }

        DefaultReserveInterestRateStrategyV2 strategy = new DefaultReserveInterestRateStrategyV2(address(d.provider));
        d.provider.setPoolImpl(address(new BluePool(d.provider, strategy, usdt, d.controls)));
        d.pool = BluePool(d.provider.getPool());
        d.provider.setPoolConfiguratorImpl(address(new PoolConfiguratorInstance()));
        d.configurator = PoolConfiguratorInstance(d.provider.getPoolConfigurator());
        d.provider.setPoolDataProvider(address(new AaveProtocolDataProvider(d.provider)));

        address atoken = address(new ATokenInstance(d.pool, address(0), roles.admin));
        address debtToken = address(new VariableDebtTokenInstance(d.pool, address(0)));
        bytes memory rateData = abi.encode(IDefaultInterestRateStrategyV2.InterestRateData(8_000, 200, 400, 6_000));
        ConfiguratorInputTypes.InitReserveInput[] memory inputs =
            new ConfiguratorInputTypes.InitReserveInput[](assets.length);
        for (uint256 i; i < assets.length; ++i) {
            inputs[i] = _reserve(assets[i], IERC20Metadata(assets[i]).symbol(), atoken, debtToken, rateData);
        }
        d.configurator.initReserves(inputs);

        d.configurator.setReserveBorrowing(usdt, true);
        d.configurator.setBorrowableInIsolation(usdt, true);
        d.configurator.setSupplyCap(usdt, USDT_CAP);
        d.configurator.setBorrowCap(usdt, USDT_CAP);
        d.configurator.setReserveFactor(usdt, 1_000);
        for (uint256 i; i < stocks.length; ++i) {
            _configureCollateral(d.configurator, stocks[i].token);
        }
    }

    function _priceSource(
        Roles memory roles,
        MarketCalendar calendar,
        IPriceFeed feed,
        IBStockLike stock,
        bool feedPerDisplayedUnit,
        uint32 borrowMaxAge,
        uint32 valuationMaxAge,
        uint256 minPrice,
        uint256 maxPrice,
        IPriceFeed crossCheckFeed
    ) private returns (StockPriceSource source) {
        // Allowed primary vs cross-check difference by market status: OPEN, EXTENDED, CLOSED, WEEKEND.
        uint16[4] memory tolerance =
            address(crossCheckFeed) == address(0) ? [uint16(0), 0, 0, 0] : [uint16(200), 300, 300, 500];
        source = new StockPriceSource(
            StockPriceSource.Config({
                admin: roles.admin,
                reporter: roles.keeper,
                guardian: roles.guardian,
                feed: feed,
                stock: stock,
                calendar: calendar,
                feedPerDisplayedUnit: feedPerDisplayedUnit,
                borrowMaxAge: borrowMaxAge,
                liquidationMaxAge: valuationMaxAge,
                continuityBps: CONTINUITY_BPS,
                minPrice: minPrice,
                maxPrice: maxPrice,
                crossCheckFeed: crossCheckFeed,
                crossCheckMaxAge: address(crossCheckFeed) == address(0) ? 0 : CROSS_CHECK_MAX_AGE,
                crossCheckBps: tolerance
            })
        );
        try source.refresh() {} catch {}
    }

    function _configureCollateral(PoolConfiguratorInstance configurator, address stock) private {
        configurator.configureReserveAsCollateral(stock, BASE_LTV, LIQUIDATION_THRESHOLD, LIQUIDATION_BONUS);
        // Aave V3.6 isolation enforces one stock collateral. Its principal ceiling is in 2-decimal base units.
        // Blue's lower, per-status ceiling is enforced in accrued USDT units.
        configurator.setDebtCeiling(stock, USDT_CAP * 100);
    }

    /// @dev Supply receipts are bluTokens (bluUSDT) and debt tokens are bluDebtTokens (bluDebtUSDT).
    function _reserve(address asset, string memory symbol, address aToken, address debtToken, bytes memory rateData)
        private
        pure
        returns (ConfiguratorInputTypes.InitReserveInput memory)
    {
        return ConfiguratorInputTypes.InitReserveInput({
            aTokenImpl: aToken,
            variableDebtTokenImpl: debtToken,
            underlyingAsset: asset,
            aTokenName: string.concat("Blue ", symbol),
            aTokenSymbol: string.concat("blu", symbol),
            variableDebtTokenName: string.concat("Blue debt ", symbol),
            variableDebtTokenSymbol: string.concat("bluDebt", symbol),
            params: "",
            interestRateData: rateData
        });
    }
}
