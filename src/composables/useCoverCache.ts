import { reactive } from 'vue';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { MemoryCache } from '../utils/MemoryCache';

type CoverKind = 'thumbnail' | 'full';
type PreloadPriority = 'priority' | 'background';

const THUMBNAIL_CACHE_LIMIT = 64;
const FULL_COVER_CACHE_LIMIT = 4;
const THUMBNAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const FULL_COVER_CACHE_TTL_MS = 2 * 60 * 1000;
const HIDDEN_THUMBNAIL_CACHE_LIMIT = 12;
const PRELOAD_CONCURRENCY = 4;
const BACKGROUND_PRELOAD_CONCURRENCY = 1;
const BACKGROUND_FULL_PRELOAD_CONCURRENCY = 1;
const FAILURE_RETRY_MS = 10_000;

// Small in-memory LRU for thumbnail URLs. The actual image files live on disk.
const thumbnailCache = reactive(new Map<string, string>());
const fullCoverCache = reactive(new Map<string, string>());
const thumbnailPathCache = new Map<string, string>();
const fullCoverPathCache = new Map<string, string>();
const thumbnailCacheExpiry = new Map<string, number>();
const fullCoverCacheExpiry = new Map<string, number>();
const loadingSet = reactive(new Set<string>());
const inFlightRequests = new Map<string, Promise<string>>();
const recentFailureCache = new MemoryCache<string, true>({
  maxEntries: 256,
  ttlMs: FAILURE_RETRY_MS,
});
const priorityPreloadQueue: string[] = [];
const backgroundPreloadQueue: string[] = [];
const queuedPathPriority = new Map<string, PreloadPriority>();
const backgroundFullPreloadQueue: string[] = [];
const queuedBackgroundFullPaths = new Set<string>();
let activeBackgroundFullPreloadCount = 0;
let backgroundPreloadTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundPreloadIdleId: number | null = null;
let cachePruneTimer: ReturnType<typeof setTimeout> | null = null;
let hasRegisteredVisibilityCleanup = false;
const cacheEpochs: Record<CoverKind, number> = {
  thumbnail: 0,
  full: 0,
};
const invalidatedRequestKeys = new Set<string>();

const getCacheForKind = (kind: CoverKind) =>
  kind === 'full' ? fullCoverCache : thumbnailCache;
const getPathCacheForKind = (kind: CoverKind) =>
  kind === 'full' ? fullCoverPathCache : thumbnailPathCache;
const getCacheExpiryForKind = (kind: CoverKind) =>
  kind === 'full' ? fullCoverCacheExpiry : thumbnailCacheExpiry;
const getCacheLimitForKind = (kind: CoverKind) =>
  kind === 'full' ? FULL_COVER_CACHE_LIMIT : THUMBNAIL_CACHE_LIMIT;
const getCacheTtlForKind = (kind: CoverKind) =>
  kind === 'full' ? FULL_COVER_CACHE_TTL_MS : THUMBNAIL_CACHE_TTL_MS;

const buildCacheKey = (path: string, kind: CoverKind) => `${kind}:${path}`;
const isThumbnailRequestKey = (requestKey: string) => requestKey.startsWith('thumbnail:');

const deleteCacheEntry = (
  cache: Map<string, string>,
  expiry: Map<string, number>,
  pathCache: Map<string, string>,
  path: string,
) => {
  cache.delete(path);
  expiry.delete(path);
  pathCache.delete(path);
};

const clearCacheEntries = (
  cache: Map<string, string>,
  expiry: Map<string, number>,
  pathCache: Map<string, string>,
) => {
  cache.clear();
  expiry.clear();
  pathCache.clear();
};

const retainCacheEntries = (
  cache: Map<string, string>,
  expiry: Map<string, number>,
  pathCache: Map<string, string>,
  retainedPaths: Set<string>,
) => {
  for (const path of cache.keys()) {
    if (retainedPaths.has(path)) {
      continue;
    }

    deleteCacheEntry(cache, expiry, pathCache, path);
  }
};

const touchCacheEntry = (
  cache: Map<string, string>,
  expiry: Map<string, number>,
  path: string,
  value: string,
  pathCache: Map<string, string>,
  rawPath: string,
  ttlMs: number,
) => {
  if (cache.has(path)) {
    cache.delete(path);
  }
  expiry.delete(path);
  cache.set(path, value);
  pathCache.set(path, rawPath);
  expiry.set(path, Date.now() + ttlMs);
};

