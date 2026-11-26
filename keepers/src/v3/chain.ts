import { createPublicClient, createWalletClient, http, isAddressEqual, type Address } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { calendar, chainId, controls, sourceAbi, stockAbi, usdtSource } from "./contracts.js";
import { errorSummary, type KeeperOperations, type Stock } from "./keeper.js";

export const makeReader = (url: string) => createPublicClient({
  chain: bsc, transport: http(url, { timeout: 12_000, retryCount: 1 }),
});

export async function verifyRoles(
  reader: ReturnType<typeof makeReader>, keeper: Address, signer: Address, markets: readonly Stock[], intervalMs: number,
) {
  const [network, keeperAddress, signerAddress, calendarKeeper, heartbeat, ...reporters] = await Promise.all([
    reader.getChainId(),
    reader.readContract({ ...controls, functionName: "keeper" }),
    reader.readContract({ ...controls, functionName: "signer" }),
    reader.readContract({ ...calendar, functionName: "isKeeper", args: [keeper] }),
    reader.readContract({ ...controls, functionName: "heartbeat" }),
    ...[usdtSource, ...markets.map(stock => stock.source)].map(address =>
      reader.readContract({ address, abi: sourceAbi, functionName: "reporter" })),
  ]);
  if (network !== chainId) throw new Error(`Set BLUE_BSC_RPC_URL to BNB Smart Chain (chain ID ${chainId}).`);
  if (!isAddressEqual(keeperAddress, keeper)) throw new Error(`Assign ${keeper} as the on-chain keeper.`);
  if (!isAddressEqual(signerAddress, signer)) throw new Error(`Assign ${signer} as the on-chain eligibility signer.`);
  if (!calendarKeeper) throw new Error(`Register ${keeper} as a calendar keeper.`);
  if (reporters.some(address => !isAddressEqual(address, keeper))) {
    throw new Error(`Assign ${keeper} as reporter on the USDT and selected stock price sources.`);
  }
  if (intervalMs * 2 >= heartbeat * 1_000) throw new Error("Keeper poll interval leaves too little time before the on-chain heartbeat.");
}

export function createChainOperations(
  reader: ReturnType<typeof makeReader>,
  rpcUrl: string,
  account: PrivateKeyAccount,
  signal: AbortSignal,
  log: (message: string) => void = console.log,
): Omit<KeeperOperations, "signals"> {
  const wallet = createWalletClient({ account, chain: bsc, transport: http(rpcUrl, { timeout: 12_000, retryCount: 1 }) });
  const send = async (request: Parameters<typeof wallet.writeContract>[0]) => {
    signal.throwIfAborted();
    const hash = await wallet.writeContract(request);
    const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 45_000 });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
    log(`Confirmed ${hash}`);
  };

  return {
    status: stock => reader.readContract({ ...calendar, functionName: "status", args: [stock.token] }),
    async multiplierChanged(stock) {
      const [accepted, current] = await Promise.all([
        reader.readContract({ address: stock.source, abi: sourceAbi, functionName: "multiplier" }),
        reader.readContract({ address: stock.token, abi: stockAbi, functionName: "uiMultiplier" }),
      ]);
      // A zero multiplier means the source has never accepted a round.
      return accepted !== 0n && accepted !== current;
    },
    async ensurePrice(address) {
      const source = { address, abi: sourceAbi } as const;
      const ready = () => reader.readContract({ ...source, functionName: "usableForBorrow" });
      if (await ready()) return true;
      try {
        const { request } = await reader.simulateContract({ ...source, functionName: "refresh", account });
        await send(request);
        return await ready();
      } catch (error) {
        log(`Price source ${address}: ${errorSummary(error)}`);
        return false;
      }
    },
    async report(stock, healthy) {
      const { request } = await reader.simulateContract({
        ...controls, functionName: "report", args: [stock.token, healthy], account,
      });
      await send(request);
    },
    async override(stock, status) {
      const [block, [existing, expiry]] = await Promise.all([
        reader.getBlock(),
        reader.readContract({ ...calendar, functionName: "overrideOf", args: [stock.token] }),
      ]);
      // Keep a confirmed halt active with short overrides. The keeper never shortens or clears one.
      if (expiry > block.timestamp) {
        if (existing === 4 && status === 5) return;
        if (existing === status && expiry > block.timestamp + 300n) return;
        if (expiry >= block.timestamp + 900n) return;
      }
      const { request } = await reader.simulateContract({
        ...calendar, functionName: "setOverride", args: [stock.token, status, 900n], account,
      });
      await send(request);
    },
  };
}
