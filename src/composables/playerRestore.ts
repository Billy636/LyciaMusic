import type { HistoryItem, Song } from '../types';
import { playerStorage } from '../services/storage/playerStorage';
import { historyApi } from '../services/tauri/historyApi';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { useCoverCache } from './useCoverCache';
import { useLibrarySongResolver } from './useLibrarySongResolver';

interface PlayerRestoreKeys {
  playerPlaylistPaths: string;
  playerQueuePaths: string;
  playerLastSongPath: string;
  legacyPlayerPlaylist: string;
  legacyPlayerQueue: string;
  legacyPlayerHistory: string;
  legacyPlayerLastSong: string;
}

interface CreatePlayerRestoreDeps {
  keys: PlayerRestoreKeys;
  createSongLookup: (fallbackSongs?: Song[]) => Map<string, Song>;
  readStoredHistory: (key: string) => HistoryItem[];
  readStoredSongArray: (key: string) => Song[];
  readStoredSong: (key: string) => Song | null;
  readStoredStringArray: (key: string) => string[] | null;
  loadLibrarySongsFromCache: () => Promise<void>;
}

export const createPlayerRestore = ({
  keys,
  createSongLookup,
  readStoredHistory,
  readStoredSongArray,
  readStoredSong,
  readStoredStringArray,
  loadLibrarySongsFromCache,
}: CreatePlayerRestoreDeps) => {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const { loadCover, retainFullCoverPaths } = useCoverCache();
  const { loadSong, rememberSongs } = useLibrarySongResolver();

  const restoreRecentHistory = async () => {
    const legacyHistory = readStoredHistory(keys.legacyPlayerHistory);

    try {
      const records = await historyApi.getRecentHistory(200);
      if (records.length > 0) {
        collectionsStore.setRecentSongs(records
          .map(record => ({
            path: record.songPath,
            playedAt: record.playedAt,
          })));

        if (collectionsStore.recentSongs.length > 0) {
          playerStorage.remove(keys.legacyPlayerHistory);
          return;
        }
      }
    } catch (error) {
      console.warn('get_recent_history failed:', error);
    }

    if (legacyHistory.length === 0) {
      collectionsStore.setRecentSongs([]);
      return;
    }

    collectionsStore.setRecentSongs(legacyHistory.slice(0, 200));

    const importedEntries = legacyHistory.map(item => ({
      songPath: item.path,
      playedAt: Math.floor(item.playedAt / 1000),
    }));

    try {
      await historyApi.importRecentHistory(importedEntries);
      playerStorage.remove(keys.legacyPlayerHistory);
    } catch (error) {
      console.warn('import_recent_history failed:', error);
    }
  };

  const restorePathBackedState = async () => {
    await playbackStore.startupPathsPromise;

    if (
      playbackStore.hasExternalStartupFile
      || playbackStore.playQueuePaths.length > 0
      || playbackStore.currentSong !== null
    ) {
      return;
    }

    const legacySongList = readStoredSongArray(keys.legacyPlayerPlaylist);
    const legacyQueue = readStoredSongArray(keys.legacyPlayerQueue);
    const legacyLastSong = readStoredSong(keys.legacyPlayerLastSong);
    const fallbackSongs = [
      ...legacySongList,
      ...legacyQueue,
      ...(legacyLastSong ? [legacyLastSong] : []),
    ];

    if (libraryStore.canonicalSongPaths.length === 0) {
      await loadLibrarySongsFromCache();
      if (
        playbackStore.hasExternalStartupFile
        || playbackStore.playQueuePaths.length > 0
        || playbackStore.currentSong !== null
      ) {
        return;
      }
    }

    const storedSongListPaths = readStoredStringArray(keys.playerPlaylistPaths)
      ?? legacySongList.map(song => song.path);
    const storedQueuePaths = readStoredStringArray(keys.playerQueuePaths)
      ?? legacyQueue.map(song => song.path);
    const storedLastSongPath = playerStorage.getString(keys.playerLastSongPath)
      ?? legacyLastSong?.path
      ?? null;

    rememberSongs(fallbackSongs);
    libraryStore.setSourceSongOrder(storedSongListPaths);
    playbackStore.playQueuePaths = storedQueuePaths;

    if (storedLastSongPath) {
      playbackStore.currentSong = await loadSong(storedLastSongPath)
        ?? createSongLookup(fallbackSongs).get(storedLastSongPath)
        ?? legacyLastSong;
    }

    if (playbackStore.currentSong?.path) {
      loadCover(playbackStore.currentSong.path)
        .then(cover => {
          playbackStore.currentCover = cover || '';
          playbackStore.currentCoverFull = playbackStore.currentCover;
          retainFullCoverPaths([]);
        })
        .catch(() => {});
      playbackStore.isSongLoaded = false;
    }
  };

  return {
    restoreRecentHistory,
    restorePathBackedState,
  };
};
