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
import {RegimeRegistry} from "morpho-prototype/RegimeRegistry.sol";
import {IBStockLike} from "morpho-prototype/interfaces/IBStockLike.sol";
import {MockBStock} from "morpho-prototype/mocks/MockBStock.sol";
import {MockAtlasFeed} from "morpho-prototype/mocks/MockAtlasFeed.sol";
import {BluePool} from "../src/BluePool.sol";
import {StockBorrowControls} from "../src/StockBorrowControls.sol";
import {StockPriceSource} from "../src/StockPriceSource.sol";

abstract contract BlueV3Deployment {
    uint256 internal constant STOCK_COUNT = 5;
    uint256 internal constant USDT_CAP = 1_000;
    uint16 internal constant BASE_LTV = 5_000;
    uint256 internal constant LIQUIDATION_THRESHOLD = 6_250;
    uint256 internal constant LIQUIDATION_BONUS = 10_500;
    uint32 internal constant HEARTBEAT = 10 minutes;
    uint32 internal constant RECOVERY = 30 minutes;
    uint32 internal constant BORROW_MAX_AGE = 2 hours;
    uint32 internal constant LIQUIDATION_MAX_AGE = 24 hours;

    struct Roles {
        address admin;
        address keeper;
        address guardian;
        address signer;
    }

    struct Stock {
        MockBStock token;
        MockAtlasFeed feed;
        StockPriceSource source;
    }

    struct Deployment {
        PoolAddressesProvider provider;
        BluePool pool;
        PoolConfiguratorInstance configurator;
        RegimeRegistry registry;
        StockBorrowControls controls;
        AaveOracle oracle;
        Stock[STOCK_COUNT] stocks;
        MockAtlasFeed usdtFeed;
        StockPriceSource usdtPrice;
    }

    /// @dev Execute with admin as the deployer. All USD feeds use synthetic prices.
    function _deploy(address usdt, Roles memory roles) internal returns (Deployment memory d) {
        d.provider = new PoolAddressesProvider("Blue Aave V3 Local", roles.admin);
        d.provider.setACLAdmin(roles.admin);
        ACLManager acl = new ACLManager(d.provider);
        d.provider.setACLManager(address(acl));
        acl.addPoolAdmin(roles.admin);

        d.registry = new RegimeRegistry(roles.admin, address(0), 7 days, false);
        d.stocks[0] = _mockStock("Mock Tesla bStock", "TSLAB", 250e8, roles);
        d.stocks[1] = _mockStock("Mock NVIDIA bStock", "NVDAB", 125e8, roles);
        d.stocks[2] = _mockStock("Mock Nasdaq 100 ETF bStock", "QQQb", 500e8, roles);
        d.stocks[3] = _mockStock("Mock SpaceX bStock", "SPCXb", 100e8, roles);
        d.stocks[4] = _mockStock("Mock Alphabet bStock", "GOOGLb", 200e8, roles);
        d.usdtFeed = new MockAtlasFeed(8, 1e8);
        d.usdtPrice = _price(d.usdtFeed, IBStockLike(address(0)), roles);
        address[] memory assets = new address[](STOCK_COUNT + 1);
        assets[0] = usdt;
        address[] memory sources = new address[](assets.length);
        sources[0] = address(d.usdtPrice);
        for (uint256 i; i < STOCK_COUNT; ++i) {
            assets[i + 1] = address(d.stocks[i].token);
            sources[i + 1] = address(d.stocks[i].source);
        }
        d.oracle = new AaveOracle(d.provider, assets, sources, address(0), address(0), 1e8);
        d.provider.setPriceOracle(address(d.oracle));

        d.controls = new StockBorrowControls(
            roles.admin,
            roles.keeper,
            roles.guardian,
            roles.signer,
            d.provider,
            d.registry,
            d.usdtPrice,
            HEARTBEAT,
            RECOVERY,
            1 days
        );
        d.controls.setSharedLimits(uint128(USDT_CAP * 1 ether), 6_000); // shared reserve budget; at most 60% per stock
        uint16[4] memory discounts = [uint16(0), 400, 1_000, 1_500];
        uint128[4] memory caps = [uint128(400 ether), 300 ether, 200 ether, 100 ether];
        for (uint256 i; i < STOCK_COUNT; ++i) {
            Stock memory stock = d.stocks[i];
            d.controls.configureStock(address(stock.token), stock.source, BASE_LTV, discounts, caps);
        }

        DefaultReserveInterestRateStrategyV2 strategy = new DefaultReserveInterestRateStrategyV2(address(d.provider));
        BluePool implementation = new BluePool(d.provider, strategy, usdt, d.controls);
        d.provider.setPoolImpl(address(implementation));
        d.pool = BluePool(d.provider.getPool());
        d.provider.setPoolConfiguratorImpl(address(new PoolConfiguratorInstance()));
        d.configurator = PoolConfiguratorInstance(d.provider.getPoolConfigurator());
        d.provider.setPoolDataProvider(address(new AaveProtocolDataProvider(d.provider)));

        address atoken = address(new ATokenInstance(d.pool, address(0), roles.admin));
        address debtToken = address(new VariableDebtTokenInstance(d.pool, address(0)));
        bytes memory rateData = abi.encode(IDefaultInterestRateStrategyV2.InterestRateData(8_000, 200, 400, 6_000));
        ConfiguratorInputTypes.InitReserveInput[] memory inputs =
            new ConfiguratorInputTypes.InitReserveInput[](assets.length);
        inputs[0] = _reserve(usdt, "USDT", atoken, debtToken, rateData);
        for (uint256 i; i < STOCK_COUNT; ++i) {
            MockBStock token = d.stocks[i].token;
            inputs[i + 1] = _reserve(address(token), token.symbol(), atoken, debtToken, rateData);
        }
        d.configurator.initReserves(inputs);

        d.configurator.setReserveBorrowing(usdt, true);
        d.configurator.setBorrowableInIsolation(usdt, true);
        d.configurator.setSupplyCap(usdt, USDT_CAP);
        d.configurator.setBorrowCap(usdt, USDT_CAP);
        d.configurator.setReserveFactor(usdt, 1_000);
        for (uint256 i; i < STOCK_COUNT; ++i) {
            _configureCollateral(d.configurator, address(d.stocks[i].token));
        }
    }

    function _mockStock(string memory name, string memory symbol, int256 price, Roles memory roles)
        private
        returns (Stock memory stock)
    {
        stock.token = new MockBStock(name, symbol);
        stock.feed = new MockAtlasFeed(8, price);
        stock.source = _price(stock.feed, stock.token, roles);
    }

    function _price(MockAtlasFeed feed, IBStockLike stock, Roles memory roles)
        private
        returns (StockPriceSource source)
    {
        source = new StockPriceSource(
            roles.admin, roles.keeper, roles.guardian, feed, stock, false, BORROW_MAX_AGE, LIQUIDATION_MAX_AGE, 2_000
        );
        source.refresh();
    }

    function _configureCollateral(PoolConfiguratorInstance configurator, address stock) private {
        configurator.configureReserveAsCollateral(stock, BASE_LTV, LIQUIDATION_THRESHOLD, LIQUIDATION_BONUS);
        // Aave V3.6 isolation enforces one stock collateral. Its principal ceiling is in 2-decimal base units.
        // Blue's lower, per-regime ceiling is enforced in accrued USDT units.
        configurator.setDebtCeiling(stock, USDT_CAP * 100);
    }

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
            aTokenSymbol: string.concat("a", symbol),
            variableDebtTokenName: string.concat("Blue variable debt ", symbol),
            variableDebtTokenSymbol: string.concat("variableDebt", symbol),
            params: "",
            interestRateData: rateData
        });
    }
}
