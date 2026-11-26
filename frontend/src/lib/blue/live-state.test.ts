import { describe, expect, it } from "vitest";
import { createPublicClient, hashTypedData, http, isAddressEqual, zeroAddress } from "viem";
import { bsc } from "viem/chains";
import { readLiveState } from "./live-state";
import { BLUE, BSC_RPC_URL, controlsContract, eligibilityDomain, eligibilityTypes, liveStocks, parseTokenAmount, poolContract } from "./mainnet";

describe("live token input", () => {
  it("preserves 18-decimal precision and rejects excess precision and exponent input", () => {
    expect(parseTokenAmount("123.000000000000000001")).toBe(123_000_000_000_000_000_001n);
    for (const value of ["", "0", "-1", "1e3", "0.0000000000000000001"]) {
      expect(parseTokenAmount(value)).toBeUndefined();
    }
  });
});

it.skipIf(process.env.BLUE_RUN_LIVE_SMOKE !== "true")("reads all six deployed reserves and account data from BNB Chain", async () => {
  const client = createPublicClient({ chain: bsc, transport: http(BSC_RPC_URL) });
  expect(await client.getChainId()).toBe(56);
  const account = "0xf475D99Be3241c69454eA8AF7B12F38078F697bc";
  const stock = liveStocks[0].address;
  const [assets, disconnected, connected, digest] = await Promise.all([
    client.readContract({ ...poolContract, functionName: "getReservesList" }),
    readLiveState(client),
    readLiveState(client, account),
    client.readContract({ ...controlsContract, functionName: "eligibilityDigest", args: [account, stock, 0n, 1n] }),
  ]);
  const expected = [BLUE.usdt, ...liveStocks.map(stock => stock.address)];
  expect(assets.map(asset => asset.toLowerCase())).toEqual(expected.map(asset => asset.toLowerCase()));
  expect(disconnected.caps).toEqual([1_000n, 1_000n]);
  expect(disconnected.stocks).toHaveLength(5);
  expect(disconnected.stocks.every(stock => stock.market !== undefined)).toBe(true);
  expect(connected.usdt.wallet).toBeGreaterThanOrEqual(0n);
  expect(isAddressEqual(connected.signer, zeroAddress)).toBe(false);
  expect(digest).toBe(hashTypedData({
    domain: eligibilityDomain, types: eligibilityTypes, primaryType: "Eligibility",
    message: { account, pool: BLUE.pool, stock, nonce: 0n, expiry: 1n },
  }));
}, 25_000);