const pruneExpiredEntries = (
  cache: Map<string, string>,
  expiry: Map<string, number>,
  pathCache: Map<string, string>,
  now: number,
) => {
  for (const [path, expiresAt] of expiry) {
    if (expiresAt > now && cache.has(path)) {
      continue;
    }

    deleteCacheEntry(cache, expiry, pathCache, path);
  }
};

const pruneCache = (
  cache: Map<string, string>,
  expiry: Map<string, number>,
  pathCache: Map<string, string>,
  limit: number,
) => {
  pruneExpiredEntries(cache, expiry, pathCache, Date.now());

  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    deleteCacheEntry(cache, expiry, pathCache, oldestKey);
  }

  scheduleCachePrune();
};

const scheduleCachePrune = () => {
  if (cachePruneTimer) {
    clearTimeout(cachePruneTimer);
    cachePruneTimer = null;
  }

  if (typeof window === 'undefined') {
    return;
  }

  let nextExpiry: number | null = null;
  for (const expiresAt of thumbnailCacheExpiry.values()) {
    nextExpiry = nextExpiry === null ? expiresAt : Math.min(nextExpiry, expiresAt);
  }
  for (const expiresAt of fullCoverCacheExpiry.values()) {
    nextExpiry = nextExpiry === null ? expiresAt : Math.min(nextExpiry, expiresAt);
  }

  if (nextExpiry === null) {
    return;
  }

  const delay = Math.max(0, nextExpiry - Date.now());
  cachePruneTimer = window.setTimeout(() => {
    cachePruneTimer = null;
    pruneCache(thumbnailCache, thumbnailCacheExpiry, thumbnailPathCache, THUMBNAIL_CACHE_LIMIT);
    pruneCache(fullCoverCache, fullCoverCacheExpiry, fullCoverPathCache, FULL_COVER_CACHE_LIMIT);
  }, delay);
};

const getCachedCover = (path: string, kind: CoverKind): string | undefined => {
  const cache = getCacheForKind(kind);
  const pathCache = getPathCacheForKind(kind);
  const expiry = getCacheExpiryForKind(kind);
  const ttlMs = getCacheTtlForKind(kind);
  pruneCache(cache, expiry, pathCache, getCacheLimitForKind(kind));

  const cachedValue = cache.get(path);
  if (cachedValue === undefined) {
    return undefined;
  }

  const rawPath = pathCache.get(path);
  if (!rawPath) {
    deleteCacheEntry(cache, expiry, pathCache, path);
    return undefined;
  }

  touchCacheEntry(cache, expiry, path, cachedValue, pathCache, rawPath, ttlMs);
  return cachedValue;
};

const getCachedCoverPath = (path: string, kind: CoverKind): string | undefined => {
  const cache = getCacheForKind(kind);
  const pathCache = getPathCacheForKind(kind);
  const expiry = getCacheExpiryForKind(kind);
  pruneCache(cache, expiry, pathCache, getCacheLimitForKind(kind));

  if (!cache.has(path)) {
    pathCache.delete(path);
    return undefined;
  }

  return pathCache.get(path);
};

const setCachedCover = (path: string, kind: CoverKind, value: string, rawPath: string) => {
  const cache = getCacheForKind(kind);
  const pathCache = getPathCacheForKind(kind);
  const expiry = getCacheExpiryForKind(kind);
  touchCacheEntry(cache, expiry, path, value, pathCache, rawPath, getCacheTtlForKind(kind));
  pruneCache(cache, expiry, pathCache, getCacheLimitForKind(kind));
};

const getFailureCacheKey = (path: string, kind: CoverKind) => buildCacheKey(path, kind);

const hasRecentFailure = (path: string, kind: CoverKind) => {
  const cacheKey = getFailureCacheKey(path, kind);
  return recentFailureCache.has(cacheKey);
};

const bumpCacheEpoch = (kind?: CoverKind) => {
  if (kind) {
    cacheEpochs[kind] += 1;
    return;
  }

  cacheEpochs.thumbnail += 1;
  cacheEpochs.full += 1;
};

const getCacheEpoch = (kind: CoverKind) => {
  return cacheEpochs[kind];
};

const trimTransientCoverState = () => {
  bumpCacheEpoch('thumbnail');
  bumpCacheEpoch('full');
  pruneCache(
    thumbnailCache,
    thumbnailCacheExpiry,
    thumbnailPathCache,
    HIDDEN_THUMBNAIL_CACHE_LIMIT,
  );
  clearCacheEntries(fullCoverCache, fullCoverCacheExpiry, fullCoverPathCache);
  priorityPreloadQueue.length = 0;
  backgroundPreloadQueue.length = 0;
  backgroundFullPreloadQueue.length = 0;
  queuedPathPriority.clear();
  queuedBackgroundFullPaths.clear();
  cancelBackgroundPreload();
  recentFailureCache.prune();
};

