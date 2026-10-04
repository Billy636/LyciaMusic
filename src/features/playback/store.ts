import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';

import { useLibraryStore } from '../library/store';
import type { LibrarySong, Song } from '../../types';

const areSamePaths = (left: string[], right: string[]) =>
  left.length === right.length && left.every((path, index) => path === right[index]);

const runtimeMetadataKeys = [
  'id',
  'remote_source_id',
  'cue_source_path',
  'cue_start_offset',
  'cue_end_offset',
] as const;

export const usePlaybackStore = defineStore('playback', () => {
  const libraryStore = useLibraryStore();
  const isPlaying = ref(false);
  const volume = ref(100);
  const currentTime = ref(0);
  // Clock corrections and deliberate seeks are distinct from ordinary progress ticks.
  const clockRevision = ref(0);
  const seekRevision = ref(0);
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

  const materializeSongs = (paths: string[], fallbackMap: Map<string, Song>) => {
    libraryStore.libraryDataVersion;
    return paths
      .map(path => libraryStore.getSongByPath(path, fallbackMap.get(path)))
      .filter((song): song is Song => !!song);
  };

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
    get: () => {
      libraryStore.libraryDataVersion;
      const snapshot = currentSongFallback.value?.path === currentSongPath.value
        ? currentSongFallback.value
        : null;
      const song = libraryStore.getSongByPath(currentSongPath.value, snapshot);
      if (!song) return null;

      // The library mutates pooled records in place. Publish a new snapshot so
      // same-path tag changes notify consumers without reloading the audio.
      const updatedSong = { ...snapshot, ...song };
      if (snapshot) {
        // Runtime fields belong to the active playback snapshot, not the
        // lightweight library record (which may retain older hydrated fields).
        for (const key of runtimeMetadataKeys) {
          if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
            Object.assign(updatedSong, { [key]: snapshot[key] });
          }
        }
      }
      return updatedSong;
    },
    set: (song) => {
      const previousSong = currentSong.value;
      currentSongFallback.value = song
        ? { ...(previousSong?.path === song.path ? previousSong : {}), ...song }
        : null;
      currentSongPath.value = song?.path ?? null;
      pruneFallbackSongs();
    },
  });

  const getKnownSongByPath = (path: string) =>
    libraryStore.getSongByPath(path)
    ?? queueFallbackSongs.get(path)
    ?? tempQueueFallbackSongs.get(path)
    ?? (currentSongFallback.value?.path === path ? currentSongFallback.value : null);

  const getRetainedFallbackSongPaths = () =>
    Array.from(new Set([...queueFallbackSongs.keys(), ...tempQueueFallbackSongs.keys()]));

  const remapQueueSongPaths = (resolvePath: (path: string) => string) => {
    for (const fallbackMap of [queueFallbackSongs, tempQueueFallbackSongs]) {
      for (const [path, song] of Array.from(fallbackMap)) {
        const nextPath = resolvePath(path);
        if (nextPath === path) continue;
        fallbackMap.delete(path);
        song.path = nextPath;
        fallbackMap.set(nextPath, song);
      }
    }
    const queuePaths = playQueuePaths.value.map(resolvePath);
    const temporaryPaths = tempQueuePaths.value.map(resolvePath);
    if (!areSamePaths(playQueuePaths.value, queuePaths)) playQueuePaths.value = queuePaths;
    if (!areSamePaths(tempQueuePaths.value, temporaryPaths)) tempQueuePaths.value = temporaryPaths;
  };

  const refreshRetainedFallbackSongs = (songs: LibrarySong[]) => {
    const normalizePath = (path: string) => path.replace(/\\/g, '/').toLowerCase();
    const refreshedByPath = new Map(songs.map(song => [normalizePath(song.path), song]));
    for (const fallbackMap of [queueFallbackSongs, tempQueueFallbackSongs]) {
      for (const [path, fallback] of fallbackMap) {
        const song = refreshedByPath.get(normalizePath(path));
        if (!song) continue;
        // LibrarySong does not contain runtime/CUE fields, so updating the
        // existing fallback keeps those fields and any external object references.
        Object.assign(fallback, song);
        if (path !== song.path) {
          fallbackMap.delete(path);
          fallbackMap.set(song.path, fallback);
        }
      }
    }
  };

  const resetPlaybackState = () => {
    isPlaying.value = false;
    currentTime.value = 0;
    clockRevision.value += 1;
    seekRevision.value += 1;
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
    clockRevision,
    seekRevision,
    playMode,
    isSongLoaded,
    currentPlaybackId,
    playQueue,
    playQueuePaths,
    tempQueue,
    tempQueuePaths,
    currentSong,
    currentSongPath,
    getKnownSongByPath,
    getRetainedFallbackSongPaths,
    remapQueueSongPaths,
    refreshRetainedFallbackSongs,
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
