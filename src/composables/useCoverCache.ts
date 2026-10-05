import { reactive, readonly, shallowRef } from 'vue';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { MemoryCache } from '../utils/MemoryCache';

export type CoverKind = 'thumbnail' | 'card' | 'full';
type PreloadPriority = 'priority' | 'background';
type PreviewKind = Exclude<CoverKind, 'full'>;
type PreloadRequest = { path: string; kind: PreviewKind };

const THUMBNAIL_CACHE_LIMIT = 64;
const CARD_COVER_CACHE_LIMIT = 32;
const FULL_COVER_CACHE_LIMIT = 4;
const THUMBNAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const CARD_COVER_CACHE_TTL_MS = 2 * 60 * 1000;
const FULL_COVER_CACHE_TTL_MS = 2 * 60 * 1000;
const HIDDEN_THUMBNAIL_CACHE_LIMIT = 12;
const PRELOAD_CONCURRENCY = 4;
const BACKGROUND_PRELOAD_CONCURRENCY = 1;
const BACKGROUND_FULL_PRELOAD_CONCURRENCY = 1;
const FAILURE_RETRY_MS = 10_000;

// Small in-memory LRU for thumbnail URLs. The actual image files live on disk.
const thumbnailCache = reactive(new Map<string, string>());
const cardCoverCache = reactive(new Map<string, string>());
const fullCoverCache = reactive(new Map<string, string>());
const thumbnailPathCache = new Map<string, string>();
const cardCoverPathCache = new Map<string, string>();
const fullCoverPathCache = new Map<string, string>();
const thumbnailCacheExpiry = new Map<string, number>();
const cardCoverCacheExpiry = new Map<string, number>();
const fullCoverCacheExpiry = new Map<string, number>();
const loadingSet = reactive(new Set<string>());
const inFlightRequests = new Map<string, { epoch: number; promise: Promise<string> }>();
const requestTokens = new Map<string, symbol>();
const coverCacheResetVersion = shallowRef(0);
const readonlyCoverCacheResetVersion = readonly(coverCacheResetVersion);
const coverCacheResumeVersion = shallowRef(0);
const readonlyCoverCacheResumeVersion = readonly(coverCacheResumeVersion);
const recentFailureCache = new MemoryCache<string, true>({
  maxEntries: 256,
  ttlMs: FAILURE_RETRY_MS,
});
const priorityPreloadQueue: PreloadRequest[] = [];
const backgroundPreloadQueue: PreloadRequest[] = [];
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
  card: 0,
  full: 0,
};

const cacheConfigs = {
  thumbnail: {
    cache: thumbnailCache, paths: thumbnailPathCache, expiry: thumbnailCacheExpiry,
    limit: THUMBNAIL_CACHE_LIMIT, ttl: THUMBNAIL_CACHE_TTL_MS,
  },
  card: {
    cache: cardCoverCache, paths: cardCoverPathCache, expiry: cardCoverCacheExpiry,
    limit: CARD_COVER_CACHE_LIMIT, ttl: CARD_COVER_CACHE_TTL_MS,
  },
  full: {
    cache: fullCoverCache, paths: fullCoverPathCache, expiry: fullCoverCacheExpiry,
    limit: FULL_COVER_CACHE_LIMIT, ttl: FULL_COVER_CACHE_TTL_MS,
  },
};
const getCacheForKind = (kind: CoverKind) => cacheConfigs[kind].cache;
const getPathCacheForKind = (kind: CoverKind) => cacheConfigs[kind].paths;
const getCacheExpiryForKind = (kind: CoverKind) => cacheConfigs[kind].expiry;
const getCacheLimitForKind = (kind: CoverKind) => cacheConfigs[kind].limit;
const getCacheTtlForKind = (kind: CoverKind) => cacheConfigs[kind].ttl;

// Most cards are under 256 CSS pixels. Match the display scale without
// loading 800px player artwork for every card on a high-DPI screen.
const resolveCardEdge = () => {
  const scale = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return scale <= 1 ? 256 : scale <= 1.5 ? 384 : 512;
};
let cardEdge = resolveCardEdge();