const registerVisibilityCleanup = () => {
  if (hasRegisteredVisibilityCleanup || typeof document === 'undefined') {
    return;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      trimTransientCoverState();
    }
  });
  hasRegisteredVisibilityCleanup = true;
};

const loadCoverInternal = (path: string, kind: CoverKind): Promise<string> => {
  const requestKey = buildCacheKey(path, kind);
  if (hasRecentFailure(path, kind)) {
    return Promise.resolve('');
  }

  const existingRequest = inFlightRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }
  const requestEpoch = getCacheEpoch(kind);

  const request = (async () => {
    loadingSet.add(requestKey);
    try {
      const command = kind === 'full' ? 'get_song_cover' : 'get_song_cover_thumbnail';
      const coverPath = await invoke<string>(command, { path });
      if (requestEpoch !== getCacheEpoch(kind) || invalidatedRequestKeys.has(requestKey)) {
        return '';
      }
      const finalUrl = coverPath ? convertFileSrc(coverPath) : '';
      recentFailureCache.delete(requestKey);
      if (finalUrl && coverPath) {
        setCachedCover(path, kind, finalUrl, coverPath);
      }
      return finalUrl;
    } catch {
      if (requestEpoch !== getCacheEpoch(kind) || invalidatedRequestKeys.has(requestKey)) {
        return '';
      }
      recentFailureCache.set(requestKey, true);
      return '';
    } finally {
      loadingSet.delete(requestKey);
      inFlightRequests.delete(requestKey);
      invalidatedRequestKeys.delete(requestKey);
    }
  })();

  inFlightRequests.set(requestKey, request);
  return request;
};

const getActiveThumbnailLoadCount = () => {
  let activeCount = 0;
  for (const requestKey of loadingSet) {
    if (isThumbnailRequestKey(requestKey)) {
      activeCount += 1;
    }
  }
  return activeCount;
};

const cancelBackgroundPreload = () => {
  if (backgroundPreloadTimer) {
    clearTimeout(backgroundPreloadTimer);
    backgroundPreloadTimer = null;
  }

  if (backgroundPreloadIdleId !== null && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(backgroundPreloadIdleId);
    backgroundPreloadIdleId = null;
  }
};

const dequeueNextPath = (priority: PreloadPriority) => {
  const queue = priority === 'priority' ? priorityPreloadQueue : backgroundPreloadQueue;

  while (queue.length > 0) {
    const path = queue.shift();
    if (!path) {
      continue;
    }

    if (queuedPathPriority.get(path) !== priority) {
      continue;
    }

    queuedPathPriority.delete(path);
    return path;
  }

  return undefined;
};

const startPreload = (path: string) => {
  if (thumbnailCache.has(path) || loadingSet.has(buildCacheKey(path, 'thumbnail'))) {
    return;
  }

  void loadCoverInternal(path, 'thumbnail').finally(() => {
    schedulePriorityPreload();
    scheduleBackgroundPreload();
  });
};

const schedulePriorityPreload = () => {
  cancelBackgroundPreload();

  while (getActiveThumbnailLoadCount() < PRELOAD_CONCURRENCY) {
    const nextPath = dequeueNextPath('priority');
    if (!nextPath) {
      break;
    }

    startPreload(nextPath);
  }
};

const flushBackgroundPreload = () => {
  backgroundPreloadTimer = null;
  backgroundPreloadIdleId = null;

  if (priorityPreloadQueue.length > 0) {
    schedulePriorityPreload();
    return;
  }

  while (getActiveThumbnailLoadCount() < BACKGROUND_PRELOAD_CONCURRENCY) {
    const nextPath = dequeueNextPath('background');
    if (!nextPath) {
      break;
    }

    startPreload(nextPath);
  }

  if (backgroundPreloadQueue.length > 0) {
    scheduleBackgroundPreload();
  }
};

function scheduleBackgroundPreload() {
  if (
    backgroundPreloadTimer ||
    backgroundPreloadIdleId !== null ||
    priorityPreloadQueue.length > 0 ||
    backgroundPreloadQueue.length === 0 ||
    getActiveThumbnailLoadCount() >= BACKGROUND_PRELOAD_CONCURRENCY
  ) {
    return;
  }

  const runBackgroundPreload = () => {
    flushBackgroundPreload();
  };

  if ('requestIdleCallback' in window) {
    backgroundPreloadIdleId = window.requestIdleCallback(runBackgroundPreload, { timeout: 300 });
    return;
  }

  backgroundPreloadTimer = setTimeout(runBackgroundPreload, 160);
}

