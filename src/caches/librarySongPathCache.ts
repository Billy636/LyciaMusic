import { MemoryCache, type MemoryCacheStats } from '../utils/MemoryCache';

export type LibrarySongPathCacheNamespace = 'all' | 'folder' | 'detail' | 'collection';

export type LibrarySongPathCacheEntry = {
  paths: string[];
  titleLabels?: Map<string, string>;
};

export const LIBRARY_SONG_PATH_CACHE_MAX_ENTRIES = 192;
export const LIBRARY_SONG_PATH_CACHE_MAX_WEIGHT = 16 * 1024 * 1024;
export const LIBRARY_SONG_PATH_CACHE_LOW_POWER_MAX_WEIGHT = 8 * 1024 * 1024;

const CACHE_ENTRY_BASE_WEIGHT = 64;
const ARRAY_BASE_WEIGHT = 24;
const ARRAY_ITEM_WEIGHT = 8;
const STRING_BASE_WEIGHT = 24;
const MAP_BASE_WEIGHT = 48;
const MAP_ENTRY_WEIGHT = 48;

const estimateStringWeight = (value: string) => STRING_BASE_WEIGHT + value.length * 2;

export function estimateLibrarySongPathCacheWeight(
  cacheKey: string,
  entry: LibrarySongPathCacheEntry,
) {
  let weight = CACHE_ENTRY_BASE_WEIGHT
    + estimateStringWeight(cacheKey)
    + ARRAY_BASE_WEIGHT
    + entry.paths.length * ARRAY_ITEM_WEIGHT;

  for (const path of entry.paths) {
    weight += estimateStringWeight(path);
  }

  if (entry.titleLabels) {
    weight += MAP_BASE_WEIGHT + entry.titleLabels.size * MAP_ENTRY_WEIGHT;
    for (const label of entry.titleLabels.values()) {
      // Map keys reuse the path strings already counted above.
      weight += estimateStringWeight(label);
    }
  }

  return weight;
}

const makeCacheKey = (namespace: LibrarySongPathCacheNamespace, key: string) =>
  `${namespace}\u0000${key}`;

const belongsToNamespace = (cacheKey: string, namespace: LibrarySongPathCacheNamespace) =>
  cacheKey.startsWith(`${namespace}\u0000`);

type LibrarySongPathCacheOptions = {
  maxEntries?: number;
  maxWeight?: number;
  lowPowerMaxWeight?: number;
};

export class LibrarySongPathCache {
  private activeCacheKey: string | null = null;
  private activeEntry: LibrarySongPathCacheEntry | null = null;
  private readonly normalMaxWeight: number;
  private readonly lowPowerMaxWeight: number;
  private readonly cache: MemoryCache<string, LibrarySongPathCacheEntry>;

  constructor({
    maxEntries = LIBRARY_SONG_PATH_CACHE_MAX_ENTRIES,
    maxWeight = LIBRARY_SONG_PATH_CACHE_MAX_WEIGHT,
    lowPowerMaxWeight = LIBRARY_SONG_PATH_CACHE_LOW_POWER_MAX_WEIGHT,
  }: LibrarySongPathCacheOptions = {}) {
    this.normalMaxWeight = maxWeight;
    this.lowPowerMaxWeight = Math.min(maxWeight, lowPowerMaxWeight);
    this.cache = new MemoryCache({
      maxEntries,
      maxWeight,
      ttlMs: 10 * 60 * 1000,
      weightOf: estimateLibrarySongPathCacheWeight,
      // The currently displayed query stays hot even when it alone exceeds the
      // background budget. Older results remain eligible for weighted LRU.
      isProtected: key => key === this.activeCacheKey,
      onEvict: key => {
        if (key === this.activeCacheKey) {
          this.activeEntry = null;
        }
      },
    });
  }

  activate(namespace: LibrarySongPathCacheNamespace, key: string) {
    const nextCacheKey = makeCacheKey(namespace, key);
    if (this.activeCacheKey !== nextCacheKey) {
      this.activeEntry = null;
    }
    this.activeCacheKey = nextCacheKey;
    this.cache.prune();
  }

  get(namespace: LibrarySongPathCacheNamespace, key: string) {
    const cacheKey = makeCacheKey(namespace, key);
    const entry = this.cache.get(cacheKey);
    if (this.activeCacheKey === cacheKey) {
      this.activeEntry = entry ?? null;
    }
    return entry;
  }

  set(
    namespace: LibrarySongPathCacheNamespace,
    key: string,
    entry: LibrarySongPathCacheEntry,
    ttlMs: number,
  ) {
    const cacheKey = makeCacheKey(namespace, key);
    this.cache.set(cacheKey, entry, { ttlMs });
    if (this.activeCacheKey === cacheKey) {
      this.activeEntry = entry;
    }
  }

  getActive(namespace: LibrarySongPathCacheNamespace) {
    if (!this.activeCacheKey || !belongsToNamespace(this.activeCacheKey, namespace)) {
      return undefined;
    }
    return this.activeEntry ?? undefined;
  }

  clearNamespace(namespace: LibrarySongPathCacheNamespace) {
    if (this.activeCacheKey && belongsToNamespace(this.activeCacheKey, namespace)) {
      this.activeCacheKey = null;
      this.activeEntry = null;
    }
    this.cache.deleteWhere(key => belongsToNamespace(key, namespace));
  }

  clear() {
    this.activeCacheKey = null;
    this.activeEntry = null;
    this.cache.clear();
  }

  setLowPower(lowPower: boolean) {
    this.cache.setMaxWeight(lowPower ? this.lowPowerMaxWeight : this.normalMaxWeight);
  }

  stats(): MemoryCacheStats {
    return this.cache.stats();
  }
}

const librarySongPathCache = new LibrarySongPathCache();

export const activateLibrarySongPathCacheEntry = (
  namespace: LibrarySongPathCacheNamespace,
  key: string,
) => librarySongPathCache.activate(namespace, key);

export const getLibrarySongPathCacheEntry = (
  namespace: LibrarySongPathCacheNamespace,
  key: string,
) => librarySongPathCache.get(namespace, key);

export const getActiveLibrarySongPathCacheEntry = (
  namespace: LibrarySongPathCacheNamespace,
) => librarySongPathCache.getActive(namespace);

export const setLibrarySongPathCacheEntry = (
  namespace: LibrarySongPathCacheNamespace,
  key: string,
  entry: LibrarySongPathCacheEntry,
  ttlMs: number,
) => librarySongPathCache.set(namespace, key, entry, ttlMs);

export const clearLibrarySongPathCacheNamespace = (
  namespace: LibrarySongPathCacheNamespace,
) => librarySongPathCache.clearNamespace(namespace);

export const setLibrarySongPathCacheLowPower = (lowPower: boolean) =>
  librarySongPathCache.setLowPower(lowPower);

export const getLibrarySongPathCacheStats = () => librarySongPathCache.stats();
