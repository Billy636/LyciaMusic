import { ref } from 'vue';

import { tauriInvoke } from '../services/tauri/invoke';
import {
  activateLibrarySongPathCacheEntry,
  clearLibrarySongPathCacheNamespace,
  getLibrarySongPathCacheEntry,
  setLibrarySongPathCacheEntry,
} from '../caches/librarySongPathCache';

const DETAIL_PATH_CACHE_TTL_MS = 10 * 60 * 1000;
const DETAIL_PATH_CACHE_NAMESPACE = 'detail';

const inFlightRequests = new Map<string, Promise<string[]>>();
const cacheVersion = ref(0);

const makeArtistKey = (artistName: string) => `artist::${artistName}`;
const makeAlbumKey = (albumKey: string, sortMode: string) => `album::${sortMode}::${albumKey}`;

const loadWithCache = async (key: string, loader: () => Promise<string[]>) => {
  activateLibrarySongPathCacheEntry(DETAIL_PATH_CACHE_NAMESPACE, key);
  const cached = getLibrarySongPathCacheEntry(DETAIL_PATH_CACHE_NAMESPACE, key);
  if (cached) {
    return cached.paths;
  }

  const inFlight = inFlightRequests.get(key);
  if (inFlight) {
    return inFlight;
  }

  const request = loader()
    .then((paths) => {
      setLibrarySongPathCacheEntry(
        DETAIL_PATH_CACHE_NAMESPACE,
        key,
        { paths },
        DETAIL_PATH_CACHE_TTL_MS,
      );
      cacheVersion.value += 1;
      return paths;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, request);
  return request;
};

export function useLibraryDetailSongPathCache() {
  const loadArtistSongPaths = async (artistName: string) => {
    if (!artistName) {
      return [];
    }

    return loadWithCache(makeArtistKey(artistName), () =>
      tauriInvoke('get_library_song_paths_by_artist', { artistName }),
    );
  };

  const loadAlbumSongPaths = async (
    albumKey: string,
    sortMode: 'title' | 'track_number' | 'track_number_desc' = 'title',
  ) => {
    if (!albumKey) {
      return [];
    }

    return loadWithCache(makeAlbumKey(albumKey, sortMode), () =>
      tauriInvoke('get_library_song_paths_by_album', { albumKey, sortMode }),
    );
  };

  return {
    loadArtistSongPaths,
    loadAlbumSongPaths,
    clearLibraryDetailSongPathCache: () => {
      clearLibrarySongPathCacheNamespace(DETAIL_PATH_CACHE_NAMESPACE);
      inFlightRequests.clear();
      cacheVersion.value += 1;
    },
    libraryDetailSongPathCacheVersion: cacheVersion,
  };
}