const enqueuePreload = (path: string, priority: PreloadPriority) => {
  if (!path || thumbnailCache.has(path) || loadingSet.has(buildCacheKey(path, 'thumbnail'))) {
    return;
  }

  const existingPriority = queuedPathPriority.get(path);
  if (existingPriority === 'priority') {
    return;
  }

  if (priority === 'priority') {
    queuedPathPriority.set(path, 'priority');
    priorityPreloadQueue.push(path);
    return;
  }

  if (!existingPriority) {
    queuedPathPriority.set(path, 'background');
    backgroundPreloadQueue.push(path);
  }
};

const scheduleBackgroundFullPreload = () => {
  while (
    activeBackgroundFullPreloadCount < BACKGROUND_FULL_PRELOAD_CONCURRENCY
    && backgroundFullPreloadQueue.length > 0
  ) {
    const path = backgroundFullPreloadQueue.shift();
    if (!path) {
      continue;
    }

    queuedBackgroundFullPaths.delete(path);

    if (
      fullCoverCache.has(path)
      || loadingSet.has(buildCacheKey(path, 'full'))
      || hasRecentFailure(path, 'full')
    ) {
      continue;
    }

    activeBackgroundFullPreloadCount += 1;
    void loadCoverInternal(path, 'full').finally(() => {
      activeBackgroundFullPreloadCount = Math.max(0, activeBackgroundFullPreloadCount - 1);
      scheduleBackgroundFullPreload();
    });
  }
};

const enqueueBackgroundFullPreload = (path: string) => {
  if (
    !path
    || fullCoverCache.has(path)
    || loadingSet.has(buildCacheKey(path, 'full'))
    || queuedBackgroundFullPaths.has(path)
    || hasRecentFailure(path, 'full')
  ) {
    return;
  }

  queuedBackgroundFullPaths.add(path);
  backgroundFullPreloadQueue.push(path);
};