const buildCacheKey = (path: string, kind: CoverKind) => `${kind}:${path}`;
const isPreviewRequestKey = (requestKey: string) => !requestKey.startsWith('full:');

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
  for (const config of Object.values(cacheConfigs)) {
    for (const expiresAt of config.expiry.values()) {
      nextExpiry = nextExpiry === null ? expiresAt : Math.min(nextExpiry, expiresAt);
    }
  }

  if (nextExpiry === null) {
    return;
  }

  const delay = Math.max(0, nextExpiry - Date.now());
  cachePruneTimer = window.setTimeout(() => {
    cachePruneTimer = null;
    for (const config of Object.values(cacheConfigs)) {
      pruneCache(config.cache, config.expiry, config.paths, config.limit);
    }
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
  cacheEpochs.card += 1;
  cacheEpochs.full += 1;
};

const getCacheEpoch = (kind: CoverKind) => {
  return cacheEpochs[kind];
};

const trimTransientCoverState = () => {
  bumpCacheEpoch();
  pruneCache(
    thumbnailCache,
    thumbnailCacheExpiry,
    thumbnailPathCache,
    HIDDEN_THUMBNAIL_CACHE_LIMIT,
  );
  clearCacheEntries(cardCoverCache, cardCoverCacheExpiry, cardCoverPathCache);
  clearCacheEntries(fullCoverCache, fullCoverCacheExpiry, fullCoverPathCache);
  priorityPreloadQueue.length = 0;
  backgroundPreloadQueue.length = 0;
  backgroundFullPreloadQueue.length = 0;
  queuedPathPriority.clear();
  queuedBackgroundFullPaths.clear();
  cancelBackgroundPreload();
  recentFailureCache.prune();
};

const syncCardResolution = () => {
  const nextEdge = resolveCardEdge();
  if (cardEdge === nextEdge) return;

  cardEdge = nextEdge;
  bumpCacheEpoch('card');
  clearCacheEntries(cardCoverCache, cardCoverCacheExpiry, cardCoverPathCache);
  for (const requestKey of requestTokens.keys()) {
    if (!requestKey.startsWith('card:')) continue;
    requestTokens.delete(requestKey);
    inFlightRequests.delete(requestKey);
    loadingSet.delete(requestKey);
  }
  // Old-size preload results must not replace a freshly loaded card.
  for (const requestKey of queuedPathPriority.keys()) {
    if (requestKey.startsWith('card:')) queuedPathPriority.delete(requestKey);
  }
  coverCacheResetVersion.value += 1;
};

const registerVisibilityCleanup = () => {
  if (hasRegisteredVisibilityCleanup || typeof document === 'undefined') {
    return;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      trimTransientCoverState();
    } else {
      syncCardResolution();
      coverCacheResumeVersion.value += 1;
    }
  });
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', syncCardResolution);
  }
  hasRegisteredVisibilityCleanup = true;
};

const loadCoverInternal = (path: string, kind: CoverKind): Promise<string> => {
  const requestKey = buildCacheKey(path, kind);
  if (hasRecentFailure(path, kind)) {
    return Promise.resolve('');
  }

  const requestEpoch = getCacheEpoch(kind);
  const existingRequest = inFlightRequests.get(requestKey);
  if (existingRequest?.epoch === requestEpoch) {
    return existingRequest.promise;
  }
  const requestToken = Symbol(requestKey);
  requestTokens.set(requestKey, requestToken);
  const isCurrentRequest = () => requestEpoch === getCacheEpoch(kind)
    && requestTokens.get(requestKey) === requestToken;

  const request = (async () => {
    loadingSet.add(requestKey);
    try {
      const command = kind === 'full' ? 'get_song_cover' : 'get_song_cover_thumbnail';
      const coverPath = await invoke<string>(command,
        kind === 'card' ? { path, edge: cardEdge } : { path });
      if (!isCurrentRequest()) {
        return '';
      }
      const finalUrl = coverPath ? convertFileSrc(coverPath) : '';
      recentFailureCache.delete(requestKey);
      if (finalUrl && coverPath) {
        setCachedCover(path, kind, finalUrl, coverPath);
      }
      return finalUrl;
    } catch {
      if (!isCurrentRequest()) {
        return '';
      }
      recentFailureCache.set(requestKey, true);
      return '';
    } finally {
      // A reset or retention change may already have started a newer request
      // for this path. Only the owner can release that request's shared state.
      if (requestTokens.get(requestKey) === requestToken) {
        requestTokens.delete(requestKey);
        loadingSet.delete(requestKey);
        inFlightRequests.delete(requestKey);
      }
    }
  })();

  // invoke can throw synchronously; do not register an already-finished request.
  if (requestTokens.get(requestKey) === requestToken) {
    inFlightRequests.set(requestKey, { epoch: requestEpoch, promise: request });
  }
  return request;
};

