// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Deploy} from "./Deploy.s.sol";

/// @notice Local-fork managed-market demo. Permission starts closed; run healthy keeper proofs for recovery.
contract DeployManaged is Deploy {
    function _managedMarket() internal pure override returns (bool) {
        return true;
    }
}
