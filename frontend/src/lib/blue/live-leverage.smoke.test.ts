// Runs the planned batches against BNB Chain state with eth_simulateV1. Nothing is signed or sent.
//   BLUE_RUN_LIVE_SMOKE=true NEXT_PUBLIC_BLUE_DEPLOYMENT=real npm test -- src/lib/blue/live-leverage.smoke.test.ts
//
// The simulation first creates what the live pool may not have at that moment: a funded test wallet, USDT
// liquidity, eligibility and a recovered keeper heartbeat. Balances move from the swap pools, and eligibility
// and the heartbeat are storage overrides.

import {
  createPublicClient, encodeAbiParameters, encodeFunctionData, erc20Abi, http, keccak256, numberToHex, parseAbi,
  type Address, type Hex,
} from "viem";
import { bsc } from "viem/chains";
import { describe, expect, it } from "vitest";
import { batchCalls, planLive, swapSize, type LivePlan, type LiveRequest } from "./live-leverage";
import type { LiveState } from "./live-position";
import { readLiveState } from "./live-state";
import { BLUE, BSC_RPC_URL, controlsContract, dataProviderContract, liveStocks, priceSourceAbi } from "./mainnet";
import { LEVERAGE_LIVE, quotePrice } from "./swap";

const WAD = 10n ** 18n;
const USER = "0x00000000000000000000000000000000000b1e01";
const LENDER = "0x00000000000000000000000000000000000b1e02";
/** PancakeSwap v3 NVDAB/USDT and TSLAB/USDT pools, used only as sources of test balances. */
const STOCK_HOLDER = "0x8FB4243b553aC29BA088aCf00B9B7dA24bD6690C";
const USDT_HOLDER = "0xB0f5E5400E8F0F7C242F2b7740C004f020579c41";

const word = (value: Address | bigint, slot: bigint | Hex) => keccak256(encodeAbiParameters(
  [{ type: typeof value === "bigint" ? "uint256" : "address" }, { type: typeof slot === "bigint" ? "uint256" : "bytes32" }],
  [value, slot],
));

const run = process.env.BLUE_RUN_LIVE_SMOKE === "true" && LEVERAGE_LIVE;

