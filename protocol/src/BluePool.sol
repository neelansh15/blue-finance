// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {PoolInstance} from "aave/instances/PoolInstance.sol";
import {IPoolAddressesProvider} from "aave/interfaces/IPoolAddressesProvider.sol";
import {IReserveInterestRateStrategy} from "aave/interfaces/IReserveInterestRateStrategy.sol";
import {IScaledBalanceToken} from "aave/interfaces/IScaledBalanceToken.sol";
import {DataTypes} from "aave/protocol/libraries/types/DataTypes.sol";
import {UserConfiguration} from "aave/protocol/libraries/configuration/UserConfiguration.sol";
import {TokenMath} from "aave/protocol/libraries/helpers/TokenMath.sol";
import {ReserveLogic} from "aave/protocol/libraries/logic/ReserveLogic.sol";
import {SupplyLogic} from "aave/protocol/libraries/logic/SupplyLogic.sol";
import {Errors} from "aave/protocol/libraries/helpers/Errors.sol";
import {StockBorrowControls} from "./StockBorrowControls.sol";

/// @notice Aave V3.6 Pool with a single USDT debt reserve and controls on each isolated stock collateral.
/// @dev Use nonzero Aave isolation ceilings for stock reserves and zero native USDT collateral LTV.
contract BluePool is PoolInstance {
    using UserConfiguration for DataTypes.UserConfigurationMap;
    using TokenMath for uint256;
    using ReserveLogic for DataTypes.ReserveData;

    address public immutable USDT;
    StockBorrowControls public immutable CONTROLS;

    mapping(address account => address stock) public debtStock;
    mapping(address stock => uint256 scaledDebt) public scaledDebtByStock;
    bool private _entered;

    error UnsupportedDebtAsset();
    error FlashLoansDisabled();
    error OneStockRequired();
    error AboveStockLtv();
    error StockDebtCapExceeded();
    error ReentrantCall();

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(
        IPoolAddressesProvider provider,
        IReserveInterestRateStrategy strategy,
        address usdt,
        StockBorrowControls controls
    ) PoolInstance(provider, strategy) {
        USDT = usdt;
        CONTROLS = controls;
    }

    function borrow(address asset, uint256 amount, uint256 rateMode, uint16 referral, address onBehalfOf)
        public
        override
        nonReentrant
    {
        if (asset != USDT) revert UnsupportedDebtAsset();
        (bool isolated, address stock,) = _usersConfig[onBehalfOf].getIsolationModeState(_reserves, _reservesList);
        address pinned = debtStock[onBehalfOf];
        if (!isolated || (pinned != address(0) && pinned != stock)) revert OneStockRequired();
        (uint256 ltv, uint256 cap) = CONTROLS.checkBorrow(onBehalfOf, stock);
        uint256 beforeDebt = _scaledDebt(onBehalfOf);

        super.borrow(asset, amount, rateMode, referral, onBehalfOf);

        uint256 afterDebt = _scaledDebt(onBehalfOf);
        debtStock[onBehalfOf] = stock;
        scaledDebtByStock[stock] += afterDebt - beforeDebt;
        if (stockDebt(stock) > cap) revert StockDebtCapExceeded();
        _checkLtv(onBehalfOf, ltv);
    }

    function withdraw(address asset, uint256 amount, address to)
        public
        override
        nonReentrant
        returns (uint256 withdrawn)
    {
        address account = _msgSender();
        if (debtStock[account] == asset) {
            (uint256 ltv,) = CONTROLS.riskLimits(asset);
            withdrawn = super.withdraw(asset, amount, to);
            _checkLtv(account, ltv);
        } else {
            withdrawn = super.withdraw(asset, amount, to);
        }
    }

    /// @dev Preserve the upstream aToken hook and apply the same debt-backed collateral rule as withdraw.
    function finalizeTransfer(address asset, address from, address to, uint256 scaledAmount, uint256 scaledBefore)
        external
        override
        nonReentrant
    {
        require(_msgSender() == _reserves[asset].aTokenAddress, Errors.CallerNotAToken());
        SupplyLogic.executeFinalizeTransfer(
            _reserves,
            _reservesList,
            _eModeCategories,
            _usersConfig,
            DataTypes.FinalizeTransferParams({
                asset: asset,
                from: from,
                to: to,
                scaledAmount: scaledAmount,
                scaledBalanceFromBefore: scaledBefore,
                oracle: ADDRESSES_PROVIDER.getPriceOracle(),
                fromEModeCategory: _usersEModeCategory[from]
            })
        );
        if (from != to && scaledAmount != 0 && debtStock[from] == asset) {
            (uint256 ltv,) = CONTROLS.riskLimits(asset);
            _checkLtv(from, ltv);
        }
    }

    function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf)
        public
        override
        nonReentrant
        returns (uint256 repaid)
    {
        uint256 beforeDebt = _scaledDebt(onBehalfOf);
        repaid = super.repay(asset, amount, rateMode, onBehalfOf);
        _recordDebtReduction(onBehalfOf, beforeDebt);
    }

    function repayWithPermit(
        address asset,
        uint256 amount,
        uint256 rateMode,
        address onBehalfOf,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public override nonReentrant returns (uint256 repaid) {
        uint256 beforeDebt = _scaledDebt(onBehalfOf);
        repaid = super.repayWithPermit(asset, amount, rateMode, onBehalfOf, deadline, v, r, s);
        _recordDebtReduction(onBehalfOf, beforeDebt);
    }

    function repayWithATokens(address asset, uint256 amount, uint256 rateMode)
        public
        override
        nonReentrant
        returns (uint256 repaid)
    {
        address account = _msgSender();
        uint256 beforeDebt = _scaledDebt(account);
        repaid = super.repayWithATokens(asset, amount, rateMode);
        _recordDebtReduction(account, beforeDebt);
    }

    function liquidationCall(address collateral, address debt, address account, uint256 amount, bool receiveAToken)
        public
        override
        nonReentrant
    {
        uint256 beforeDebt = _scaledDebt(account);
        super.liquidationCall(collateral, debt, account, amount, receiveAToken);
        // Native liquidation can burn debt both for a repayment and for an uncovered reserve deficit.
        _recordDebtReduction(account, beforeDebt);
    }

    function flashLoan(
        address,
        address[] calldata,
        uint256[] calldata,
        uint256[] calldata,
        address,
        bytes calldata,
        uint16
    ) public pure override {
        revert FlashLoansDisabled();
    }

    function flashLoanSimple(address, address, uint256, bytes calldata, uint16) public pure override {
        revert FlashLoansDisabled();
    }

    function stockDebt(address stock) public view returns (uint256) {
        return scaledDebtByStock[stock].getVTokenBalance(_reserves[USDT].getNormalizedDebt());
    }

    function _checkLtv(address account, uint256 ltv) private view {
        (uint256 collateral, uint256 debt,,,,) = this.getUserAccountData(account);
        if (debt * 10_000 > collateral * ltv) revert AboveStockLtv();
    }

    function _scaledDebt(address account) private view returns (uint256) {
        return IScaledBalanceToken(_reserves[USDT].variableDebtTokenAddress).scaledBalanceOf(account);
    }

    function _recordDebtReduction(address account, uint256 beforeDebt) private {
        if (beforeDebt == 0) return;
        uint256 afterDebt = _scaledDebt(account);
        address stock = debtStock[account];
        scaledDebtByStock[stock] -= beforeDebt - afterDebt;
        if (afterDebt == 0) delete debtStock[account];
    }
}
