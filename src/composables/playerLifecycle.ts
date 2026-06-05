import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { onMounted, onScopeDispose, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { clearPaletteCache, extractDominantColors } from './colorExtraction';
import type { LibraryScanProgress, Song } from '../types';
import {
  playerStorage,
  playerStorageKeys,
  type AlbumSortMode,
  type AlbumDetailSortMode,
  type ArtistSortMode,
  type FolderSortMode,
  type LocalSortMode,
  type PlaylistSortMode,
} from '../services/storage/playerStorage';
import { playbackApi, createEqualizerSignature } from '../services/tauri/playbackApi';
import { remoteLibraryApi } from '../services/tauri/remoteLibraryApi';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';
import { defaultDominantColors, useUiStore } from '../shared/stores/ui';
import { isRemoteSong } from '../utils/remoteSong';

interface SeekCompletedPayload {
  request_id: number;
  time: number;
}

type RemoteLyricsCacheReadyPayload = string | {
  uri: string;
  song?: Song | null;
};

interface LibraryScanBatchPayload {
  songs: Song[];
  deleted_paths: string[];
  folder_path: string;
  folder_index: number;
  folder_total: number;
}

interface LibraryScanProgressPayload extends LibraryScanProgress {}

interface CreatePlayerLifecycleDeps {
  bootstrapLibrary: () => Promise<void>;
  togglePlay: () => void | Promise<void>;
  nextSong: () => void;
  prevSong: () => void;
  applyLibraryScanBatch: (payload: LibraryScanBatchPayload) => void;
  flushBufferedLibraryScanBatch: () => void;
  handleSeekCompleted: (payload: SeekCompletedPayload) => void;
  schedulePersistedState: () => void;
  flushPersistedState: () => void;
  restorePathBackedState: () => Promise<void>;
  restoreRecentHistory: () => Promise<void>;
  refreshStateSongReferences: () => void;
  loadLyrics: () => void | Promise<void>;
  disposePlayerPlayback: () => void;
  disposeLibraryRuntime: () => void;
  disposePlayerPersistence: () => void;
  disposeLibraryBatch: () => void;
  lastSongPathKey: string;
  legacyLastSongKey: string;
}

let lifecycleInitDone = false;
let dominantColorTaskId = 0;
let dominantColorSignature = '';

interface SortSettingsRefs {
  artistSortMode: Ref<ArtistSortMode>;
  albumSortMode: Ref<AlbumSortMode>;
  albumDetailSortMode: Ref<AlbumDetailSortMode>;
  artistCustomOrder: Ref<string[]>;
  albumCustomOrder: Ref<string[]>;
  folderSortMode: Ref<FolderSortMode>;
  folderCustomOrder: Ref<Record<string, string[]>>;
  localSortMode: Ref<LocalSortMode>;
  localCustomOrder: Ref<string[]>;
  playlistSortMode: Ref<PlaylistSortMode>;
}

const restoreOutputDevice = async () => {
  const storedOutputDevice = playerStorage.getString(playerStorageKeys.outputDevice);
  const storedOutputMode = playerStorage.getString(playerStorageKeys.outputDeviceMode);

  if ((storedOutputMode === 'manual' || (!storedOutputMode && storedOutputDevice)) && storedOutputDevice) {
    await playbackApi.setOutputDevice(storedOutputDevice).catch(error => {
      console.warn('Failed to restore output device:', error);
    });
    return;
  }

  await playbackApi.setOutputDevice(null).catch(error => {
    console.warn('Failed to restore default output device mode:', error);
  });
};

const restoreSortSettings = ({
  artistSortMode,
  albumSortMode,
  albumDetailSortMode,
  artistCustomOrder,
  albumCustomOrder,
  folderSortMode,
  folderCustomOrder,
  localSortMode,
  localCustomOrder,
  playlistSortMode,
}: SortSettingsRefs) => {
  const storedArtistSort = playerStorage.getString(playerStorageKeys.artistSortMode);
  if (storedArtistSort) {
    artistSortMode.value = storedArtistSort as ArtistSortMode;
  }

  const storedAlbumSort = playerStorage.getString(playerStorageKeys.albumSortMode);
  if (storedAlbumSort && ['count', 'name', 'artist', 'custom'].includes(storedAlbumSort)) {
    albumSortMode.value = storedAlbumSort as AlbumSortMode;
  }

  const storedAlbumDetailSort = playerStorage.getString(playerStorageKeys.albumDetailSortMode);
  if (storedAlbumDetailSort && ['track_number', 'track_number_desc', 'title', 'artist', 'added_at', 'added_at_asc', 'file_modified_at', 'file_modified_at_asc'].includes(storedAlbumDetailSort)) {
    albumDetailSortMode.value = storedAlbumDetailSort as AlbumDetailSortMode;
  }

  const storedArtistOrder = playerStorage.readStringArray(playerStorageKeys.artistCustomOrder);
  if (storedArtistOrder) {
    artistCustomOrder.value = storedArtistOrder;
  }

  const storedAlbumOrder = playerStorage.readStringArray(playerStorageKeys.albumCustomOrder);
  if (storedAlbumOrder) {
    albumCustomOrder.value = storedAlbumOrder;
  }

  const storedFolderSort = playerStorage.getString(playerStorageKeys.folderSortMode);
  if (storedFolderSort && ['title', 'name', 'artist', 'added_at', 'custom'].includes(storedFolderSort)) {
    folderSortMode.value = storedFolderSort as FolderSortMode;
  }

  const storedLocalSort = playerStorage.getString(playerStorageKeys.localSortMode);
  if (storedLocalSort && ['title', 'artist', 'added_at', 'added_at_asc', 'file_modified_at', 'file_modified_at_asc', 'custom'].includes(storedLocalSort)) {
    localSortMode.value = storedLocalSort as LocalSortMode;
  } else if (storedLocalSort === 'name') {
    localSortMode.value = 'title';
  } else if (storedLocalSort === 'default') {
    localSortMode.value = 'title';
  }

  const storedPlaylistSort = playerStorage.getString(playerStorageKeys.playlistSortMode);
  if (storedPlaylistSort && ['title', 'name', 'artist', 'added_at', 'custom'].includes(storedPlaylistSort)) {
    playlistSortMode.value = storedPlaylistSort as PlaylistSortMode;
  }

  const storedFolderOrder = playerStorage.readObject<Record<string, string[]>>(playerStorageKeys.folderCustomOrder);
  if (storedFolderOrder) {
    folderCustomOrder.value = storedFolderOrder;
  }

  const storedLocalOrder = playerStorage.readStringArray(playerStorageKeys.localCustomOrder);
  if (storedLocalOrder) {
    localCustomOrder.value = storedLocalOrder;
  }
};

export const createPlayerLifecycle = ({
  bootstrapLibrary,
  togglePlay,
  nextSong,
  prevSong,
  applyLibraryScanBatch,
  flushBufferedLibraryScanBatch,
  handleSeekCompleted,
  schedulePersistedState,
  flushPersistedState,
  restorePathBackedState,
  restoreRecentHistory,
  refreshStateSongReferences,
  loadLyrics,
  disposePlayerPlayback,
  disposeLibraryRuntime,
  disposePlayerPersistence,
  disposeLibraryBatch,
  lastSongPathKey,
  legacyLastSongKey,
}: CreatePlayerLifecycleDeps) => {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const settingsStore = useSettingsStore();
  const uiStore = useUiStore();
  const { settings } = storeToRefs(settingsStore);
  const {
    sourceSongPaths,
    watchedFolders,
    artistSortMode,
    albumSortMode,
    albumDetailSortMode,
    artistCustomOrder,
    albumCustomOrder,
    folderSortMode,
    folderCustomOrder,
    localSortMode,
    localCustomOrder,
  } = storeToRefs(libraryStore);
  const { favoritePaths, playlists, playlistSortMode } = storeToRefs(collectionsStore);
  const {
    currentCover,
    currentSong,
    currentSongPath,
    currentTime,
    isPlaying,
    playMode,
    playQueue,
    playQueuePaths,
    volume,
  } = storeToRefs(playbackStore);
  const { dominantColors } = storeToRefs(uiStore);
  const scheduleStatePersistence = () => {
    schedulePersistedState();
  };
  const syncLoudnessSettings = async () => {
    const volumeBalance = settings.value.audio.volumeBalance;
    const song = currentSong.value;
    await playbackApi.updateLoudnessSettings({
      enabled: volumeBalance.enabled,
      songId: song?.id ?? null,
      songPath: song ? (song.cue_source_path || song.path) : null,
      gainOffsetDb: volumeBalance.gainOffsetDb,
      preventClipping: volumeBalance.preventClipping,
    }).catch(err => {
      console.warn('Failed to update loudness settings:', err);
    });
  };

  const syncEqualizerSettings = async () => {
    const eq = settings.value.audio.equalizer;
    
    // 生成当前即将写入的规范化高精度参数签名
    const currentParamsSignature = createEqualizerSignature(eq.enabled, eq.preamp, eq.gains);
    
    // 从底层查询最后一次成功同步过的签名缓存
    const lastSynced = playbackApi.getLastSyncedParams();
    
    if (currentParamsSignature === lastSynced) {
      if (import.meta.env.DEV) {
        console.log(`[playerLifecycle] EQ params already synced (${currentParamsSignature}), skipping duplicate IPC.`);
      }
      return;
    }
    
    if (import.meta.env.DEV) {
      console.log(`[playerLifecycle] EQ params changed from store. Triggering IPC. Signature: ${currentParamsSignature}`);
    }

    await playbackApi.setEqualizerSettings(
      eq.enabled,
      eq.preamp,
      eq.gains
    ).catch(err => {
      console.warn('Failed to update equalizer settings:', err);
    });
  };

  onMounted(async () => {
    await bootstrapLibrary();
  });

  const init = () => {
    if (lifecycleInitDone) {
      return;
    }
    lifecycleInitDone = true;

    const listenerRegistrations = [
      listen('player:play', () => {
        if (!isPlaying.value) {
          void togglePlay();
        }
      }),
      listen('player:pause', () => {
        if (isPlaying.value) {
          void togglePlay();
        }
      }),
      listen('player:next', () => {
        nextSong();
      }),
      listen('player:prev', () => {
        prevSong();
      }),
      listen<LibraryScanBatchPayload>('library-scan-batch', event => {
        applyLibraryScanBatch(event.payload);
      }),
      listen<LibraryScanProgressPayload>('library-scan-progress', event => {
        libraryStore.setLibraryScanProgress({
          ...event.payload,
          message: event.payload.message ?? null,
        });

        if (event.payload.failed) {
          libraryStore.setLastLibraryScanError(event.payload.message ?? 'Library scan failed');
        }

        if (event.payload.done) {
          flushBufferedLibraryScanBatch();
        }
      }),
      listen<SeekCompletedPayload>('seek_completed', event => {
        handleSeekCompleted(event.payload);
      }),
      listen<RemoteLyricsCacheReadyPayload>('remote-lyrics-cache-ready', event => {
        const payload = event.payload;
        const uri = typeof payload === 'string' ? payload : payload.uri;
        const song = typeof payload === 'string' ? null : payload.song;
        if (song?.path) {
          libraryStore.setSongRecord(song);
        }
        if (currentSong.value?.path === uri) {
          void loadLyrics();
        }
      }),
    ];

    watch(volume, value => {
      playerStorage.writeNumber(playerStorageKeys.volume, value);
    });

    watch(playMode, value => {
      playerStorage.writeNumber(playerStorageKeys.playMode, value);
    });

    watch(sourceSongPaths, scheduleStatePersistence);
    watch(playQueuePaths, scheduleStatePersistence);
    watch(watchedFolders, scheduleStatePersistence);
    watch(favoritePaths, scheduleStatePersistence, { deep: true });
    watch(playlists, scheduleStatePersistence, { deep: true });
    watch(settings, scheduleStatePersistence, { deep: true });
    watch(
      () => settings.value.audio.volumeBalance,
      () => {
        void syncLoudnessSettings();
      },
      { deep: true }
    );
    watch(
      () => settings.value.audio.equalizer,
      () => {
        void syncEqualizerSettings();
      },
      { deep: true }
    );
    watch(artistCustomOrder, scheduleStatePersistence, { deep: true });
    watch(albumCustomOrder, scheduleStatePersistence, { deep: true });
    watch(folderCustomOrder, scheduleStatePersistence, { deep: true });
    watch(localCustomOrder, scheduleStatePersistence, { deep: true });

    watch(artistSortMode, value => {
      playerStorage.setString(playerStorageKeys.artistSortMode, value);
    });
    watch(albumSortMode, value => {
      playerStorage.setString(playerStorageKeys.albumSortMode, value);
    });
    watch(albumDetailSortMode, value => {
      playerStorage.setString(playerStorageKeys.albumDetailSortMode, value);
    });
    watch(folderSortMode, value => {
      playerStorage.setString(playerStorageKeys.folderSortMode, value);
    });
    watch(localSortMode, value => {
      playerStorage.setString(playerStorageKeys.localSortMode, value);
    });
    watch(playlistSortMode, value => {
      playerStorage.setString(playerStorageKeys.playlistSortMode, value);
    });

    watch(currentSongPath, path => {
      if (path) {
        playerStorage.setString(lastSongPathKey, path);
        playerStorage.remove(legacyLastSongKey);
        return;
      }

      playerStorage.remove(lastSongPathKey);
      playerStorage.remove(legacyLastSongKey);
    });

    const resolveCoverUrl = (cover: string) => {
      if (!cover) {
        return '';
      }

      return cover.startsWith('http') || cover.startsWith('data:')
        ? cover
        : convertFileSrc(cover);
    };

    const updateDominantColors = async (cover: string) => {
      const needsCoverPalette = settings.value.theme.dynamicBgType === 'flow'
        || settings.value.desktopLyrics.colorScheme === 'auto';

      if (!needsCoverPalette || !cover) {
        dominantColorTaskId += 1;
        dominantColorSignature = '';
        dominantColors.value = [...defaultDominantColors];
        return;
      }

      const coverUrl = resolveCoverUrl(cover);
      const signature = JSON.stringify({
        coverUrl,
        colorBoost: settings.value.theme.flowColorBoost,
        depth: settings.value.theme.flowDepth,
      });

      if (signature === dominantColorSignature) {
        return;
      }

      const taskId = ++dominantColorTaskId;
      const colors = await extractDominantColors(coverUrl, 4, {
        colorBoost: settings.value.theme.flowColorBoost,
        depth: settings.value.theme.flowDepth,
      });
      if (taskId !== dominantColorTaskId) return;
      dominantColorSignature = signature;
      dominantColors.value = colors;
    };

    watch(currentCover, (nextCover) => {
      void updateDominantColors(nextCover);
    }, { immediate: true });

    let lastPrecachedRemotePath = '';
    watch([currentSong, currentTime, playQueue], ([song, time, queue]) => {
      if (!isPlaying.value || !song || song.duration <= 0 || time / song.duration < 0.6) {
        return;
      }

      const index = queue.findIndex(item => item.path === song.path);
      const nextSong = index >= 0 ? queue[index + 1] : null;
      if (!nextSong || !isRemoteSong(nextSong) || nextSong.path === lastPrecachedRemotePath) {
        return;
      }

      lastPrecachedRemotePath = nextSong.path;
      remoteLibraryApi.precacheRemoteSong(nextSong.path).catch(error => {
        console.warn('Failed to precache remote song:', error);
      });
    });

    const remoteAutoSyncKey = 'lycia_remote_auto_sync_at';
    const remoteAutoSyncIntervalMs = 24 * 60 * 60 * 1000;
    let remoteAutoSyncTimer: ReturnType<typeof setInterval> | null = null;
    let remoteAutoSyncRunning = false;
    const runRemoteAutoSync = async () => {
      if (remoteAutoSyncRunning) return;
      remoteAutoSyncRunning = true;
      try {
        const sources = await remoteLibraryApi.getRemoteSources();
        for (const source of sources) {
          if (!source.enabled) continue;
          const key = `${remoteAutoSyncKey}:${source.id}`;
          const lastSyncAt = Number(localStorage.getItem(key) || '0');
          if (Date.now() - lastSyncAt < remoteAutoSyncIntervalMs) continue;
          await remoteLibraryApi.syncRemoteSource(source.id);
          localStorage.setItem(key, String(Date.now()));
        }
      } catch (error) {
        console.warn('Failed to auto sync remote library:', error);
      } finally {
        remoteAutoSyncRunning = false;
      }
    };

    // 流光/桌面歌词封面取色共用主色，参数微调时 debounce 延迟重提取，避免拖动滑块时频繁触发层切换闪烁
    let flowTweakTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPersistedPlaybackTime = Number.NaN;

    const persistCurrentPlaybackTime = () => {
      if (!currentSong.value) return;
      const nextTime = Math.max(0, currentTime.value);
      if (Math.abs(nextTime - lastPersistedPlaybackTime) < 0.5) return;
      lastPersistedPlaybackTime = nextTime;
      playerStorage.writeNumber(playerStorageKeys.lastTime, nextTime);
    };

    watch([
      () => settings.value.theme.flowColorBoost,
      () => settings.value.theme.flowDepth,
    ], () => {
      if (flowTweakTimer) clearTimeout(flowTweakTimer);
      flowTweakTimer = setTimeout(async () => {
        void updateDominantColors(currentCover.value);
      }, 500);
    });

    watch(
      () => settings.value.theme.dynamicBgType,
      (dynamicBgType) => {
        if (dynamicBgType !== 'flow') {
          clearPaletteCache();
          void updateDominantColors(currentCover.value);
          return;
        }

        void updateDominantColors(currentCover.value);
      },
    );

    watch(
      () => settings.value.desktopLyrics.colorScheme,
      () => {
        void updateDominantColors(currentCover.value);
      },
    );

    watch(isPlaying, playing => {
      if (!playing) {
        persistCurrentPlaybackTime();
      }
    });

    const playbackTimePersistTimer = setInterval(persistCurrentPlaybackTime, 2000);

    const beforeUnloadHandler = () => {
      flushPersistedState();
      persistCurrentPlaybackTime();
    };

    onMounted(async () => {
      const storedVolume = playerStorage.readNumber(playerStorageKeys.volume);
      if (storedVolume !== null) {
        volume.value = storedVolume;
        await playbackApi.setVolume(volume.value / 100);
      }

      const storedPlayMode = playerStorage.readNumber(playerStorageKeys.playMode);
      if (storedPlayMode !== null && [0, 1, 2].includes(storedPlayMode)) {
        playMode.value = storedPlayMode;
      }

      await restoreOutputDevice();

      libraryStore.setWatchedFolders(
        playerStorage.readStringArray(playerStorageKeys.watchedFolders) ?? [],
      );

      collectionsStore.setFavoritePaths(
        playerStorage.readStringArray(playerStorageKeys.favorites) ?? [],
      );

      collectionsStore.setPlaylists(playerStorage.readPlaylists());

      restoreSortSettings({
        artistSortMode,
        albumSortMode,
        albumDetailSortMode,
        artistCustomOrder,
        albumCustomOrder,
        folderSortMode,
        folderCustomOrder,
        localSortMode,
        localCustomOrder,
        playlistSortMode,
      });
      await playbackApi.setAudioOutputMode(settings.value.audio.outputMode).catch(error => {
        console.warn('Failed to restore audio output mode:', error);
      });
      const vb = settings.value.audio.volumeBalance;
      if (vb) {
        await syncLoudnessSettings();
      }
      await syncEqualizerSettings();

      await restorePathBackedState();
      await restoreRecentHistory();
      refreshStateSongReferences();

      const storedLastTime = playerStorage.readNumber(playerStorageKeys.lastTime);
      if (storedLastTime !== null) {
        currentTime.value = storedLastTime;
      }

      window.addEventListener('beforeunload', beforeUnloadHandler);
      window.setTimeout(() => void runRemoteAutoSync(), 30_000);
      remoteAutoSyncTimer = setInterval(() => void runRemoteAutoSync(), 60 * 60 * 1000);
    });

    onScopeDispose(() => {
      if (flowTweakTimer) {
        clearTimeout(flowTweakTimer);
      }
      if (remoteAutoSyncTimer) {
        clearInterval(remoteAutoSyncTimer);
      }
      persistCurrentPlaybackTime();
      clearInterval(playbackTimePersistTimer);
      dominantColorTaskId += 1;
      dominantColorSignature = '';
      void Promise.all(listenerRegistrations).then(unlisteners => {
        unlisteners.forEach(unlisten => unlisten());
      });
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      disposePlayerPlayback();
      disposeLibraryRuntime();
      disposePlayerPersistence();
      disposeLibraryBatch();
    });
  };

  return {
    init,
  };
};
