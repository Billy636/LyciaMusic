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
    // 本地持久化的最近播放列表是顺序与重复规则的权威来源，避免数据库按秒粒度
    // 重排导致「刚播放的歌没排到最前」。
    if (collectionsStore.recentSongs.length > 0) return;

    const legacyHistory = readStoredHistory(keys.legacyPlayerHistory);
    const songLookup = createSongLookup();
    const identityOf = (path: string) => {
      const song = songLookup.get(path);
      if (!song) return '';
      return [song.artist, song.title || song.name].filter(Boolean)
        .map(value => String(value).trim().toLowerCase()).join('|');
    };
    const collapseAdjacent = (items: HistoryItem[]) => {
      const seen = new Set<string>();
      return items.reduce<HistoryItem[]>((acc, item) => {
        const key = item.identity || identityOf(item.path);
        if (key && seen.has(key)) return acc;
        if (key) seen.add(key);
        acc.push({ ...item, identity: key || undefined });
        return acc;
      }, []).slice(0, 100);
    };

    try {
      const records = await historyApi.getRecentHistory(100);
      if (records.length > 0) {
        collectionsStore.setRecentSongs(collapseAdjacent(records
          .map(record => ({
            path: record.songPath,
            playedAt: record.playedAt,
          }))));

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

    collectionsStore.setRecentSongs(collapseAdjacent(legacyHistory.slice(0, 90)));

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
