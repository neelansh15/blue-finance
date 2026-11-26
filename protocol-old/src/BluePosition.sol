// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IMorpho} from "./interfaces/IMorpho.sol";

/// @notice A Morpho account with exactly one controller and no arbitrary-call or delegation surface.
///         Borrowers own the position through BlueRouter's mapping, never through Morpho authorization.
contract BluePosition {
    address public immutable ROUTER;

    constructor(IMorpho morpho) {
        ROUTER = msg.sender;
        morpho.setAuthorization(msg.sender, true);
    }
}
