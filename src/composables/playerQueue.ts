import { storeToRefs } from 'pinia';

import { playbackApi } from '../services/tauri/playbackApi';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
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
  const shuffleHistory: string[] = [];
  const shuffleFuture: string[] = [];

  const resetShuffleState = () => {
    shuffleHistory.length = 0;
    shuffleFuture.length = 0;
  };

  const pushBounded = (target: string[], path: string) => {
    target.push(path);
    if (target.length > SHUFFLE_HISTORY_LIMIT) {
      target.splice(0, target.length - SHUFFLE_HISTORY_LIMIT);
    }
  };

  const handleBeforePlay = (song: Song, options: QueuePlaySongOptions = {}) => {
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
    const cachedSong = getCachedSong(path);
    if (cachedSong) {
      void playSong(cachedSong, options);
      return;
    }
    void loadSong(path)
      .then((song) => {
        if (song) {
          void playSong(song, options);
        }
      })
      .catch(() => {});
  };

  const pickRandomPath = (paths: string[]) => {
    if (paths.length === 0) return null;
    if (paths.length === 1) return paths[0];

    const currentPath = currentSong.value?.path;
    const candidates = currentPath ? paths.filter(path => path !== currentPath) : paths;
    if (candidates.length === 0) return paths[0];
    return candidates[Math.floor(Math.random() * candidates.length)];
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
      const futurePath = shuffleFuture.pop();
      if (futurePath && navigationPaths.includes(futurePath)) {
        playPath(futurePath, { updateShuffleHistory: false, clearShuffleFuture: false });
        return;
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
      const previousPath = shuffleHistory.pop();
      if (previousPath && navigationPaths.includes(previousPath)) {
        if (currentSong.value) {
          pushBounded(shuffleFuture, currentSong.value.path);
        }
        playPath(previousPath, { updateShuffleHistory: false, clearShuffleFuture: false });
        return;
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
