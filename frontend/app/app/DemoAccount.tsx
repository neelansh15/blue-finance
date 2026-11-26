"use client";

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { Regime } from "../components/regimes";
import { STARTING_POSITIONS, type Positions } from "./markets";

const DemoAccount = createContext<{
  positions: Positions;
  setPositions: Dispatch<SetStateAction<Positions>>;
  regime: Regime;
  setRegime: Dispatch<SetStateAction<Regime>>;
} | null>(null);

export function DemoAccountProvider({ children }: { children: ReactNode }) {
  const [positions, setPositions] = useState(STARTING_POSITIONS);
  const [regime, setRegime] = useState<Regime>("open");
  return <DemoAccount.Provider value={{ positions, setPositions, regime, setRegime }}>{children}</DemoAccount.Provider>;
}

export function useDemoAccount() {
  const account = useContext(DemoAccount);
  if (!account) throw new Error("DemoAccountProvider is required");
  return account;
}
