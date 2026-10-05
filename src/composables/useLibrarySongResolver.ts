import { tauriInvoke } from '../services/tauri/invoke';
import type { LibrarySong, Song } from '../types';
import { MemoryCache } from '../utils/MemoryCache';

const RESOLVED_SONG_CACHE_MAX_ENTRIES = 64;
const RESOLVED_SONG_CACHE_TTL_MS = 10 * 60 * 1000;
const SONG_BATCH_SIZE = 256;

const resolvedSongCache = new MemoryCache<string, Song>({
  maxEntries: RESOLVED_SONG_CACHE_MAX_ENTRIES,
  ttlMs: RESOLVED_SONG_CACHE_TTL_MS,
});
const inFlightSongs = new Map<string, Promise<Song | null>>();
const inFlightBatches = new Set<{ invalidatedPaths: Set<string> }>();
let cacheGeneration = 0;

const rememberSongs = (songs: Song[]) => {
  songs.forEach((song) => {
    if (song?.path) {
      resolvedSongCache.set(song.path, song);
    }
  });
};

const loadSong = (path: string): Promise<Song | null> => {
  if (!path) {
    return Promise.resolve(null);
  }
  const cached = resolvedSongCache.get(path);
  if (cached) {
    return Promise.resolve(cached);
  }
  const inFlight = inFlightSongs.get(path);
  if (inFlight) {
    return inFlight;
  }

  const requestGeneration = cacheGeneration;
  const request = tauriInvoke('get_library_songs_by_paths', { paths: [path] })
    .then((songs) => {
      if (requestGeneration !== cacheGeneration || inFlightSongs.get(path) !== request) {
        return null;
      }
      const song = songs[0] ?? null;
      if (song) {
        resolvedSongCache.set(path, song);
      }
      return song;
    })
    .finally(() => {
      if (inFlightSongs.get(path) === request) {
        inFlightSongs.delete(path);
      }
    });
  inFlightSongs.set(path, request);
  return request;
};

const loadSongs = async (paths: string[]): Promise<LibrarySong[]> => {
  const requestGeneration = cacheGeneration;
  const batch = { invalidatedPaths: new Set<string>() };
  const result = new Map<string, LibrarySong>();
  const missingPaths: string[] = [];
  const missingPathSet = new Set<string>();
  paths.forEach((path) => {
    const cached = resolvedSongCache.get(path);
    if (cached) {
      result.set(path, cached as LibrarySong);
    } else if (path && !missingPathSet.has(path)) {
      missingPathSet.add(path);
      missingPaths.push(path);
    }
  });

  inFlightBatches.add(batch);
  try {
    for (let offset = 0; offset < missingPaths.length; offset += SONG_BATCH_SIZE) {
      const chunk = missingPaths.slice(offset, offset + SONG_BATCH_SIZE);
      const loaded = await tauriInvoke('get_library_songs_by_paths', { paths: chunk });
      if (requestGeneration !== cacheGeneration) {
        return [];
      }
      loaded.forEach((song) => {
        if (batch.invalidatedPaths.has(song.path)) {
          return;
        }
        resolvedSongCache.set(song.path, song);
        result.set(song.path, song);
      });
    }

    // A single-song refresh can invalidate part of a batch without changing
    // the library version (for example, replacing only artwork or lyrics).
    // Recover those records instead of publishing a permanently incomplete list.
    const invalidatedSongs = new Map(await Promise.all(
      [...batch.invalidatedPaths]
        .filter(path => result.has(path) || missingPathSet.has(path))
        .map(async path => [path, await loadSong(path)] as const),
    ));
    if (requestGeneration !== cacheGeneration) {
      return [];
    }

    return paths
      .map(path => batch.invalidatedPaths.has(path)
        // A newer refresh may have published another snapshot during recovery.
        ? resolvedSongCache.get(path) ?? invalidatedSongs.get(path)
        : result.get(path))
      .filter((song): song is LibrarySong => !!song);
  } finally {
    inFlightBatches.delete(batch);
  }
};

export function useLibrarySongResolver() {
  return {
    loadSong,
    loadSongs,
    rememberSongs,
    peekSong: (path: string) => resolvedSongCache.get(path) ?? null,
    clearResolvedSongCache: (path?: string) => {
      if (path !== undefined) {
        resolvedSongCache.delete(path);
        inFlightSongs.delete(path);
        // Batch loads also cache songs; keep their other paths usable while
        // preventing an old response from restoring this song after refresh.
        for (const batch of inFlightBatches) {
          batch.invalidatedPaths.add(path);
        }
        return;
      }
      cacheGeneration += 1;
      resolvedSongCache.clear();
      inFlightSongs.clear();
    },
  };
}
