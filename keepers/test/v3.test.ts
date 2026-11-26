import { describe, expect, it, vi } from "vitest";
import { recoverTypedDataAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { makeReader } from "../src/v3/chain.js";
import { domain, pool, stocks, types, usdtSource } from "../src/v3/contracts.js";
import { makeEligibilitySigner } from "../src/v3/eligibility.js";
import { createKeeper, type KeeperOperations } from "../src/v3/keeper.js";
import { corpAction, ok, unknown } from "../src/halt/types.js";

const stock = stocks[0]!;
const secondStock = stocks[1]!;
const borrower = "0xf475D99Be3241c69454eA8AF7B12F38078F697bc";

function keeper() {
  const operations = {
    signals: vi.fn<KeeperOperations["signals"]>().mockResolvedValue([ok("exchange"), ok("issuer")]),
    status: vi.fn<KeeperOperations["status"]>().mockResolvedValue(0),
    multiplierChanged: vi.fn<KeeperOperations["multiplierChanged"]>().mockResolvedValue(false),
    ensurePrice: vi.fn<KeeperOperations["ensurePrice"]>().mockResolvedValue(true),
    report: vi.fn<KeeperOperations["report"]>().mockResolvedValue(undefined),
    override: vi.fn<KeeperOperations["override"]>().mockResolvedValue(undefined),
  };
  return { operations, tick: createKeeper(operations, () => {}) };
}

describe("V3 keeper", () => {
  it("checks USDT once per tick and reports healthy for each ready stock", async () => {
    const { operations, tick } = keeper();
    await tick([stock, secondStock]);
    expect(operations.ensurePrice.mock.calls).toEqual([[usdtSource], [stock.source], [secondStock.source]]);
    expect(operations.report.mock.calls).toEqual([[stock, true], [secondStock, true]]);
  });

  it("resets an unhealthy stock, avoids repeated reset writes and resumes heartbeat when its inputs recover", async () => {
    const { operations, tick } = keeper();
    await tick([stock]);
    operations.signals.mockResolvedValue([ok("exchange"), unknown("issuer unavailable")]);
    await tick([stock]);
    await tick([stock]);
    operations.signals.mockResolvedValue([ok("exchange"), ok("issuer")]);
    await tick([stock]);
    expect(operations.report.mock.calls).toEqual([[stock, true], [stock, false], [stock, true]]);
  });

  it("publishes a confirmed corporate action and skips refreshing that price after a multiplier change", async () => {
    const { operations, tick } = keeper();
    operations.multiplierChanged.mockResolvedValue(true);
    operations.signals.mockResolvedValue([ok("exchange"), corpAction("split")]);
    operations.override.mockRejectedValue(new Error("existing override"));
    await tick([stock]);
    expect(operations.override).toHaveBeenCalledWith(stock, 5);
    expect(operations.ensurePrice).not.toHaveBeenCalled();
    expect(operations.report.mock.calls).toEqual([[stock, false]]);
  });

  it("resets all stocks if USDT is stale", async () => {
    const { operations, tick } = keeper();
    operations.ensurePrice.mockResolvedValue(false);
    await tick([stock, secondStock]);
    expect(operations.ensurePrice.mock.calls).toEqual([[usdtSource]]);
    expect(operations.report.mock.calls).toEqual([[stock, false], [secondStock, false]]);
  });
});

describe("V3 eligibility", () => {
  function fixture(active?: Address) {
    const signer = privateKeyToAccount(generatePrivateKey());
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "nonces") return 7n;
      if (functionName === "maxEligibility") return 1800;
      return active ?? signer.address;
    });
    const reader = {
      readContract, getBlock: vi.fn().mockResolvedValue({ timestamp: 12_345n }),
    } as unknown as Pick<ReturnType<typeof makeReader>, "readContract" | "getBlock">;
    return {
      signer, readContract, sign: makeEligibilitySigner(reader, signer, new Set([borrower.toLowerCase()]), [stock]),
    };
  }
  it("signs the active contract, current nonce and selected stock for a bounded duration", async () => {
    const { signer, sign } = fixture();
    const result = await sign({ account: borrower, stock: stock.token });
    expect(result.expiry).toBe("14145");
    expect(result.nonce).toBe("7");
    expect(await recoverTypedDataAddress({
      domain, types, primaryType: "Eligibility", signature: result.signature,
      message: { account: borrower, pool, stock: stock.token, nonce: 7n, expiry: 14_145n },
    })).toBe(signer.address);
  });

  it("rejects unapproved wallets and unknown stocks before calling the RPC", async () => {
    const { readContract, sign } = fixture();
    await expect(sign({ account: stock.token, stock: stock.token })).rejects.toMatchObject({ status: 403 });
    await expect(sign({ account: borrower, stock: secondStock.token })).rejects.toMatchObject({ status: 400 });
    expect(readContract).not.toHaveBeenCalled();
  });

  it("fails closed after an onchain signer rotation", async () => {
    const { sign } = fixture(stock.token);
    await expect(sign({ account: borrower, stock: stock.token })).rejects.toMatchObject({ status: 503 });
  });
});
