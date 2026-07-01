import { ref } from 'vue';

import type { LocalSortMode } from '../services/storage/playerStorage';
import { tauriInvoke } from '../services/tauri/invoke';
import { MemoryCache } from '../utils/MemoryCache';
import { isProfilingEnabled } from '../utils/profiling';
import { sortItemsByAlphabetIndex } from '../utils/alphabetIndex';

import { useLibraryStore } from '../features/library/store';

type BackendLocalSortMode = Exclude<LocalSortMode, 'custom'>;

const ALL_VIEW_PATH_CACHE_TTL_MS = 5 * 60 * 1000;
// Each entry can contain tens of thousands of paths. Keep only the most recent
// view variants so search and sort changes cannot retain dozens of full lists.
const ALL_VIEW_PATH_CACHE_MAX_ENTRIES = 8;

const allViewPathCache = new MemoryCache<string, string[]>({
  maxEntries: ALL_VIEW_PATH_CACHE_MAX_ENTRIES,
  ttlMs: ALL_VIEW_PATH_CACHE_TTL_MS,
});

const inFlightRequests = new Map<string, Promise<string[]>>();
const songTitleLabels = new Map<string, string>();
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
      if (isProfilingEnabled()) {
        console.log(
          `[Profiling] loadAllViewSongPaths cache hit (sort: ${sortMode}, query: ${query ? 'yes' : 'no'}, paths: ${cached.length})`,
        );
      }
      return cached;
    }

    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
      if (isProfilingEnabled()) {
        console.log(
          `[Profiling] loadAllViewSongPaths joined in-flight request (sort: ${sortMode}, query: ${query ? 'yes' : 'no'})`,
        );
      }
      return inFlight;
    }

    // 记录发起异步请求时的全局数据版本
    const requestVersion = libraryStore.libraryDataVersion;
    const profileStart = isProfilingEnabled() ? performance.now() : 0;

    if (isProfilingEnabled()) {
      console.log(
        `[Profiling] loadAllViewSongPaths IPC start (sort: ${sortMode}, query: ${query ? 'yes' : 'no'}, artistFilter: ${artistFilter ? 'yes' : 'no'}, albumFilter: ${albumFilter ? 'yes' : 'no'}, version: ${requestVersion})`,
      );
    }

    const pathRequest = sortMode === 'title'
      ? tauriInvoke('get_library_song_labels_for_all_view', {
          query,
          artistFilter,
          albumFilter,
        }).then((labels) => {
          // Keep older mocks and mixed-version backends compatible while the
          // compact label endpoint rolls out.
          if (labels.length > 0 && typeof labels[0] === 'string') {
            return sortItemsByAlphabetIndex(
              labels as unknown as string[],
              path => libraryStore.getSongByPath(path)?.title
                || path.split(/[\\/]/).pop()
                || path,
            );
          }
          if (labels.length > 0 || query || artistFilter || albumFilter) {
            labels.forEach(item => songTitleLabels.set(item.path, item.label));
            return sortItemsByAlphabetIndex(labels, item => item.label).map(item => item.path);
          }
          return sortItemsByAlphabetIndex(
            libraryStore.canonicalSongPaths,
            path => libraryStore.getSongByPath(path)?.title
              || path.split(/[\\/]/).pop()
              || path,
          );
        })
      : tauriInvoke('get_library_song_paths_for_all_view', {
          query,
          artistFilter,
          albumFilter,
          sortMode,
        });

    const request = pathRequest
      .then((paths) => {
        // 强一致性校验：若在请求未决期间数据版本发生变更（如新增、删除或重排），则丢弃缓存回填
        if (libraryStore.libraryDataVersion === requestVersion) {
          allViewPathCache.set(cacheKey, paths);
          cacheVersion.value += 1;
          if (isProfilingEnabled()) {
            console.log(
              `[Profiling] loadAllViewSongPaths IPC completed in ${(performance.now() - profileStart).toFixed(2)}ms (paths: ${paths.length}, version: ${requestVersion})`,
            );
          }
          return paths;
        } else if (isProfilingEnabled()) {
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
      songTitleLabels.clear();
      cacheVersion.value += 1;
    },
    libraryAllSongPathCacheVersion: cacheVersion,
  };
}

export const getCachedLibrarySongTitleLabel = (path: string) => songTitleLabels.get(path);

export const isStaleLibraryPathRequestError = (error: unknown) =>
  typeof error === 'object'
  && error !== null
  && (error as { code?: string }).code === STALE_LIBRARY_PATH_REQUEST;
