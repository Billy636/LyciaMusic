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

  const request = tauriInvoke('get_library_songs_by_paths', { paths: [path] })
    .then((songs) => {
      const song = songs[0] ?? null;
      if (song) {
        resolvedSongCache.set(path, song);
      }
      return song;
    })
    .finally(() => {
      inFlightSongs.delete(path);
    });
  inFlightSongs.set(path, request);
  return request;
};

const loadSongs = async (paths: string[]): Promise<LibrarySong[]> => {
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

  for (let offset = 0; offset < missingPaths.length; offset += SONG_BATCH_SIZE) {
    const chunk = missingPaths.slice(offset, offset + SONG_BATCH_SIZE);
    const loaded = await tauriInvoke('get_library_songs_by_paths', { paths: chunk });
    loaded.forEach((song) => {
      resolvedSongCache.set(song.path, song);
      result.set(song.path, song);
    });
  }

  return paths
    .map(path => result.get(path))
    .filter((song): song is LibrarySong => !!song);
};

export function useLibrarySongResolver() {
  return {
    loadSong,
    loadSongs,
    rememberSongs,
    peekSong: (path: string) => resolvedSongCache.get(path) ?? null,
    clearResolvedSongCache: () => {
      resolvedSongCache.clear();
      inFlightSongs.clear();
    },
  };
}
