import { ApiCache } from "../apiCache.js";
import type { FetchLike } from "./types.js";

export const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

const caches = new WeakMap<FetchLike, ApiCache<string>>();

export function getText(
  f: FetchLike,
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 10_000,
): Promise<string> {
  let cache = caches.get(f);
  if (!cache) { cache = new ApiCache<string>(); caches.set(f, cache); }
  const key = JSON.stringify([url, Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)), timeoutMs]);
  return cache.get(key, () => fetchText(f, url, headers, timeoutMs));
}

export async function fetchText(
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
