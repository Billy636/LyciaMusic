import { storeToRefs } from 'pinia';
import type { Song } from '../types';

import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { useCollectionsStore } from '../features/collections/store';
import { removeSongPathsFromPlaybackState } from './playbackCleanup';
import { isProfilingEnabled } from '../utils/profiling';

const LIBRARY_SCAN_BATCH_FLUSH_MS = 120;

interface CreatePlayerLibraryBatchDeps {
  createSongLookup: (fallbackSongs?: Song[]) => Map<string, Song>;
}

export const createPlayerLibraryBatch = ({
  createSongLookup,
}: CreatePlayerLibraryBatchDeps) => {
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const collectionsStore = useCollectionsStore();
  const { canonicalSongPaths } = storeToRefs(libraryStore);
  const { currentSong, playQueuePaths, tempQueuePaths } = storeToRefs(playbackStore);
  let libraryScanBatchFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingLibraryScanSongs = new Map<string, Song>();
  const pendingLibraryScanDeletedPaths = new Set<string>();

  const refreshStateSongReferences = (fallbackSongs: Song[] = []) => {
    const lookup = createSongLookup(fallbackSongs);

    if (currentSong.value?.path) {
      currentSong.value = lookup.get(currentSong.value.path) ?? currentSong.value;
    }
  };

  const flushBufferedLibraryScanBatch = () => {
    if (libraryScanBatchFlushTimer) {
      clearTimeout(libraryScanBatchFlushTimer);
      libraryScanBatchFlushTimer = null;
    }

    if (pendingLibraryScanSongs.size === 0 && pendingLibraryScanDeletedPaths.size === 0) {
      return;
    }

    const startTime = isProfilingEnabled() ? performance.now() : 0;
    const pendingSongsCount = pendingLibraryScanSongs.size;
    const pendingDeletedCount = pendingLibraryScanDeletedPaths.size;

    libraryStore.patchLibrarySongPaths({
      added_paths: Array.from(pendingLibraryScanSongs.keys()),
      deleted_paths: Array.from(pendingLibraryScanDeletedPaths.values()),
    });
    const activeSongUpdate = currentSong.value?.path
      ? pendingLibraryScanSongs.get(currentSong.value.path)
      : null;
    if (activeSongUpdate) {
      currentSong.value = activeSongUpdate;
    }

    pendingLibraryScanSongs.clear();
    pendingLibraryScanDeletedPaths.clear();

    if (isProfilingEnabled()) {
      const duration = performance.now() - startTime;
      console.log(`[Profiling] flushBufferedLibraryScanBatch took ${duration.toFixed(2)}ms (added/updated batch: ${pendingSongsCount}, deleted: ${pendingDeletedCount}, total canonical: ${canonicalSongPaths.value.length})`);
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
    }

    const deletedPaths = Array.from(pendingLibraryScanDeletedPaths);
    if (deletedPaths.length > 0) {
      const deletedSet = new Set(deletedPaths);
      removeSongPathsFromPlaybackState({
        playQueuePaths,
        tempQueuePaths,
        currentSong,
      }, deletedPaths);
      collectionsStore.favoritePaths = collectionsStore.favoritePaths.filter(path => !deletedSet.has(path));
      collectionsStore.playlists.forEach((playlist) => {
        playlist.songPaths = playlist.songPaths.filter(path => !deletedSet.has(path));
      });
      collectionsStore.recentSongs = collectionsStore.recentSongs.filter(item => !deletedSet.has(item.path));
    }

    for (const song of incomingSongs) {
      if (!song?.path) continue;
      pendingLibraryScanDeletedPaths.delete(song.path);
      pendingLibraryScanSongs.set(song.path, song);
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
  };

  return {
    applyLibraryScanBatch,
    flushBufferedLibraryScanBatch,
    refreshStateSongReferences,
    dispose,
  };
};
