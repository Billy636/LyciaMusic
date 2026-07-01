import { ref } from 'vue';

import { tauriInvoke } from '../services/tauri/invoke';
import { MemoryCache } from '../utils/MemoryCache';

const DETAIL_PATH_CACHE_TTL_MS = 10 * 60 * 1000;
const DETAIL_PATH_CACHE_MAX_ENTRIES = 96;

const detailPathCache = new MemoryCache<string, string[]>({
  maxEntries: DETAIL_PATH_CACHE_MAX_ENTRIES,
  ttlMs: DETAIL_PATH_CACHE_TTL_MS,
});

const inFlightRequests = new Map<string, Promise<string[]>>();
const cacheVersion = ref(0);

const makeArtistKey = (artistName: string) => `artist::${artistName}`;
const makeAlbumKey = (albumKey: string, sortMode: string) => `album::${sortMode}::${albumKey}`;

const loadWithCache = async (key: string, loader: () => Promise<string[]>) => {
  const cached = detailPathCache.get(key);
  if (cached) {
    return cached;
  }

  const inFlight = inFlightRequests.get(key);
  if (inFlight) {
    return inFlight;
  }

  const request = loader()
    .then((paths) => {
      detailPathCache.set(key, paths);
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
      detailPathCache.clear();
      inFlightRequests.clear();
      cacheVersion.value += 1;
    },
    libraryDetailSongPathCacheVersion: cacheVersion,
  };
}
