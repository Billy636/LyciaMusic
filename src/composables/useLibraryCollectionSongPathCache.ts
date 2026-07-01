import { ref } from 'vue';

import type { HistoryItem } from '../types';
import type { LocalSortMode } from '../services/storage/playerStorage';
import { tauriInvoke } from '../services/tauri/invoke';
import { MemoryCache } from '../utils/MemoryCache';

type BackendLocalSortMode = Exclude<LocalSortMode, 'custom'>;
type SelectionSortMode = BackendLocalSortMode | 'name';
type FavoriteDetailFilter = { type: 'artist' | 'album'; name: string } | null;

const COLLECTION_VIEW_PATH_CACHE_TTL_MS = 5 * 60 * 1000;
const COLLECTION_VIEW_PATH_CACHE_MAX_ENTRIES = 96;

const collectionViewPathCache = new MemoryCache<string, string[]>({
  maxEntries: COLLECTION_VIEW_PATH_CACHE_MAX_ENTRIES,
  ttlMs: COLLECTION_VIEW_PATH_CACHE_TTL_MS,
});

const inFlightRequests = new Map<string, Promise<string[]>>();
const cacheVersion = ref(0);

const serializeHistoryItems = (items: HistoryItem[]) =>
  items
    .map(item => `${item.path}\u0002${item.playedAt}`)
    .join('\u0003');

const serializeFavoriteDetailFilter = (filter: FavoriteDetailFilter) =>
  filter ? `${filter.type}\u0001${filter.name}` : '';

const makeFavoriteCacheKey = (
  favoritePaths: string[],
  query: string,
  sortMode: SelectionSortMode,
  detailFilter: FavoriteDetailFilter,
) => [
  'favorites',
  sortMode,
  query,
  serializeFavoriteDetailFilter(detailFilter),
  favoritePaths.join('\u0002'),
].join('\u0001');

const makeRecentCacheKey = (
  recentSongs: HistoryItem[],
  query: string,
  sortMode: BackendLocalSortMode,
) => [
  'recent',
  sortMode,
  query,
  serializeHistoryItems(recentSongs),
].join('\u0001');

const loadWithCache = async (key: string, loader: () => Promise<string[]>) => {
  const cached = collectionViewPathCache.get(key);
  if (cached) {
    return cached;
  }

  const inFlight = inFlightRequests.get(key);
  if (inFlight) {
    return inFlight;
  }

  const request = loader()
    .then((paths) => {
      collectionViewPathCache.set(key, paths);
      cacheVersion.value += 1;
      return paths;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, request);
  return request;
};

export function useLibraryCollectionSongPathCache() {
  const loadFavoriteSongPaths = async ({
    favoritePaths,
    query = '',
    sortMode,
    detailFilter = null,
  }: {
    favoritePaths: string[];
    query?: string;
    sortMode: SelectionSortMode;
    detailFilter?: FavoriteDetailFilter;
  }) => {
    if (favoritePaths.length === 0) {
      return [];
    }

    const cacheKey = makeFavoriteCacheKey(favoritePaths, query, sortMode, detailFilter);
    return loadWithCache(cacheKey, () =>
      tauriInvoke('get_favorite_song_paths_view', {
        favoritePaths,
        query,
        sortMode,
        detailFilterType: detailFilter?.type,
        detailFilterValue: detailFilter?.name,
      }),
    );
  };

  const loadRecentSongPaths = async ({
    recentSongs,
    query = '',
    sortMode,
  }: {
    recentSongs: HistoryItem[];
    query?: string;
    sortMode: BackendLocalSortMode;
  }) => {
    if (recentSongs.length === 0) {
      return [];
    }

    const cacheKey = makeRecentCacheKey(recentSongs, query, sortMode);
    return loadWithCache(cacheKey, () =>
      tauriInvoke('get_recent_song_paths_view', {
        recentEntries: recentSongs.map(item => ({
          songPath: item.path,
          playedAt: item.playedAt,
        })),
        query,
        sortMode,
      }),
    );
  };

  return {
    loadFavoriteSongPaths,
    loadRecentSongPaths,
    clearLibraryCollectionSongPathCache: () => {
      collectionViewPathCache.clear();
      inFlightRequests.clear();
      cacheVersion.value += 1;
    },
    libraryCollectionSongPathCacheVersion: cacheVersion,
  };
}
