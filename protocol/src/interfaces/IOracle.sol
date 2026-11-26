// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

/// Vendored from morpho-org/morpho-blue src/interfaces/IOracle.sol.
interface IOracle {
    /// @notice Price of 1 asset of collateral token quoted in 1 asset of loan token, scaled by 1e36.
    /// @dev Precision is 36 + loan decimals - collateral decimals.
    function price() external view returns (uint256);
}
