export type SignalState = "ok" | "halted" | "corp_action" | "unknown";

export interface Signal {
  state: SignalState;
  detail: string;
}

export interface AssetRef {
  /** bStock symbol, e.g. TSLAB */
  symbol: string;
  /** Underlying US ticker, e.g. TSLA (Nasdaq halt feed key) */
  ticker: string;
  /** bStock token on BNB Chain (the registry asset key) */
  token: `0x${string}`;
  /** Binance Spot symbol, e.g. TSLABUSDT. Defaults to `${symbol}USDT`. */
  spotSymbol?: string;
}

export interface HaltSource {
  readonly name: string;
  check(asset: AssetRef, nowMs: number): Promise<Signal>;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export const ok = (detail: string): Signal => ({ state: "ok", detail });
export const unknown = (detail: string): Signal => ({ state: "unknown", detail });
export const halted = (detail: string): Signal => ({ state: "halted", detail });
export const corpAction = (detail: string): Signal => ({ state: "corp_action", detail });
