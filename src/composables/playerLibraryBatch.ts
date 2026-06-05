import { storeToRefs } from 'pinia';
import type { Song } from '../types';

import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';

const LIBRARY_SCAN_BATCH_FLUSH_MS = 120;

interface CreatePlayerLibraryBatchDeps {
  createSongLookup: (fallbackSongs?: Song[]) => Map<string, Song>;
}

export const createPlayerLibraryBatch = ({
  createSongLookup,
}: CreatePlayerLibraryBatchDeps) => {
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const { sourceSongs, canonicalSongs } = storeToRefs(libraryStore);
  const { playQueue, tempQueue, currentSong } = storeToRefs(playbackStore);
  let libraryScanBatchFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingLibraryScanSongs = new Map<string, Song>();
  const pendingLibraryScanDeletedPaths = new Set<string>();
  const pendingLibraryScanFallbackSongs = new Map<string, Song>();

  const refreshStateSongReferences = (fallbackSongs: Song[] = []) => {
    const lookup = createSongLookup(fallbackSongs);

    sourceSongs.value = sourceSongs.value
      .map(song => lookup.get(song.path))
      .filter((song): song is Song => !!song);
    playQueue.value = playQueue.value
      .map(song => lookup.get(song.path))
      .filter((song): song is Song => !!song);
    tempQueue.value = tempQueue.value
      .map(song => lookup.get(song.path))
      .filter((song): song is Song => !!song);

    if (currentSong.value?.path) {
      currentSong.value = lookup.get(currentSong.value.path) ?? null;
    }
  };

  const flushBufferedLibraryScanBatch = () => {
    if (libraryScanBatchFlushTimer) {
      clearTimeout(libraryScanBatchFlushTimer);
      libraryScanBatchFlushTimer = null;
    }

    if (pendingLibraryScanSongs.size === 0 && pendingLibraryScanDeletedPaths.size === 0) {
      pendingLibraryScanFallbackSongs.clear();
      return;
    }

    const startTime = import.meta.env.DEV ? performance.now() : 0;
    const pendingSongsCount = pendingLibraryScanSongs.size;
    const pendingDeletedCount = pendingLibraryScanDeletedPaths.size;

    // 局部增量 Patch 写入，避免 O(N^2) 的全量重建
    libraryStore.patchLibrarySongs({
      songs: Array.from(pendingLibraryScanSongs.values()),
      deleted_paths: Array.from(pendingLibraryScanDeletedPaths.values()),
    });

    refreshStateSongReferences(Array.from(pendingLibraryScanFallbackSongs.values()));

    pendingLibraryScanSongs.clear();
    pendingLibraryScanDeletedPaths.clear();
    pendingLibraryScanFallbackSongs.clear();

    if (import.meta.env.DEV) {
      const duration = performance.now() - startTime;
      console.log(`[Profiling] flushBufferedLibraryScanBatch took ${duration.toFixed(2)}ms (added/updated batch: ${pendingSongsCount}, deleted: ${pendingDeletedCount}, total canonical: ${canonicalSongs.value.length})`);
    }
  };

  const scheduleLibraryScanBatchFlush = () => {
    if (libraryScanBatchFlushTimer) return;
    libraryScanBatchFlushTimer = setTimeout(() => {
      flushBufferedLibraryScanBatch();
    }, LIBRARY_SCAN_BATCH_FLUSH_MS);
  };

  const applyLibraryScanBatch = (payload: {
    songs: Song[];
    deleted_paths: string[];
  }) => {
    const incomingSongs = Array.isArray(payload.songs) ? payload.songs : [];

    for (const deletedPath of payload.deleted_paths ?? []) {
      pendingLibraryScanDeletedPaths.add(deletedPath);
      pendingLibraryScanSongs.delete(deletedPath);
      pendingLibraryScanFallbackSongs.delete(deletedPath);
    }

    for (const song of incomingSongs) {
      if (!song?.path) continue;
      pendingLibraryScanDeletedPaths.delete(song.path);
      pendingLibraryScanSongs.set(song.path, song);
      pendingLibraryScanFallbackSongs.set(song.path, song);
    }

    scheduleLibraryScanBatchFlush();
  };

  const dispose = () => {
    if (libraryScanBatchFlushTimer) {
      clearTimeout(libraryScanBatchFlushTimer);
      libraryScanBatchFlushTimer = null;
    }
    pendingLibraryScanSongs.clear();
    pendingLibraryScanDeletedPaths.clear();
    pendingLibraryScanFallbackSongs.clear();
  };

  return {
    applyLibraryScanBatch,
    flushBufferedLibraryScanBatch,
    refreshStateSongReferences,
    dispose,
  };
};
