import { storeToRefs } from 'pinia';

import { playbackApi } from '../services/tauri/playbackApi';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { createShuffleCycle } from '../features/playback/shuffle';
import { registerUpcomingSongPeek, type SongSwitchDirection } from '../features/songNotification/upcoming';
import { playerStorage, playerStorageKeys } from '../services/storage/playerStorage';
import type { Song } from '../types';
import { useLibrarySongResolver } from './useLibrarySongResolver';

interface QueuePlaySongOptions {
  updateShuffleHistory?: boolean;
  clearShuffleFuture?: boolean;
  preserveQueue?: boolean;
  insertAfterCurrent?: boolean;
}

interface CreatePlayerQueueDeps {
  playSong: (song: Song, options?: QueuePlaySongOptions) => void | Promise<void>;
  stopPlaybackRuntime: () => void;
  showToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

export const createPlayerQueue = ({
  playSong,
  stopPlaybackRuntime,
  showToast,
}: CreatePlayerQueueDeps) => {
  const SHUFFLE_HISTORY_LIMIT = 256;
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const {
    currentSong,
    isPlaying,
    playMode,
    playQueuePaths,
    tempQueuePaths,
  } = storeToRefs(playbackStore);
  const { loadSong, loadSongs, peekSong, rememberSongs } = useLibrarySongResolver();
  const savedShuffle = playerStorage.readObject<{
    version?: number;
    cycle?: unknown;
    history?: unknown;
    future?: unknown;
  }>(playerStorageKeys.shuffleState);
  const restoredShuffle = savedShuffle?.version === 1 ? savedShuffle : null;
  const readHistory = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((path): path is string => typeof path === 'string' && !!path).slice(-SHUFFLE_HISTORY_LIMIT)
    : [];
  const shuffleCycle = createShuffleCycle(restoredShuffle?.cycle);
  const shuffleHistory = readHistory(restoredShuffle?.history);
  const shuffleFuture = readHistory(restoredShuffle?.future);
  let navigationRequestId = 0;

  const persistShuffle = () => {
    try {
      playerStorage.setString(playerStorageKeys.shuffleState, JSON.stringify({
        version: 1,
        cycle: shuffleCycle.snapshot(),
        history: shuffleHistory,
        future: shuffleFuture,
      }));
    } catch (error) {
      console.warn('Failed to save shuffle progress:', error);
    }
  };

  const resetShuffleState = () => {
    navigationRequestId += 1;
    shuffleHistory.length = 0;
    shuffleFuture.length = 0;
    shuffleCycle.reset();
    persistShuffle();
  };

  const pushBounded = (target: string[], path: string) => {
    target.push(path);
    if (target.length > SHUFFLE_HISTORY_LIMIT) {
      target.splice(0, target.length - SHUFFLE_HISTORY_LIMIT);
    }
  };

  const handleBeforePlay = (song: Song, options: QueuePlaySongOptions = {}) => {
    if (!options.preserveQueue) navigationRequestId += 1;
    const shouldUpdateShuffleHistory = options.updateShuffleHistory ?? true;
    const shouldClearShuffleFuture = options.clearShuffleFuture ?? true;
    const previousSong = currentSong.value;

    if (
      playMode.value === 2 &&
      shouldUpdateShuffleHistory &&
      previousSong &&
      previousSong.path !== song.path
    ) {
      pushBounded(shuffleHistory, previousSong.path);
      if (shouldClearShuffleFuture) {
        shuffleFuture.length = 0;
      }
    }
    if (playMode.value === 2) {
      shuffleCycle.record(song.path, getNavigationPaths(), previousSong?.path);
    } else {
      shuffleCycle.remember(song.path);
    }
    persistShuffle();
  };

  const getNavigationPaths = () =>
    playQueuePaths.value.length ? playQueuePaths.value : libraryStore.sourceSongPaths;

  const getCachedSong = (path: string | undefined) => {
    if (!path) return null;
    if (currentSong.value?.path === path) return currentSong.value;
    return playbackStore.getKnownSongByPath(path) ?? peekSong(path);
  };

  const preloadAdjacentSongs = (paths: string[], activeIndex: number) => {
    if (paths.length < 2 || activeIndex < 0) {
      return;
    }
    const nextPaths = [
      paths[(activeIndex + 1) % paths.length],
      paths[(activeIndex + 2) % paths.length],
    ].filter((path, index, values) => !!path && values.indexOf(path) === index);
    void loadSongs(nextPaths).catch(() => {});
  };

  const playPath = (path: string | undefined, options: QueuePlaySongOptions = {}) => {
    if (!path) return;
    const requestId = ++navigationRequestId;
    const playOptions: QueuePlaySongOptions = {
      preserveQueue: true,
      ...options,
    };
    const cachedSong = getCachedSong(path);
    if (cachedSong) {
      void playSong(cachedSong, playOptions);
      return;
    }
    void loadSong(path)
      .then((song) => {
        if (requestId !== navigationRequestId) return;
        if (song) {
          void playSong(song, playOptions);
        } else if (playMode.value === 2) {
          shuffleCycle.discard(path);
          persistShuffle();
        }
      })
      .catch(() => {});
  };

  const pickRandomPath = (paths: string[]) => {
    return shuffleCycle.peekNext(paths, currentSong.value?.path);
  };

  const nextSong = () => {
    if (tempQueuePaths.value.length > 0) {
      const [nextPath, ...remainingPaths] = tempQueuePaths.value;
      tempQueuePaths.value = remainingPaths;
      if (nextPath) {
        playPath(nextPath);
        return;
      }
    }

    const navigationPaths = getNavigationPaths();
    if (!navigationPaths.length) return;

    if (playMode.value === 2) {
      while (shuffleFuture.length > 0) {
        const futurePath = shuffleFuture.pop()!;
        if (navigationPaths.includes(futurePath)) {
          playPath(futurePath, { clearShuffleFuture: false });
          return;
        }
      }

      const randomPath = pickRandomPath(navigationPaths);
      if (randomPath) {
        playPath(randomPath);
      }
      return;
    }

    let index = navigationPaths.indexOf(currentSong.value?.path ?? '');
    index = (index + 1) % navigationPaths.length;
    playPath(navigationPaths[index]);
    preloadAdjacentSongs(navigationPaths, index);
  };

  const prevSong = () => {
    const navigationPaths = getNavigationPaths();
    if (!navigationPaths.length) return;

    if (playMode.value === 2) {
      while (shuffleHistory.length > 0) {
        const previousPath = shuffleHistory.pop()!;
        if (navigationPaths.includes(previousPath)) {
          if (currentSong.value) {
            pushBounded(shuffleFuture, currentSong.value.path);
          }
          playPath(previousPath, { updateShuffleHistory: false, clearShuffleFuture: false });
          return;
        }
      }

      const randomPath = pickRandomPath(navigationPaths);
      if (randomPath) {
        playPath(randomPath);
      }
      return;
    }

    let index = navigationPaths.indexOf(currentSong.value?.path ?? '');
    index = (index - 1 + navigationPaths.length) % navigationPaths.length;
    playPath(navigationPaths[index]);
    preloadAdjacentSongs(navigationPaths, index);
  };

  /**
   * 切歌提示专用：不改动队列，只预览按当前顺序/随机模式真正会播到的歌。
   * 与 nextSong/prevSong 共用同一套导航路径与随机历史，避免提示与实际切歌不一致。
   */
  const peekPathForSwitch = (direction: SongSwitchDirection): string | undefined => {
    if (direction === 'next' && tempQueuePaths.value.length > 0) {
      return tempQueuePaths.value[0];
    }

    const navigationPaths = getNavigationPaths();
    if (!navigationPaths.length) return undefined;

    if (playMode.value === 2) {
      const remembered = direction === 'next'
        ? shuffleFuture[shuffleFuture.length - 1]
        : shuffleHistory[shuffleHistory.length - 1];
      if (remembered && navigationPaths.includes(remembered)) return remembered;
      return shuffleCycle.peekNext(navigationPaths, currentSong.value?.path);
    }

    let index = navigationPaths.indexOf(currentSong.value?.path ?? '');
    index = direction === 'next'
      ? (index + 1) % navigationPaths.length
      : (index - 1 + navigationPaths.length) % navigationPaths.length;
    return navigationPaths[index];
  };

  const peekSongForSwitch = (direction: SongSwitchDirection): Song | null => {
    const path = peekPathForSwitch(direction);
    // 单曲列表 / 单曲循环时没有「另一首」，不弹切歌提示。
    if (!path || path === currentSong.value?.path) return null;
    return getCachedSong(path);
  };

  registerUpcomingSongPeek({
    next: () => peekSongForSwitch('next'),
    previous: () => peekSongForSwitch('previous'),
    nextPath: () => peekPathForSwitch('next'),
    previousPath: () => peekPathForSwitch('previous'),
  });

  const clearQueue = async () => {
    playQueuePaths.value = [];
    tempQueuePaths.value = [];
    resetShuffleState();

    if (isPlaying.value) {
      await playbackApi.pauseAudio();
      isPlaying.value = false;
    }

    stopPlaybackRuntime();
    currentSong.value = null;
  };

  const removeSongFromQueue = (song: Song) => {
    playQueuePaths.value = playQueuePaths.value.filter(path => path !== song.path);
    tempQueuePaths.value = tempQueuePaths.value.filter(path => path !== song.path);
  };

  const appendUniquePaths = (existing: string[], incoming: string[]) => {
    const seen = new Set(existing);
    const result = [...existing];
    incoming.forEach((path) => {
      if (path && !seen.has(path)) {
        seen.add(path);
        result.push(path);
      }
    });
    return result;
  };

  const addSongToQueue = (song: Song) => {
    rememberSongs([song]);
    playQueuePaths.value = appendUniquePaths(playQueuePaths.value, [song.path]);
    showToast('已添加到播放队列', 'success');
  };

  const addSongsToQueue = (songs: Song[]) => {
    if (songs.length === 0) return;
    rememberSongs(songs);
    playQueuePaths.value = appendUniquePaths(playQueuePaths.value, songs.map(song => song.path));
    showToast(`已添加 ${songs.length} 首歌曲到播放队列`, 'success');
  };

  const addSongPathsToQueue = (paths: string[]) => {
    const normalizedPaths = paths.filter(Boolean);
    if (normalizedPaths.length === 0) return;
    playQueuePaths.value = appendUniquePaths(playQueuePaths.value, normalizedPaths);
    showToast(`已添加 ${normalizedPaths.length} 首歌曲到播放队列`, 'success');
  };

  const toggleMode = () => {
    playMode.value = (playMode.value + 1) % 3;
    resetShuffleState();
  };

  const playNext = (song: Song) => {
    rememberSongs([song]);
    tempQueuePaths.value = [song.path, ...tempQueuePaths.value.filter(path => path !== song.path)];
  };

  return {
    resetShuffleState,
    handleBeforePlay,
    nextSong,
    prevSong,
    clearQueue,
    removeSongFromQueue,
    addSongToQueue,
    addSongsToQueue,
    addSongPathsToQueue,
    toggleMode,
    playNext,
  };
};