describe.skipIf(!run)("live leverage against BNB Chain", () => {
  it("opens a leveraged position in one batch and closes it in another", async () => {
    const client = createPublicClient({ chain: bsc, transport: http(BSC_RPC_URL) });
    const stock = liveStocks.find(item => item.id === "NVDAB")!;
    const [chain, block, reporter] = await Promise.all([
      readLiveState(client, USER), client.getBlock(),
      client.readContract({ address: stock.source, abi: parseAbi(["function reporter() view returns (address)"]), functionName: "reporter" }),
    ]);
    const live = chain.stocks.find(item => item.id === stock.id)!;
    const ltv = live.withdrawLtv!;
    expect(ltv).toBeGreaterThan(0n);

    const call = (from: Address, to: Address, data: Hex) => ({ from, to, data });
    const transfer = (from: Address, token: Address, to: Address, amount: bigint) =>
      call(from, token, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }));
    const supplied = 2n * WAD / 10n;
    const liquidity = 500n * WAD;
    const setup = { calls: [
      transfer(STOCK_HOLDER, stock.address, USER, supplied),
      transfer(USDT_HOLDER, BLUE.usdt, LENDER, liquidity),
      call(LENDER, BLUE.usdt, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [BLUE.pool, liquidity] })),
      call(LENDER, BLUE.pool, encodeFunctionData({
        abi: parseAbi(["function supply(address,uint256,address,uint16)"]), functionName: "supply", args: [BLUE.usdt, liquidity, LENDER, 0],
      })),
    ] };

    // Price sources accept the latest round, as the keeper would. A source that is already current reverts.
    const refresh = { calls: [BLUE.usdtSource, stock.source].map(source =>
      call(reporter, source, encodeFunctionData({ abi: priceSourceAbi, functionName: "refresh" }))) };

    // StockBorrowControls storage: `_policies` is slot 5 and `_eligibility` slot 7.
    const policy = BigInt(word(stock.address, 5n));
    const heartbeat = block.timestamp - 3_600n | block.timestamp << 64n;
    const eligibility = word(stock.address, word(USER, word(chain.signer, 7n)));
    const overrides = [{ address: BLUE.controls, stateDiff: [
      { slot: numberToHex(policy + 4n, { size: 32 }), value: numberToHex(heartbeat, { size: 32 }) },
      { slot: eligibility, value: numberToHex(block.timestamp + 7_200n, { size: 32 }) },
    ] }];
    const gates = { stateOverrides: overrides, calls: [call(USER, BLUE.controls, encodeFunctionData({
      ...controlsContract, functionName: "riskLimits", args: [stock.address],
    }))] };

    const ready = {
      ...chain, liquidity,
      stocks: chain.stocks.map(item => item.id === stock.id
        ? { ...item, wallet: supplied, eligibleUntil: block.timestamp + 7_200n, limits: [ltv, 400n * WAD] as const }
        : item),
    } as LiveState;

    async function build(state: LiveState, request: LiveRequest) {
      const item = state.stocks.find(entry => entry.id === request.stock)!;
      const oracle = item.price! * WAD / state.usdt.price!;
      const draft = planLive(state, request, { buy: oracle, sell: oracle });
      const size = swapSize(draft)!;
      const quoted = await quotePrice(client, size.side, item, size.amount);
      const plan = planLive(state, request, { buy: size.side === "buy" ? quoted : oracle, sell: size.side === "sell" ? quoted : oracle });
      expect(plan.blocked).toBeNull();
      return plan;
    }
    const batch = (plan: LivePlan) => ({ calls: batchCalls(plan, stock, USER, block.timestamp + 600n)
      .map(item => call(USER, item.to, item.data)) });

    const read = (functionName: "getUserReserveData", asset: Address) => call(USER, dataProviderContract.address,
      encodeFunctionData({ ...dataProviderContract, functionName, args: [asset, USER] }));
    const balance = (token: Address) => call(USER, token, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [USER] }));
    const reads = { calls: [read("getUserReserveData", stock.address), read("getUserReserveData", BLUE.usdt), balance(stock.address), balance(BLUE.usdt)] };
    const word32 = (data: Hex, index: number) => BigInt(`0x${data.slice(2 + index * 64, 66 + index * 64)}`);

    const simulate = async (blocks: Parameters<typeof client.simulateBlocks>[0]["blocks"]) => {
      const results = await client.simulateBlocks({ blocks });
      results.forEach((result, index) => result.calls.forEach((item, position) => {
        // Block 1 is the price refresh, which may find nothing new to accept.
        if (index !== 1) expect(item.status, `block ${index} call ${position}: ${"error" in item ? item.error?.message : ""}`).toBe("success");
      }));
      return results;
    };

    const open = await build(ready, { stock: stock.id, target: 1.6, add: supplied, batch: true });
    const opened = await simulate([setup, refresh, gates, batch(open), reads]);
    const [position, debtData, stockBalance, usdtBalance] = opened[4].calls.map(item => item.data);
    const collateral = word32(position, 0);
    const debt = word32(debtData, 2);
    expect(collateral).toBeGreaterThanOrEqual(open.after.collateral - 10n);
    expect(debt).toBeGreaterThanOrEqual(open.after.debt - 10n);

    const levered = {
      ...ready, debtStock: stock.address, totalBorrowed: debt, liquidity: liquidity - debt,
      usdt: { ...ready.usdt, wallet: BigInt(usdtBalance), reserve: ready.usdt.reserve.map((value, i) => i === 2 ? debt : value) },
      stocks: ready.stocks.map(item => item.id === stock.id ? {
        ...item, wallet: BigInt(stockBalance), debt,
        reserve: item.reserve.map((value, i) => i === 0 ? collateral : i === 8 ? true : value),
      } : item),
    } as unknown as LiveState;
    const close = await build(levered, { stock: stock.id, target: 1, withdrawAll: true, batch: true });
    expect(close.reachable).toBe(true);
    const closed = await simulate([setup, refresh, gates, batch(open), batch(close), reads]);
    const [after, owed] = closed[5].calls.map(item => item.data);
    expect(word32(after, 0)).toBe(0n);
    expect(word32(owed, 2)).toBe(0n);

    console.log({
      status: live.market, openCalls: batch(open).calls.length, leverage: open.resulting, borrowed: Number(open.after.debt) / 1e18,
      closeCalls: batch(close).calls.length,
      openGas: opened[3].calls.reduce((sum, item) => sum + item.gasUsed, 0n),
      closeGas: closed[4].calls.reduce((sum, item) => sum + item.gasUsed, 0n),
    });
  }, 90_000);
});