const getActivePreviewLoadCount = () => {
  let activeCount = 0;
  for (const requestKey of loadingSet) {
    if (isPreviewRequestKey(requestKey)) {
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
    const request = queue.shift();
    if (!request) {
      continue;
    }

    const requestKey = buildCacheKey(request.path, request.kind);
    if (queuedPathPriority.get(requestKey) !== priority) {
      continue;
    }

    queuedPathPriority.delete(requestKey);
    return request;
  }

  return undefined;
};

const startPreload = ({ path, kind }: PreloadRequest) => {
  if (getCacheForKind(kind).has(path) || loadingSet.has(buildCacheKey(path, kind))) {
    return;
  }

  void loadCoverInternal(path, kind).finally(() => {
    schedulePriorityPreload();
    scheduleBackgroundPreload();
  });
};

const schedulePriorityPreload = () => {
  cancelBackgroundPreload();

  while (getActivePreviewLoadCount() < PRELOAD_CONCURRENCY) {
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

  while (getActivePreviewLoadCount() < BACKGROUND_PRELOAD_CONCURRENCY) {
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
    getActivePreviewLoadCount() >= BACKGROUND_PRELOAD_CONCURRENCY
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

const enqueuePreload = (path: string, priority: PreloadPriority, kind: PreviewKind) => {
  const requestKey = buildCacheKey(path, kind);
  if (!path || getCacheForKind(kind).has(path) || loadingSet.has(requestKey)) {
    return;
  }

  const existingPriority = queuedPathPriority.get(requestKey);
  if (existingPriority === 'priority') {
    return;
  }

  if (priority === 'priority') {
    queuedPathPriority.set(requestKey, 'priority');
    priorityPreloadQueue.push({ path, kind });
    return;
  }

  if (!existingPriority) {
    queuedPathPriority.set(requestKey, 'background');
    backgroundPreloadQueue.push({ path, kind });
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
  syncCardResolution();

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

  const loadCover = async (path: string | undefined, kind: CoverKind = 'thumbnail'): Promise<string | undefined> => {
    if (!path) {
      return undefined;
    }

    const cachedValue = getCachedCover(path, kind);
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    return loadCoverInternal(path, kind);
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

  const preloadCovers = (paths: string[], priority: PreloadPriority = 'background', kind: PreviewKind = 'thumbnail') => {
    for (const path of paths) {
      enqueuePreload(path, priority, kind);
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
      if (isPreviewRequestKey(requestKey)) {
        continue;
      }

      const path = requestKey.slice(requestKey.indexOf(':') + 1);
      if (retainedFullPaths.has(path)) {
        continue;
      }

      requestTokens.delete(requestKey);
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

  const invalidateSongCover = (path: string) => {
    if (!path) {
      return;
    }

    for (const kind of Object.keys(cacheConfigs) as CoverKind[]) {
      const config = cacheConfigs[kind];
      const requestKey = buildCacheKey(path, kind);
      deleteCacheEntry(config.cache, config.expiry, config.paths, path);
      // Removing the token makes any older response stale without invalidating
      // requests or cached artwork belonging to other songs.
      requestTokens.delete(requestKey);
      inFlightRequests.delete(requestKey);
      loadingSet.delete(requestKey);
      recentFailureCache.delete(requestKey);
      queuedPathPriority.delete(requestKey);
    }

    for (const queue of [priorityPreloadQueue, backgroundPreloadQueue]) {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (queue[index]?.path === path) {
          queue.splice(index, 1);
        }
      }
    }
    for (let index = backgroundFullPreloadQueue.length - 1; index >= 0; index -= 1) {
      if (backgroundFullPreloadQueue[index] === path) {
        backgroundFullPreloadQueue.splice(index, 1);
      }
    }
    queuedBackgroundFullPaths.delete(path);
    scheduleCachePrune();
    // Visible owners retain URLs beyond the shared LRU, so also tell them to
    // discard the old image and request it again after all stale work is removed.
    coverCacheResetVersion.value += 1;
  };

  const clearCoverCaches = () => {
    bumpCacheEpoch();
    clearCacheEntries(thumbnailCache, thumbnailCacheExpiry, thumbnailPathCache);
    clearCacheEntries(cardCoverCache, cardCoverCacheExpiry, cardCoverPathCache);
    clearCacheEntries(fullCoverCache, fullCoverCacheExpiry, fullCoverPathCache);
    loadingSet.clear();
    inFlightRequests.clear();
    recentFailureCache.clear();
    requestTokens.clear();
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
    // Notify visible consumers only after every old request/queue is cleared,
    // so a synchronous reset watcher can safely start fresh requests.
    coverCacheResetVersion.value += 1;
  };

  return {
    coverCache: thumbnailCache,
    cardCoverCache,
    fullCoverCache,
    coverCacheResetVersion: readonlyCoverCacheResetVersion,
    coverCacheResumeVersion: readonlyCoverCacheResumeVersion,
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
    preloadPriorityCovers: (paths: string[], kind: PreviewKind = 'thumbnail') => preloadCovers(paths, 'priority', kind),
    preloadFullCovers,
    retainFullCoverPaths,
    invalidateSongCover,
    clearCoverCaches,
  };
}
