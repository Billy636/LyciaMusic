import { ref } from 'vue';

import type { LocalSortMode } from '../services/storage/playerStorage';
import { tauriInvoke } from '../services/tauri/invoke';
import { MemoryCache } from '../utils/MemoryCache';

import { useLibraryStore } from '../features/library/store';

type BackendLocalSortMode = Exclude<LocalSortMode, 'custom'>;

const ALL_VIEW_PATH_CACHE_TTL_MS = 5 * 60 * 1000;
const ALL_VIEW_PATH_CACHE_MAX_ENTRIES = 96;

const allViewPathCache = new MemoryCache<string, string[]>({
  maxEntries: ALL_VIEW_PATH_CACHE_MAX_ENTRIES,
  ttlMs: ALL_VIEW_PATH_CACHE_TTL_MS,
});

const inFlightRequests = new Map<string, Promise<string[]>>();
const cacheVersion = ref(0);
const STALE_LIBRARY_PATH_REQUEST = 'STALE_LIBRARY_PATH_REQUEST';

const makeCacheKey = (
  query: string,
  artistFilter: string,
  albumFilter: string,
  sortMode: BackendLocalSortMode,
) => `${sortMode}\u0001${query}\u0001${artistFilter}\u0001${albumFilter}`;

export function useLibraryAllSongPathCache() {
  const libraryStore = useLibraryStore();

  const loadAllViewSongPaths = async ({
    query = '',
    artistFilter = '',
    albumFilter = '',
    sortMode,
  }: {
    query?: string;
    artistFilter?: string;
    albumFilter?: string;
    sortMode: BackendLocalSortMode;
  }) => {
    const cacheKey = makeCacheKey(query, artistFilter, albumFilter, sortMode);
    const cached = allViewPathCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    // 记录发起异步请求时的全局数据版本
    const requestVersion = libraryStore.libraryDataVersion;

    const request = tauriInvoke('get_library_song_paths_for_all_view', {
      query,
      artistFilter,
      albumFilter,
      sortMode,
    })
      .then((paths) => {
        // 强一致性校验：若在请求未决期间数据版本发生变更（如新增、删除或重排），则丢弃缓存回填
        if (libraryStore.libraryDataVersion === requestVersion) {
          allViewPathCache.set(cacheKey, paths);
          cacheVersion.value += 1;
          return paths;
        } else if (import.meta.env.DEV) {
          console.log(`[useLibraryAllSongPathCache] Discarded in-flight path cache. Version mismatch: request ${requestVersion} vs current ${libraryStore.libraryDataVersion}`);
        }
        throw Object.assign(new Error('Stale library path request'), {
          code: STALE_LIBRARY_PATH_REQUEST,
        });
      })
      .finally(() => {
        inFlightRequests.delete(cacheKey);
      });

    inFlightRequests.set(cacheKey, request);
    return request;
  };

  return {
    loadAllViewSongPaths,
    clearLibraryAllSongPathCache: () => {
      allViewPathCache.clear();
      inFlightRequests.clear();
      cacheVersion.value += 1;
    },
    libraryAllSongPathCacheVersion: cacheVersion,
  };
}

export const isStaleLibraryPathRequestError = (error: unknown) =>
  typeof error === 'object'
  && error !== null
  && (error as { code?: string }).code === STALE_LIBRARY_PATH_REQUEST;
