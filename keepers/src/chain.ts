import { createPublicClient, createWalletClient, defineChain, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

export function makeChain(id: number, rpcUrl: string) {
  if (id === 56) return { ...bsc, rpcUrls: { default: { http: [rpcUrl] } } };
  return defineChain({
    id,
    name: `chain-${id}`,
    nativeCurrency: { name: "Native", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function makeClients(rpcUrl: string, chainId: number, privateKey?: `0x${string}`) {
  const chain = makeChain(chainId, rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;
  const account = privateKey ? privateKeyToAccount(privateKey) : undefined;
  const walletClient = account ? createWalletClient({ account, chain, transport: http(rpcUrl) }) : undefined;
  return { publicClient, walletClient, account, chain };
}
