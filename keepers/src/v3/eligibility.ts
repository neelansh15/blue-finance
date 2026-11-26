import { getAddress, isAddress, isAddressEqual, type Address } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { makeReader } from "./chain.js";
import { controls, domain, pool, stocks, types } from "./contracts.js";

export class EligibilityError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function makeEligibilitySigner(
  reader: Pick<ReturnType<typeof makeReader>, "readContract" | "getBlock">,
  signer: PrivateKeyAccount,
  allowlist: ReadonlySet<string>,
  markets: readonly (typeof stocks)[number][],
) {
  return async (input: unknown) => {
    if (!input || typeof input !== "object" || !("account" in input) || !("stock" in input) ||
        typeof input.account !== "string" || !isAddress(input.account) ||
        typeof input.stock !== "string" || !isAddress(input.stock)) {
      throw new EligibilityError(400, "Provide a valid wallet and stock address.");
    }
    const account = getAddress(input.account);
    if (!allowlist.has(account.toLowerCase())) throw new EligibilityError(403, "This wallet is outside the demo allowlist.");
    const stock = markets.find(asset => isAddressEqual(asset.token, input.stock as Address))?.token;
    if (!stock) throw new EligibilityError(400, "This stock is outside the automated market list.");

    const [block, nonce, activeSigner, maxEligibility] = await Promise.all([
      reader.getBlock(),
      reader.readContract({ ...controls, functionName: "nonces", args: [account] }),
      reader.readContract({ ...controls, functionName: "signer" }),
      reader.readContract({ ...controls, functionName: "maxEligibility" }),
    ]);
    if (!isAddressEqual(activeSigner, signer.address)) throw new EligibilityError(503, "The on-chain signer changed.");
    const expiry = block.timestamp + BigInt(Math.min(maxEligibility, 3_600));
    const signature = await signer.signTypedData({
      domain, types, primaryType: "Eligibility", message: { account, pool, stock, nonce, expiry },
    });
    return { account, stock, nonce: nonce.toString(), expiry: expiry.toString(), signature };
  };
}
