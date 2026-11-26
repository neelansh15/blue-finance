// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// ERC-8056 / BEP-677 style scaled-UI token surface used by Dawn.
interface IBStockLike {
    /// Three arguments, matching the verified bStock SecuritiesToken ABI and BEP-677
    /// (INTERFACES.md listed two; see "Changes" there).
    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);

    function uiMultiplier() external view returns (uint256); // 1e18 scale
    function balanceOfUI(address account) external view returns (uint256);
}
