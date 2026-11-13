/**
 * Small size-capped LRU map for in-memory caches keyed by user input (tickers, symbols,
 * CIKs…), so a stream of distinct keys can't grow memory without bound. A Map keeps
 * insertion order: `get` re-inserts the key (most recent last), `set` evicts from the front.
 * Pure (no server-only), so it is unit-tested directly.
 */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>();

  constructor(readonly maxSize: number) {
    if (!(maxSize >= 1)) throw new RangeError("LruMap maxSize must be at least 1");
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Returns the value and marks the key most recently used. */
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  /** Reads without changing recency. */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): this {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxSize) this.map.delete(this.map.keys().next().value as K);
    return this;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this.map.entries();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.map.entries();
  }
}

/**
 * A process-wide LRU stored on globalThis (shared across Next.js route bundles and dev HMR).
 * If an older build left a plain Map under the same name, it is replaced.
 */
export function globalLru<K, V>(name: string, maxSize: number): LruMap<K, V> {
  const g = globalThis as unknown as Record<string, unknown>;
  const cur = g[name];
  if (cur instanceof LruMap && cur.maxSize === maxSize) return cur as LruMap<K, V>;
  const next = new LruMap<K, V>(maxSize);
  if (cur instanceof Map || cur instanceof LruMap) for (const [k, v] of cur as Iterable<[K, V]>) next.set(k, v);
  g[name] = next;
  return next;
}
