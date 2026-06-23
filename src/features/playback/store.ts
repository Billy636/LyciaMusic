import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';

import { useLibraryStore } from '../library/store';
import type { Song } from '../../types';

const areSamePaths = (left: string[], right: string[]) =>
  left.length === right.length && left.every((path, index) => path === right[index]);

export const usePlaybackStore = defineStore('playback', () => {
  const libraryStore = useLibraryStore();
  const isPlaying = ref(false);
  const volume = ref(100);
  const currentTime = ref(0);
  const playMode = ref(0);
  const isSongLoaded = ref(false);
  const currentPlaybackId = ref(0);
  const playQueuePaths = shallowRef<string[]>([]);
  const tempQueuePaths = shallowRef<string[]>([]);
  const currentSongPath = ref<string | null>(null);
  const queueFallbackSongs = new Map<string, Song>();
  const tempQueueFallbackSongs = new Map<string, Song>();
  const currentSongFallback = ref<Song | null>(null);
  const currentCover = ref('');
  const currentCoverPath = ref('');
  const currentCoverFull = ref('');

  const pruneFallbackSongs = () => {
    const queuedPaths = new Set<string>([
      ...playQueuePaths.value,
      ...tempQueuePaths.value,
    ]);

    for (const [path] of queueFallbackSongs) {
      if (!queuedPaths.has(path) || libraryStore.getSongByPath(path)) {
        queueFallbackSongs.delete(path);
      }
    }

    for (const [path] of tempQueueFallbackSongs) {
      if (!queuedPaths.has(path) || libraryStore.getSongByPath(path)) {
        tempQueueFallbackSongs.delete(path);
      }
    }

    if (currentSongPath.value && libraryStore.getSongByPath(currentSongPath.value)) {
      currentSongFallback.value = null;
    }
    if (currentSongPath.value !== currentSongFallback.value?.path) {
      currentSongFallback.value = null;
    }
  };

  const normalizeSongs = (songs: Song[], fallbackMap: Map<string, Song>) => {
    const nextPaths: string[] = [];
    const seenPaths = new Set<string>();

    songs.forEach((song) => {
      if (!song?.path || seenPaths.has(song.path)) {
        return;
      }

      seenPaths.add(song.path);
      nextPaths.push(song.path);

      if (!libraryStore.getSongByPath(song.path)) {
        fallbackMap.set(song.path, song);
      } else {
        fallbackMap.delete(song.path);
      }
    });

    return nextPaths;
  };

  const materializeSongs = (paths: string[], fallbackMap: Map<string, Song>) =>
    paths
      .map(path => libraryStore.getSongByPath(path, fallbackMap.get(path)))
      .filter((song): song is Song => !!song);

  const playQueue = computed<Song[]>({
    get: () => materializeSongs(playQueuePaths.value, queueFallbackSongs),
    set: (songs) => {
      const nextPaths = normalizeSongs(songs, queueFallbackSongs);
      if (!areSamePaths(playQueuePaths.value, nextPaths)) {
        playQueuePaths.value = nextPaths;
      }
      pruneFallbackSongs();
    },
  });

  const tempQueue = computed<Song[]>({
    get: () => materializeSongs(tempQueuePaths.value, tempQueueFallbackSongs),
    set: (songs) => {
      const nextPaths = normalizeSongs(songs, tempQueueFallbackSongs);
      if (!areSamePaths(tempQueuePaths.value, nextPaths)) {
        tempQueuePaths.value = nextPaths;
      }
      pruneFallbackSongs();
    },
  });

  const currentSong = computed<Song | null>({
    get: () => libraryStore.getSongByPath(currentSongPath.value, currentSongFallback.value),
    set: (song) => {
      currentSongPath.value = song?.path ?? null;
      currentSongFallback.value = song && !libraryStore.getSongByPath(song.path) ? song : null;
      pruneFallbackSongs();
    },
  });

  const resetPlaybackState = () => {
    isPlaying.value = false;
    currentTime.value = 0;
    isSongLoaded.value = false;
    playQueuePaths.value = [];
    tempQueuePaths.value = [];
    currentSongPath.value = null;
    currentSongFallback.value = null;
    queueFallbackSongs.clear();
    tempQueueFallbackSongs.clear();
    currentCover.value = '';
    currentCoverPath.value = '';
    currentCoverFull.value = '';
  };

  const hasExternalStartupFile = ref(false);
  const isStartupPathsResolved = ref(false);
  let startupResolver: (() => void) | null = null;
  const startupPathsPromise = new Promise<void>((resolve) => {
    startupResolver = resolve;
  });

  const markExternalStartupFile = () => {
    hasExternalStartupFile.value = true;
  };

  const markStartupPathsResolved = () => {
    if (isStartupPathsResolved.value) {
      return;
    }
    isStartupPathsResolved.value = true;
    if (startupResolver) {
      startupResolver();
      startupResolver = null;
    }
  };

  return {
    isPlaying,
    volume,
    currentTime,
    playMode,
    isSongLoaded,
    currentPlaybackId,
    playQueue,
    playQueuePaths,
    tempQueue,
    tempQueuePaths,
    currentSong,
    currentSongPath,
    currentCover,
    currentCoverPath,
    currentCoverFull,
    resetPlaybackState,
    hasExternalStartupFile,
    isStartupPathsResolved,
    startupPathsPromise,
    markExternalStartupFile,
    markStartupPathsResolved,
  };
});
