import { ref } from 'vue';

import type { FolderSortMode } from '../services/storage/playerStorage';
import { tauriInvoke } from '../services/tauri/invoke';
import {
  activateLibrarySongPathCacheEntry,
  clearLibrarySongPathCacheNamespace,
  getLibrarySongPathCacheEntry,
  setLibrarySongPathCacheEntry,
} from '../caches/librarySongPathCache';

type BackendFolderSortMode = Exclude<FolderSortMode, 'custom'>;

const FOLDER_VIEW_PATH_CACHE_TTL_MS = 5 * 60 * 1000;
const FOLDER_VIEW_PATH_CACHE_NAMESPACE = 'folder';

const inFlightRequests = new Map<string, Promise<string[]>>();
const cacheVersion = ref(0);

const makeCacheKey = (
  folderPath: string,
  query: string,
  sortMode: BackendFolderSortMode,
  includeSubfolders: boolean,
) => `${sortMode}\u0001${folderPath}\u0001${query}\u0001${includeSubfolders}`;

export function useLibraryFolderSongPathCache() {
  const loadFolderViewSongPaths = async ({
    folderPath,
    query = '',
    sortMode,
    includeSubfolders = false,
  }: {
    folderPath: string;
    query?: string;
    sortMode: BackendFolderSortMode;
    includeSubfolders?: boolean;
  }) => {
    if (!folderPath) {
      return [];
    }

    const cacheKey = makeCacheKey(folderPath, query, sortMode, includeSubfolders);
    activateLibrarySongPathCacheEntry(FOLDER_VIEW_PATH_CACHE_NAMESPACE, cacheKey);
    const cached = getLibrarySongPathCacheEntry(FOLDER_VIEW_PATH_CACHE_NAMESPACE, cacheKey);
    if (cached) {
      return cached.paths;
    }

    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = tauriInvoke('get_library_song_paths_for_folder_view', {
      folderPath,
      query,
      sortMode,
      includeSubfolders,
    })
      .then((paths) => {
        setLibrarySongPathCacheEntry(
          FOLDER_VIEW_PATH_CACHE_NAMESPACE,
          cacheKey,
          { paths },
          FOLDER_VIEW_PATH_CACHE_TTL_MS,
        );
        cacheVersion.value += 1;
        return paths;
      })
      .finally(() => {
        inFlightRequests.delete(cacheKey);
      });

    inFlightRequests.set(cacheKey, request);
    return request;
  };

  return {
    loadFolderViewSongPaths,
    clearLibraryFolderSongPathCache: () => {
      clearLibrarySongPathCacheNamespace(FOLDER_VIEW_PATH_CACHE_NAMESPACE);
      inFlightRequests.clear();
      cacheVersion.value += 1;
    },
    libraryFolderSongPathCacheVersion: cacheVersion,
  };
}
