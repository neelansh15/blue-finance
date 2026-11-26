// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

/// @notice Mintable 18-decimal test stand-in for USDT. It is NOT Tether's USDT and has no value.
contract MockUSDT is ERC20, Ownable {
    constructor(address owner_, address recipient, uint256 amount) ERC20("Blue Mock USDT", "mUSDT") Ownable(owner_) {
        _mint(recipient, amount);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
