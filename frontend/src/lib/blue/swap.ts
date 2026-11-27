// PancakeSwap v3 on BNB Smart Chain, where the real bStocks trade against USDT.
// Addresses match https://developer.pancake.xyz/contracts/v3/addresses.

import { parseAbi, type Address, type PublicClient } from "viem";
import { BLUE, IS_DEMO } from "./mainnet";
import type { StockId } from "./pool";

export const SWAP = {
  router: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
  quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
  /** The most liquid USDT pool for each stock on November 27, 2026. */
  fees: { TSLAB: 2500, NVDAB: 2500, QQQB: 500, SPCXB: 2500, GOOGLB: 2500 },
} as const satisfies { router: Address; quoter: Address; fees: Record<StockId, number> };

/** The demo pool's test tokens have no swap pools, so leverage sends transactions on the live pool only. */
export const LEVERAGE_LIVE = !IS_DEMO;

export const routerContract = {
  address: SWAP.router,
  abi: parseAbi([
    "function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)",
  ]),
} as const;

const quoterAbi = parseAbi([
  "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

const WAD = 10n ** 18n;

/**
 * The current price of an exact-output swap, in USDT per stock token (1e18), including the pool fee and the
 * price impact of this size. `amountOut` is stock for a buy and USDT for a sell.
 */
export async function quotePrice(
  client: PublicClient, side: "buy" | "sell", stock: { id: StockId; address: Address }, amountOut: bigint,
): Promise<bigint> {
  const buying = side === "buy";
  const { result } = await client.simulateContract({
    address: SWAP.quoter,
    abi: quoterAbi,
    functionName: "quoteExactOutputSingle",
    args: [{
      tokenIn: buying ? BLUE.usdt : stock.address,
      tokenOut: buying ? stock.address : BLUE.usdt,
      amount: amountOut,
      fee: SWAP.fees[stock.id],
      sqrtPriceLimitX96: 0n,
    }],
  });
  const amountIn = result[0];
  if (amountIn === 0n) throw new Error("The swap pool returned no quote.");
  return buying ? amountIn * WAD / amountOut : amountOut * WAD / amountIn;
}
