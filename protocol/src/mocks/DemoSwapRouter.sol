// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IDemoOracle {
    function getAssetPrice(address asset) external view returns (uint256);
}

interface IDemoToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Swaps the demo pool's test tokens against mock USDT at the pool's oracle price, from its own inventory.
///         It has the PancakeSwap v3 exact-output interface, so the app uses the same calls for both pools.
///         For test tokens only: it has no price impact and anyone may trade against it.
contract DemoSwapRouter {
    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    struct QuoteExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amount;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    uint256 public constant FEE_BPS = 25;
    uint256 private constant BPS = 10_000;

    IDemoOracle public immutable oracle;
    address public immutable usdt;
    address public immutable owner;

    error Unauthorized();
    error UnsupportedPair();
    error Expired();
    error TooMuchRequested();
    error TransferFailed();

    constructor(IDemoOracle oracle_, address usdt_, address owner_) {
        oracle = oracle_;
        usdt = usdt_;
        owner = owner_;
    }

    function quoteExactOutputSingle(QuoteExactOutputSingleParams calldata p)
        external
        view
        returns (uint256 amountIn, uint160, uint32, uint256)
    {
        amountIn = _amountIn(p.tokenIn, p.tokenOut, p.amount);
    }

    function exactOutputSingle(ExactOutputSingleParams calldata p) external returns (uint256 amountIn) {
        if (block.timestamp > p.deadline) revert Expired();
        amountIn = _amountIn(p.tokenIn, p.tokenOut, p.amountOut);
        if (amountIn > p.amountInMaximum) revert TooMuchRequested();
        if (!IDemoToken(p.tokenIn).transferFrom(msg.sender, address(this), amountIn)) revert TransferFailed();
        if (!IDemoToken(p.tokenOut).transfer(p.recipient, p.amountOut)) revert TransferFailed();
    }

    function withdraw(address token, uint256 amount) external {
        if (msg.sender != owner) revert Unauthorized();
        if (!IDemoToken(token).transfer(owner, amount)) revert TransferFailed();
    }

    /// @dev Every listed token has 18 decimals. Rounds up, then adds the fee.
    function _amountIn(address tokenIn, address tokenOut, uint256 amountOut) private view returns (uint256) {
        if ((tokenIn == usdt) == (tokenOut == usdt)) revert UnsupportedPair();
        uint256 priceIn = oracle.getAssetPrice(tokenIn);
        uint256 priceOut = oracle.getAssetPrice(tokenOut);
        if (priceIn == 0 || priceOut == 0) revert UnsupportedPair();
        uint256 divisor = priceIn * (BPS - FEE_BPS);
        return (amountOut * priceOut * BPS + divisor - 1) / divisor;
    }
}
