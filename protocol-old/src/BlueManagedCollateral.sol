// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IBStockLike} from "./interfaces/IBStockLike.sol";
import {SafeTransferLib} from "./libraries/SafeTransferLib.sol";

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @notice 1:1 raw-unit collateral for a NEW managed market. Only router-funded deposits can enter Morpho.
///         Liquidators receive transferable receipts and can redeem directly, without router permission.
///         Restricting mint alone would NOT prevent a liquidator from supplying receipts to a bypass position.
contract BlueManagedCollateral {
    using SafeTransferLib for address;

    string public constant name = "Blue managed collateral";
    string public constant symbol = "bmStock";
    uint8 public immutable decimals;
    address public immutable UNDERLYING;
    address public immutable ROUTER;
    address public immutable MORPHO;
    uint256 public totalSupply;
    uint256 public supplyCap;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 private _lock = 1;

    event Transfer(address indexed from, address indexed to, uint256 assets);
    event Approval(address indexed owner, address indexed spender, uint256 assets);
    event SupplyCapSet(uint256 assets);
    error Unauthorized();
    error InvalidTransfer();
    error UnsupportedUnderlying();
    error SupplyCapExceeded();

    modifier locked() {
        if (_lock != 1) revert InvalidTransfer();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address underlying, address router, address morpho, uint256 supplyCap_) {
        if (underlying.code.length == 0 || router.code.length == 0 || morpho.code.length == 0) {
            revert UnsupportedUnderlying();
        }
        UNDERLYING = underlying;
        ROUTER = router;
        MORPHO = morpho;
        supplyCap = supplyCap_;
        decimals = IERC20Balance(underlying).decimals();
    }

    function uiMultiplier() external view returns (uint256) {
        return IBStockLike(UNDERLYING).uiMultiplier();
    }

    function wrap(uint256 assets) external locked {
        if (msg.sender != ROUTER) revert Unauthorized();
        if (totalSupply + assets > supplyCap) revert SupplyCapExceeded();
        uint256 beforeBalance = IERC20Balance(UNDERLYING).balanceOf(address(this));
        UNDERLYING.safeTransferFrom(msg.sender, address(this), assets);
        if (IERC20Balance(UNDERLYING).balanceOf(address(this)) - beforeBalance != assets) {
            revert UnsupportedUnderlying(); // fee-on-transfer/rebasing raw balances require a different adapter
        }
        totalSupply += assets;
        balanceOf[msg.sender] += assets;
        emit Transfer(address(0), msg.sender, assets);
    }

    function setSupplyCap(uint256 assets) external {
        if (msg.sender != ROUTER) revert Unauthorized();
        supplyCap = assets; // lowering below outstanding receipts blocks minting; redemption remains available
        emit SupplyCapSet(assets);
    }

    function redeem(uint256 assets, address receiver) external locked {
        if (receiver == address(0) || receiver == address(this)) revert InvalidTransfer();
        balanceOf[msg.sender] -= assets;
        totalSupply -= assets;
        emit Transfer(msg.sender, address(0), assets);
        UNDERLYING.safeTransfer(receiver, assets);
    }

    function approve(address spender, uint256 assets) external returns (bool) {
        allowance[msg.sender][spender] = assets;
        emit Approval(msg.sender, spender, assets);
        return true;
    }

    function transfer(address receiver, uint256 assets) external returns (bool) {
        _transfer(msg.sender, receiver, assets);
        return true;
    }

    function transferFrom(address from, address receiver, uint256 assets) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved != type(uint256).max) allowance[from][msg.sender] = approved - assets;
        _transfer(from, receiver, assets);
        return true;
    }

    function _transfer(address from, address receiver, uint256 assets) internal {
        if (receiver == address(0) || receiver == address(this)) revert InvalidTransfer();
        if (receiver == MORPHO && (from != ROUTER || msg.sender != MORPHO)) revert Unauthorized();
        balanceOf[from] -= assets;
        balanceOf[receiver] += assets;
        emit Transfer(from, receiver, assets);
    }
}
