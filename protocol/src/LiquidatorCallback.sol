// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IMorpho, MarketParams} from "./interfaces/IMorpho.sol";

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// @title LiquidatorCallback
/// @notice Minimal Morpho Blue liquidator that needs no flash loan. Morpho sends the seized collateral first and
///         then calls `onMorphoLiquidate` before pulling the loan token, so the repayment can come from either
///         (a) loan token already held by this contract (demo), or (b) a swap of the seized collateral,
///         done by a pluggable `swapper` call chosen by the owner. Owner-only entry point.
contract LiquidatorCallback {
    IMorpho public immutable MORPHO;
    address public owner;
    address internal _loanToken; // set only for the duration of liquidate()

    error Unauthorized();
    error NotInLiquidation();
    error TransferFailed();
    error SwapFailed();
    error InsufficientLoanToken();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(IMorpho morpho, address owner_) {
        MORPHO = morpho;
        owner = owner_;
    }

    /// @param swapper address called to turn collateral into loan token (address(0) = use pre-funded loan token)
    /// @param swapData calldata for `swapper`; it must leave the loan token in this contract.
    function liquidate(
        MarketParams calldata params,
        address borrower,
        uint256 seizedAssets,
        uint256 repaidShares,
        address swapper,
        bytes calldata swapData
    ) external onlyOwner returns (uint256 seized, uint256 repaid) {
        _loanToken = params.loanToken;
        (seized, repaid) =
            MORPHO.liquidate(params, borrower, seizedAssets, repaidShares, abi.encode(params.collateralToken, swapper, swapData));
        _loanToken = address(0);
    }

    /// @notice Morpho callback. Collateral has already been received; must approve `repaidAssets` of loan token.
    function onMorphoLiquidate(uint256 repaidAssets, bytes calldata data) external {
        if (msg.sender != address(MORPHO)) revert Unauthorized();
        address loan = _loanToken;
        if (loan == address(0)) revert NotInLiquidation();
        (address collateral, address swapper, bytes memory swapData) = abi.decode(data, (address, address, bytes));

        if (swapper != address(0)) {
            IERC20Min(collateral).approve(swapper, type(uint256).max);
            (bool ok,) = swapper.call(swapData);
            if (!ok) revert SwapFailed();
            IERC20Min(collateral).approve(swapper, 0);
        }
        if (IERC20Min(loan).balanceOf(address(this)) < repaidAssets) revert InsufficientLoanToken();
        IERC20Min(loan).approve(address(MORPHO), repaidAssets);
    }

    /// @notice Withdraw proceeds or leftovers.
    function sweep(address token, address to) external onlyOwner {
        uint256 bal = IERC20Min(token).balanceOf(address(this));
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20Min.transfer, (to, bal)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}