export function useCoverCache() {
  registerVisibilityCleanup();

  const peekCoverUrl = (path: string | undefined, kind: CoverKind = 'thumbnail') => {
    if (!path) {
      return '';
    }

    pruneCache(
      getCacheForKind(kind),
      getCacheExpiryForKind(kind),
      getPathCacheForKind(kind),
      getCacheLimitForKind(kind),
    );
    return getCacheForKind(kind).get(path) ?? '';
  };

  const peekCoverPath = (path: string | undefined, kind: CoverKind = 'thumbnail') => {
    if (!path) {
      return '';
    }

    pruneCache(
      getCacheForKind(kind),
      getCacheExpiryForKind(kind),
      getPathCacheForKind(kind),
      getCacheLimitForKind(kind),
    );
    return getPathCacheForKind(kind).get(path) ?? '';
  };

  const touchCoverPaths = (paths: string[], kind: CoverKind = 'thumbnail') => {
    const cache = getCacheForKind(kind);
    const pathCache = getPathCacheForKind(kind);
    const expiry = getCacheExpiryForKind(kind);
    const ttlMs = getCacheTtlForKind(kind);

    paths.forEach((path) => {
      if (!path) {
        return;
      }

      const cachedValue = cache.get(path);
      if (cachedValue === undefined) {
        return;
      }

      const rawPath = pathCache.get(path);
      if (!rawPath) {
        deleteCacheEntry(cache, expiry, pathCache, path);
        return;
      }

      touchCacheEntry(cache, expiry, path, cachedValue, pathCache, rawPath, ttlMs);
    });

    pruneCache(cache, expiry, pathCache, getCacheLimitForKind(kind));
  };

  const isCoverLoading = (path: string | undefined, kind: CoverKind = 'thumbnail') => {
    if (!path) {
      return false;
    }

    return loadingSet.has(buildCacheKey(path, kind));
  };

  const loadCover = async (path: string | undefined): Promise<string | undefined> => {
    if (!path) {
      return undefined;
    }

    const cachedValue = getCachedCover(path, 'thumbnail');
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    return loadCoverInternal(path, 'thumbnail');
  };

  const loadFullCover = async (path: string | undefined): Promise<string | undefined> => {
    if (!path) {
      return undefined;
    }

    const cachedValue = getCachedCover(path, 'full');
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    return loadCoverInternal(path, 'full');
  };

  const loadCoverPath = async (path: string | undefined): Promise<string | undefined> => {
    if (!path) {
      return undefined;
    }

    const cachedValue = getCachedCoverPath(path, 'thumbnail');
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    await loadCoverInternal(path, 'thumbnail');
    return getCachedCoverPath(path, 'thumbnail');
  };

  const loadFullCoverPath = async (path: string | undefined): Promise<string | undefined> => {
    if (!path) {
      return undefined;
    }

    const cachedValue = getCachedCoverPath(path, 'full');
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    await loadCoverInternal(path, 'full');
    return getCachedCoverPath(path, 'full');
  };

  const primeCoverPath = (path: string | undefined, rawPath: string | undefined | null) => {
    if (!path || !rawPath) {
      return '';
    }

    const cachedValue = getCachedCover(path, 'thumbnail');
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    const finalUrl = convertFileSrc(rawPath);
    setCachedCover(path, 'thumbnail', finalUrl, rawPath);
    return finalUrl;
  };

  const preloadCovers = (paths: string[], priority: PreloadPriority = 'background') => {
    for (const path of paths) {
      enqueuePreload(path, priority);
    }

    if (priority === 'priority') {
      schedulePriorityPreload();
      return;
    }

    scheduleBackgroundPreload();
  };

  const preloadFullCovers = (paths: string[]) => {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    for (const path of uniquePaths) {
      enqueueBackgroundFullPreload(path);
    }
    scheduleBackgroundFullPreload();
  };

  const retainFullCoverPaths = (fullPaths: string[]) => {
    const retainedFullPaths = new Set(fullPaths.filter(Boolean));
    retainCacheEntries(
      fullCoverCache,
      fullCoverCacheExpiry,
      fullCoverPathCache,
      retainedFullPaths,
    );

    for (const requestKey of Array.from(inFlightRequests.keys())) {
      if (isThumbnailRequestKey(requestKey)) {
        continue;
      }

      const path = requestKey.slice(requestKey.indexOf(':') + 1);
      if (retainedFullPaths.has(path)) {
        continue;
      }

      invalidatedRequestKeys.add(requestKey);
      inFlightRequests.delete(requestKey);
      loadingSet.delete(requestKey);
    }

    for (const [path, priority] of Array.from(queuedPathPriority.entries())) {
      if (priority === 'priority' || priority === 'background') {
        continue;
      }

      if (retainedFullPaths.has(path)) {
        continue;
      }

      queuedPathPriority.delete(path);
    }

    for (const path of Array.from(queuedBackgroundFullPaths)) {
      if (retainedFullPaths.has(path)) {
        continue;
      }

      queuedBackgroundFullPaths.delete(path);
    }
    backgroundFullPreloadQueue.splice(
      0,
      backgroundFullPreloadQueue.length,
      ...backgroundFullPreloadQueue.filter(path => retainedFullPaths.has(path)),
    );

    pruneCache(
      fullCoverCache,
      fullCoverCacheExpiry,
      fullCoverPathCache,
      Math.max(1, retainedFullPaths.size),
    );
  };

  const clearCoverCaches = () => {
    bumpCacheEpoch();
    clearCacheEntries(thumbnailCache, thumbnailCacheExpiry, thumbnailPathCache);
    clearCacheEntries(fullCoverCache, fullCoverCacheExpiry, fullCoverPathCache);
    loadingSet.clear();
    inFlightRequests.clear();
    recentFailureCache.clear();
    invalidatedRequestKeys.clear();
    priorityPreloadQueue.length = 0;
    backgroundPreloadQueue.length = 0;
    backgroundFullPreloadQueue.length = 0;
    queuedPathPriority.clear();
    queuedBackgroundFullPaths.clear();
    activeBackgroundFullPreloadCount = 0;
    cancelBackgroundPreload();
    if (cachePruneTimer) {
      clearTimeout(cachePruneTimer);
      cachePruneTimer = null;
    }
  };

  return {
    coverCache: thumbnailCache,
    fullCoverCache,
    loadingSet,
    peekCoverUrl,
    peekCoverPath,
    getFullCoverUrl: (path: string | undefined) => peekCoverUrl(path, 'full'),
    touchCoverPaths,
    isCoverLoading,
    loadCover,
    loadCoverPath,
    loadFullCoverPath,
    primeCoverPath,
    loadFullCover,
    preloadCovers,
    preloadPriorityCovers: (paths: string[]) => preloadCovers(paths, 'priority'),
    preloadFullCovers,
    retainFullCoverPaths,
    clearCoverCaches,
  };
}
