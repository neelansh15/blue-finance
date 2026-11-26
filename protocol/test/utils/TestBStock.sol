// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IBStockLike} from "../../src/interfaces/IBStockLike.sol";

/// @title TestBStock
/// @notice Test ERC20 with ERC-8056 / BEP-677 scaled-UI semantics, modelled on the bStock
///         SecuritiesToken: raw balances never change, uiMultiplier() (1e18) is display-only,
///         setUIMultiplier(new, effectiveAt) emits UIMultiplierUpdated immediately and views keep
///         returning the old multiplier until effectiveAt. A new schedule overwrites a pending one.
///         No compliance or pause logic (that is a documented gap versus the real token).
contract TestBStock is IBStockLike {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public constant MIN_MULTIPLIER = 1e9;
    uint256 public constant MAX_MULTIPLIER = 1e27;

    address public owner;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 internal _multiplier = 1e18;
    uint256 internal _pendingMultiplier;
    uint256 internal _effectiveAt;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event UIMultiplierChangeOverwritten(uint256 overwrittenMultiplier, uint256 overwrittenEffectiveAt);

    error Unauthorized();
    error InvalidMultiplier();
    error InvalidEffectiveAt();
    error InsufficientBalance();
    error InsufficientAllowance();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
        owner = msg.sender;
    }

    // ---- ERC-8056 views

    function uiMultiplier() public view returns (uint256) {
        if (_effectiveAt != 0 && block.timestamp >= _effectiveAt) return _pendingMultiplier;
        return _multiplier;
    }

    function pendingMultiplier() external view returns (uint256 multiplier, uint256 effectiveAt) {
        return (_pendingMultiplier, _effectiveAt);
    }

    function hasPendingMultiplier() external view returns (bool) {
        return _effectiveAt != 0 && block.timestamp < _effectiveAt;
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return (balanceOf[account] * uiMultiplier()) / 1e18;
    }

    function toUIAmount(uint256 raw) external view returns (uint256) {
        return (raw * uiMultiplier()) / 1e18;
    }

    function fromUIAmount(uint256 ui) external view returns (uint256) {
        return (ui * 1e18) / uiMultiplier();
    }

    // ---- multiplier controls (owner = the test)

    /// Schedules a multiplier change. effectiveAt may equal block.timestamp here (immediate),
    /// unlike the real token, which requires a future effectiveAt <= 365 days ahead.
    function setUIMultiplier(uint256 newMultiplier, uint256 effectiveAt) public onlyOwner {
        if (newMultiplier < MIN_MULTIPLIER || newMultiplier > MAX_MULTIPLIER) revert InvalidMultiplier();
        if (effectiveAt < block.timestamp || effectiveAt > block.timestamp + 365 days) revert InvalidEffectiveAt();
        _settle();
        if (_effectiveAt != 0) emit UIMultiplierChangeOverwritten(_pendingMultiplier, _effectiveAt);
        uint256 old = _multiplier;
        _pendingMultiplier = newMultiplier;
        _effectiveAt = effectiveAt;
        emit UIMultiplierUpdated(old, newMultiplier, effectiveAt);
    }

    /// Convenience for tests: change takes effect in this block.
    function setUIMultiplierNow(uint256 newMultiplier) external {
        setUIMultiplier(newMultiplier, block.timestamp);
    }

    // ---- ERC20

    function mint(address to, uint256 amount) external onlyOwner {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    /// Folds an already-effective pending change into the current multiplier.
    function _settle() internal {
        if (_effectiveAt != 0 && block.timestamp >= _effectiveAt) {
            _multiplier = _pendingMultiplier;
            _pendingMultiplier = 0;
            _effectiveAt = 0;
        }
    }
}
