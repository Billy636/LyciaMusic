import type { SongQualityMetadata } from '../types';
import { useLibraryStore } from '../features/library/store';
import { tauriInvoke } from '../services/tauri/invoke';
import { MemoryCache } from '../utils/MemoryCache';

const QUALITY_CACHE_MAX_ENTRIES = 256;
const QUALITY_CACHE_TTL_MS = 10 * 60 * 1000;

const qualityCache = new MemoryCache<string, SongQualityMetadata | null>({
  maxEntries: QUALITY_CACHE_MAX_ENTRIES,
  ttlMs: QUALITY_CACHE_TTL_MS,
});
let cacheLibraryVersion = -1;

export function useSongQualityMetadata() {
  const libraryStore = useLibraryStore();

  const syncCacheVersion = () => {
    if (cacheLibraryVersion === libraryStore.libraryDataVersion) {
      return;
    }
    qualityCache.clear();
    cacheLibraryVersion = libraryStore.libraryDataVersion;
  };

  const loadSongQualityMetadata = async (paths: string[]) => {
    syncCacheVersion();
    const uniquePaths = Array.from(new Set(paths.filter(Boolean))).slice(0, QUALITY_CACHE_MAX_ENTRIES);
    const result = new Map<string, SongQualityMetadata>();
    const missingPaths: string[] = [];

    uniquePaths.forEach((path) => {
      if (!qualityCache.has(path)) {
        missingPaths.push(path);
        return;
      }
      const cached = qualityCache.get(path);
      if (cached) {
        result.set(path, cached);
      }
    });

    if (missingPaths.length === 0) {
      return result;
    }

    const loaded = await tauriInvoke('get_song_quality_metadata', { paths: missingPaths });
    const loadedByPath = new Map(loaded.map(item => [item.path, item] as const));
    missingPaths.forEach((path) => {
      const metadata = loadedByPath.get(path) ?? null;
      qualityCache.set(path, metadata);
      if (metadata) {
        result.set(path, metadata);
      }
    });

    return result;
  };

  return {
    loadSongQualityMetadata,
    clearSongQualityMetadataCache: () => qualityCache.clear(),
  };
}
