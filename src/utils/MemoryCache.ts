export type MemoryCacheEvictionReason =
  | 'expired'
  | 'capacity'
  | 'weight'
  | 'delete'
  | 'clear'
  | 'replace';

export type MemoryCacheOptions<K, V> = {
  maxEntries: number;
  ttlMs: number;
  maxWeight?: number;
  weightOf?: (key: K, value: V) => number;
  isProtected?: (key: K, value: V) => boolean;
  onEvict?: (key: K, value: V, reason: MemoryCacheEvictionReason) => void;
};

type CacheEntry<V> = {
  value: V;
  expiresAt: number;
  weight: number;
};

export type MemoryCacheStats = {
  size: number;
  weight: number;
  hits: number;
  misses: number;
  evictions: number;
  weightEvictions: number;
  expired: number;
  maxEntries: number;
  maxWeight: number;
  ttlMs: number;
};

export class MemoryCache<K, V> {
  private readonly store = new Map<K, CacheEntry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private maxWeight: number;
  private readonly weightOf: (key: K, value: V) => number;
  private readonly isProtected?: (key: K, value: V) => boolean;
  private readonly onEvict?: (key: K, value: V, reason: MemoryCacheEvictionReason) => void;
  private currentWeight = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private weightEvictions = 0;
  private expired = 0;

  constructor({
    maxEntries,
    ttlMs,
    maxWeight = Number.POSITIVE_INFINITY,
    weightOf = () => 1,
    isProtected,
    onEvict,
  }: MemoryCacheOptions<K, V>) {
    this.maxEntries = Math.max(0, maxEntries);
    this.ttlMs = Math.max(0, ttlMs);
    this.maxWeight = this.normalizeMaxWeight(maxWeight);
    this.weightOf = weightOf;
    this.isProtected = isProtected;
    this.onEvict = onEvict;
  }

  private normalizeMaxWeight(weight: number) {
    if (weight === Number.POSITIVE_INFINITY) {
      return weight;
    }
    return Number.isFinite(weight) ? Math.max(0, weight) : 0;
  }

  private resolveWeight(key: K, value: V) {
    const weight = this.weightOf(key, value);
    return Number.isFinite(weight) ? Math.max(0, weight) : 0;
  }

  private isExpired(entry: CacheEntry<V>, now: number) {
    return entry.expiresAt <= now;
  }

  private removeEntry(key: K, reason: MemoryCacheEvictionReason) {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }

    this.store.delete(key);
    this.currentWeight = Math.max(0, this.currentWeight - entry.weight);

    if (reason === 'expired') {
      this.expired += 1;
    } else if (reason === 'capacity' || reason === 'weight') {
      this.evictions += 1;
      if (reason === 'weight') {
        this.weightEvictions += 1;
      }
    }

    try {
      this.onEvict?.(key, entry.value, reason);
    } catch {}
    return true;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    const now = Date.now();
    if (this.isExpired(entry, now)) {
      this.removeEntry(key, 'expired');
      this.misses += 1;
      return undefined;
    }

    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: K, value: V, options: { ttlMs?: number } = {}) {
    if (this.store.has(key)) {
      this.removeEntry(key, 'replace');
    }

    const ttlMs = Math.max(0, options.ttlMs ?? this.ttlMs);
    const weight = this.resolveWeight(key, value);
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      weight,
    });
    this.currentWeight += weight;

    this.prune();
  }

  has(key: K) {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }

    if (this.isExpired(entry, Date.now())) {
      this.removeEntry(key, 'expired');
      return false;
    }

    return true;
  }

  delete(key: K) {
    return this.removeEntry(key, 'delete');
  }

  deleteWhere(predicate: (key: K, value: V) => boolean) {
    let deleted = 0;
    for (const [key, entry] of this.store) {
      if (predicate(key, entry.value) && this.removeEntry(key, 'delete')) {
        deleted += 1;
      }
    }
    return deleted;
  }

  clear() {
    for (const key of Array.from(this.store.keys())) {
      this.removeEntry(key, 'clear');
    }
  }

  setMaxWeight(maxWeight: number) {
    this.maxWeight = this.normalizeMaxWeight(maxWeight);
    this.prune();
  }

  prune() {
    const now = Date.now();

    for (const [key, entry] of this.store) {
      if (this.isExpired(entry, now)) {
        this.removeEntry(key, 'expired');
      }
    }

    while (this.store.size > this.maxEntries || this.currentWeight > this.maxWeight) {
      const exceedsWeight = this.currentWeight > this.maxWeight;
      let evictionKey: K | undefined;

      for (const [key, entry] of this.store) {
        if (!this.isProtected?.(key, entry.value)) {
          evictionKey = key;
          break;
        }
      }

      if (evictionKey === undefined) {
        break;
      }

      this.removeEntry(evictionKey, exceedsWeight ? 'weight' : 'capacity');
    }
  }

  size() {
    this.prune();
    return this.store.size;
  }

  snapshot() {
    this.prune();
    return new Map(
      Array.from(this.store.entries(), ([key, entry]) => [key, entry.value] as const),
    );
  }

  stats(): MemoryCacheStats {
    this.prune();
    return {
      size: this.store.size,
      weight: this.currentWeight,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      weightEvictions: this.weightEvictions,
      expired: this.expired,
      maxEntries: this.maxEntries,
      maxWeight: this.maxWeight,
      ttlMs: this.ttlMs,
    };
  }
}
