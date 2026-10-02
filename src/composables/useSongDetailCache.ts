import { tauriInvoke } from '../services/tauri/invoke';
import type { SongDetail } from '../types';
import { MemoryCache } from '../utils/MemoryCache';

const SONG_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const SONG_DETAIL_CACHE_MAX_ENTRIES = 8;

const songDetailCache = new MemoryCache<string, SongDetail>({
  maxEntries: SONG_DETAIL_CACHE_MAX_ENTRIES,
  ttlMs: SONG_DETAIL_CACHE_TTL_MS,
});

const inFlightRequests = new Map<string, Promise<SongDetail | null>>();
let cacheGeneration = 0;

export function useSongDetailCache() {
  const loadSongDetail = async (path: string) => {
    if (!path) {
      return null;
    }

    const cached = songDetailCache.get(path);
    if (cached) {
      return cached;
    }

    const inFlight = inFlightRequests.get(path);
    if (inFlight) {
      return inFlight;
    }

    const requestGeneration = cacheGeneration;
    const request = tauriInvoke('get_song_detail', { path })
      .then((detail) => {
        if (requestGeneration !== cacheGeneration) {
          return null;
        }
        songDetailCache.set(path, detail);
        return detail;
      })
      .finally(() => {
        if (inFlightRequests.get(path) === request) {
          inFlightRequests.delete(path);
        }
      });

    inFlightRequests.set(path, request);
    return request;
  };

  return {
    loadSongDetail,
    clearSongDetailCache: () => {
      cacheGeneration += 1;
      songDetailCache.clear();
      inFlightRequests.clear();
    },
  };
}
