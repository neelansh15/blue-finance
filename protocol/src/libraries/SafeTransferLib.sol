// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Minimal ERC20 helpers that accept tokens returning nothing (USDT-style) or a bool, and fail on code-less
/// addresses. Return data is limited to one word.
library SafeTransferLib {
    error TransferFailed();
    error ApproveFailed();

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        if (!_call(token, abi.encodeWithSelector(0x23b872dd, from, to, amount))) revert TransferFailed();
    }

    function safeTransfer(address token, address to, uint256 amount) internal {
        if (!_call(token, abi.encodeWithSelector(0xa9059cbb, to, amount))) revert TransferFailed();
    }

    /// Sets the allowance to exactly `amount`, resetting to zero first for tokens that require it.
    function forceApprove(address token, address spender, uint256 amount) internal {
        bytes memory data = abi.encodeWithSelector(0x095ea7b3, spender, amount);
        if (!_call(token, data)) {
            if (!_call(token, abi.encodeWithSelector(0x095ea7b3, spender, 0)) || !_call(token, data)) {
                revert ApproveFailed();
            }
        }
    }

    function _call(address token, bytes memory data) private returns (bool ok) {
        if (token.code.length == 0) return false;
        uint256 rdsize;
        uint256 word;
        assembly ("memory-safe") {
            ok := call(gas(), token, 0, add(data, 0x20), mload(data), 0x00, 0x20)
            rdsize := returndatasize()
            word := mload(0x00)
        }
        // Accept: no return data, or a first word equal to 1 (true).
        if (ok && rdsize != 0) ok = rdsize >= 32 && word == 1;
    }
}
