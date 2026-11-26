/** Per-process, bounded one-minute cache. Pending work and failures are shared too. */
export const API_CACHE_MS = 60_000;
export class ApiCache<T> {
  private entries = new Map<string, { at: number; pending: boolean; value: Promise<T> }>();
  constructor(private readonly clock = () => performance.now(), private readonly maxEntries = 256) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.clock();
    const hit = this.entries.get(key);
    if (hit && (hit.pending || now - hit.at >= 0 && now - hit.at < API_CACHE_MS)) return hit.value;
    this.entries.delete(key);
    for (const [id, entry] of this.entries) {
      if (!entry.pending && (now - entry.at >= API_CACHE_MS || now < entry.at)) this.entries.delete(id);
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = [...this.entries].find(([, entry]) => !entry.pending);
      if (oldest) this.entries.delete(oldest[0]);
      else return Promise.reject(new Error("API cache is busy"));
    }
    const entry = { at: now, pending: true, value: Promise.resolve().then(load) };
    this.entries.set(key, entry);
    // A rejection stays a rejection; never substitute an older successful value.
    void entry.value.then(() => { entry.pending = false; }, () => { entry.pending = false; });
    return entry.value;
  }
}
