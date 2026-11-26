"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createBlueClient, type BlueClient, type PoolState } from "../../src/lib/blue/client";

type DemoAccountValue = { client: BlueClient; state: PoolState };

const DemoAccount = createContext<DemoAccountValue | null>(null);

/** One simulated pool shared by every app page, so demo controls affect Borrow, Earn and the dashboard alike. */
export function DemoAccountProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => createBlueClient());
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);

  // Follow the US Eastern clock after hydration, then re-check every minute.
  useEffect(() => {
    client.demo.syncClock();
    const timer = setInterval(() => client.demo.syncClock(), 60_000);
    return () => clearInterval(timer);
  }, [client]);

  return <DemoAccount.Provider value={{ client, state }}>{children}</DemoAccount.Provider>;
}

export function useDemoAccount() {
  const account = useContext(DemoAccount);
  if (!account) throw new Error("DemoAccountProvider is required");
  return account;
}
