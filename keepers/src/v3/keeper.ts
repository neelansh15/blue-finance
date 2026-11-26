import { BaseError, type Address } from "viem";
import type { Signal } from "../halt/types.js";
import { stocks, usdtSource } from "./contracts.js";

export type Stock = (typeof stocks)[number];

export interface KeeperOperations {
  signals(stock: Stock): Promise<readonly Signal[]>;
  status(stock: Stock): Promise<number>;
  multiplierChanged(stock: Stock): Promise<boolean>;
  ensurePrice(source: Address): Promise<boolean>;
  report(stock: Stock, healthy: boolean): Promise<void>;
  override(stock: Stock, status: 4 | 5): Promise<void>;
}

export function errorSummary(error: unknown): string {
  return error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : "Unknown error";
}

export function createKeeper(operations: KeeperOperations, log: (message: string) => void = console.log) {
  const lastReport = new Map<Address, boolean>();

  async function report(stock: Stock, healthy: boolean) {
    if (!healthy && lastReport.get(stock.token) === false) return;
    await operations.report(stock, healthy);
    lastReport.set(stock.token, healthy);
  }

  return async (markets: readonly Stock[]) => {
    // Gather conditions before signing anything. Keep writes sequential for the keeper nonce.
    const observations = await Promise.allSettled(markets.map(async stock => {
      const [signals, status, multiplierChanged] = await Promise.all([
        operations.signals(stock), operations.status(stock), operations.multiplierChanged(stock),
      ]);
      return { stock, signals, status, multiplierChanged };
    }));

    let usdtReady: boolean | undefined;
    for (const [index, observation] of observations.entries()) {
      const stock = markets[index]!;
      try {
        if (observation.status === "rejected") throw observation.reason;
        const { signals, status, multiplierChanged } = observation.value;
        const restriction = multiplierChanged || signals.some(signal => signal.state === "corp_action")
          ? 5 : signals.some(signal => signal.state === "halted") ? 4 : undefined;
        if (restriction !== undefined) {
          // A failed override still resets this stock's heartbeat.
          try {
            await operations.override(stock, restriction);
          } finally {
            await report(stock, false);
          }
          log(`${stock.symbol}: ${restriction === 5 ? "corporate action" : "halt"}`);
          continue;
        }
        if (status >= 4 || signals.length === 0 || signals.some(signal => signal.state !== "ok")) {
          await report(stock, false);
          log(`${stock.symbol}: market checks blocked: ${signals.filter(s => s.state !== "ok").map(s => s.detail).join("; ")}`);
          continue;
        }
        usdtReady ??= await operations.ensurePrice(usdtSource);
        const healthy = usdtReady && await operations.ensurePrice(stock.source);
        await report(stock, healthy);
        log(`${stock.symbol}: ${healthy ? "reported healthy" : "price not ready"}`);
      } catch (error) {
        log(`${stock.symbol}: ${errorSummary(error)}`);
        try {
          await report(stock, false);
        } catch (resetError) {
          log(`${stock.symbol}: heartbeat reset failed: ${errorSummary(resetError)}`);
        }
      }
    }
  };
}
