import type { Song, SongRuntimeMetadata } from '../types';
import { tauriInvoke } from '../services/tauri/invoke';
import { MemoryCache } from '../utils/MemoryCache';

const RUNTIME_METADATA_CACHE_MAX_ENTRIES = 32;
const RUNTIME_METADATA_CACHE_TTL_MS = 10 * 60 * 1000;

const runtimeMetadataCache = new MemoryCache<string, SongRuntimeMetadata | null>({
  maxEntries: RUNTIME_METADATA_CACHE_MAX_ENTRIES,
  ttlMs: RUNTIME_METADATA_CACHE_TTL_MS,
});
const inFlightRequests = new Map<string, Promise<SongRuntimeMetadata | null>>();

const loadSongRuntimeMetadata = (path: string) => {
  if (!path) {
    return Promise.resolve(null);
  }

  if (runtimeMetadataCache.has(path)) {
    return Promise.resolve(runtimeMetadataCache.get(path) ?? null);
  }

  const inFlight = inFlightRequests.get(path);
  if (inFlight) {
    return inFlight;
  }

  const request = tauriInvoke('get_song_runtime_metadata', { path })
    .then((metadata) => {
      runtimeMetadataCache.set(path, metadata);
      return metadata;
    })
    .finally(() => {
      inFlightRequests.delete(path);
    });

  inFlightRequests.set(path, request);
  return request;
};

export function useSongRuntimeMetadata() {
  const resolveSongForPlayback = async (song: Song): Promise<Song> => {
    const metadata = await loadSongRuntimeMetadata(song.path);
    if (metadata) {
      Object.assign(song, metadata);
    }
    return song;
  };

  return {
    resolveSongForPlayback,
    clearSongRuntimeMetadataCache: () => {
      runtimeMetadataCache.clear();
      inFlightRequests.clear();
    },
  };
}
