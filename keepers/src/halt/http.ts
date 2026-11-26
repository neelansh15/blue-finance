import type { FetchLike } from "./types.js";

export const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

export async function getText(
  f: FetchLike,
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 10_000,
): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await f(url, { headers, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function getJson(f: FetchLike, url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<unknown> {
  const text = await getText(f, url, headers, timeoutMs);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid JSON");
  }
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
