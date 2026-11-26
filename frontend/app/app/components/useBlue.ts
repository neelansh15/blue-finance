"use client";

import { useDemoAccount } from "../DemoAccount";
import type { BlueClient, PoolState } from "../../../src/lib/blue/client";

/** The shared simulated pool client and its current state. */
export function useBlue(): { client: BlueClient; state: PoolState } {
  return useDemoAccount();
}
