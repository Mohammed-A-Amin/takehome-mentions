type CacheEntry<T> = { value: T; fetchedAt: number };

/**
 * Small, in-memory LRU cache for async query results.
 *
 * It owns cache recency, freshness checks, and in-flight request deduplication
 * without assuming a particular data source. People uses it today; a remote
 * Pages or Dates source can reuse the same lifecycle and invalidate entries
 * after a mutation.
 */
export class QueryCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Return a cached value only when it is no older than the requested TTL. */
  getFresh(key: string, maxAgeMs: number): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || this.now() - entry.fetchedAt > maxAgeMs) return undefined;
    this.touch(key, entry);
    return entry.value;
  }

  /** Return a possibly stale value within a bounded fallback window. */
  getStale(key: string, maxAgeMs: number): T | undefined {
    return this.getFresh(key, maxAgeMs);
  }

  /**
   * Run one loader per key. Concurrent callers share its promise; successful
   * responses enter the LRU cache and failed responses remain uncached.
   */
  getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const request = load()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  /** Remove one cached value after a write invalidates it. */
  invalidate(key: string): void {
    this.entries.delete(key);
  }

  /** Remove every value when a broad mutation invalidates the whole source. */
  clear(): void {
    this.entries.clear();
  }

  private set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, fetchedAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }

  private touch(key: string, entry: CacheEntry<T>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}
