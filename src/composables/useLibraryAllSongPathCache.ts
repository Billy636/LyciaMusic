import { ref } from 'vue';

import type { LocalSortMode } from '../services/storage/playerStorage';
import { tauriInvoke } from '../services/tauri/invoke';
import {
  activateLibrarySongPathCacheEntry,
  clearLibrarySongPathCacheNamespace,
  getActiveLibrarySongPathCacheEntry,
  getLibrarySongPathCacheEntry,
  setLibrarySongPathCacheEntry,
  type LibrarySongPathCacheEntry,
} from '../caches/librarySongPathCache';
import { isProfilingEnabled } from '../utils/profiling';
import { sortItemsByAlphabetIndex } from '../utils/alphabetIndex';

import { useLibraryStore } from '../features/library/store';

type BackendLocalSortMode = Exclude<LocalSortMode, 'custom'>;

const ALL_VIEW_PATH_CACHE_TTL_MS = 5 * 60 * 1000;
const ALL_VIEW_PATH_CACHE_NAMESPACE = 'all';

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
    activateLibrarySongPathCacheEntry(ALL_VIEW_PATH_CACHE_NAMESPACE, cacheKey);
    const cached = getLibrarySongPathCacheEntry(ALL_VIEW_PATH_CACHE_NAMESPACE, cacheKey);
    if (cached) {
      if (isProfilingEnabled()) {
        console.log(
          `[Profiling] loadAllViewSongPaths cache hit (sort: ${sortMode}, query: ${query ? 'yes' : 'no'}, paths: ${cached.paths.length})`,
        );
      }
      return cached.paths;
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

    const pathRequest: Promise<LibrarySongPathCacheEntry> = sortMode === 'title'
      ? tauriInvoke('get_library_song_labels_for_all_view', {
          query,
          artistFilter,
          albumFilter,
        }).then((labels) => {
          // Keep older mocks and mixed-version backends compatible while the
          // compact label endpoint rolls out.
          if (labels.length > 0 && typeof labels[0] === 'string') {
            return {
              paths: sortItemsByAlphabetIndex(
                labels as unknown as string[],
                path => libraryStore.getSongByPath(path)?.title
                  || path.split(/[\\/]/).pop()
                  || path,
              ),
            };
          }
          if (labels.length > 0 || query || artistFilter || albumFilter) {
            const titleLabels = new Map(labels.map(item => [item.path, item.label]));
            return {
              paths: sortItemsByAlphabetIndex(labels, item => item.label).map(item => item.path),
              titleLabels,
            };
          }
          return {
            paths: sortItemsByAlphabetIndex(
              libraryStore.canonicalSongPaths,
              path => libraryStore.getSongByPath(path)?.title
                || path.split(/[\\/]/).pop()
                || path,
            ),
          };
        })
      : tauriInvoke('get_library_song_paths_for_all_view', {
          query,
          artistFilter,
          albumFilter,
          sortMode,
        }).then(paths => ({ paths }));

    const request = pathRequest
      .then((entry) => {
        // 强一致性校验：若在请求未决期间数据版本发生变更（如新增、删除或重排），则丢弃缓存回填
        if (libraryStore.libraryDataVersion === requestVersion) {
          setLibrarySongPathCacheEntry(
            ALL_VIEW_PATH_CACHE_NAMESPACE,
            cacheKey,
            entry,
            ALL_VIEW_PATH_CACHE_TTL_MS,
          );
          cacheVersion.value += 1;
          if (isProfilingEnabled()) {
            console.log(
              `[Profiling] loadAllViewSongPaths IPC completed in ${(performance.now() - profileStart).toFixed(2)}ms (paths: ${entry.paths.length}, version: ${requestVersion})`,
            );
          }
          return entry.paths;
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
      clearLibrarySongPathCacheNamespace(ALL_VIEW_PATH_CACHE_NAMESPACE);
      inFlightRequests.clear();
      cacheVersion.value += 1;
    },
    libraryAllSongPathCacheVersion: cacheVersion,
  };
}

export const getCachedLibrarySongTitleLabel = (path: string) =>
  getActiveLibrarySongPathCacheEntry(ALL_VIEW_PATH_CACHE_NAMESPACE)?.titleLabels?.get(path);

export const isStaleLibraryPathRequestError = (error: unknown) =>
  typeof error === 'object'
  && error !== null
  && (error as { code?: string }).code === STALE_LIBRARY_PATH_REQUEST;
