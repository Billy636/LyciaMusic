import { storeToRefs } from 'pinia';

import { useLyrics } from './lyrics';
import { useToast } from './toast';
import { createPlayerFileManager } from './playerFileManager';
import { createPlayerFolderImport } from './playerFolderImport';
import { createPlayerFolderTree } from './playerFolderTree';
import { createPlayerHistoryFavorites } from './playerHistoryFavorites';
import { createPlayerLibraryBatch } from './playerLibraryBatch';
import { createPlayerLibraryManager } from './playerLibraryManager';
import { createPlayerLibraryRuntime } from './playerLibraryRuntime';
import { createPlayerLifecycle } from './playerLifecycle';
import { createPlayerPersistence } from './playerPersistence';
import { createPlayerPlayback } from './playerPlayback';
import { createPlayerPlaylist } from './playerPlaylist';
import { createPlayerQueue } from './playerQueue';
import { createPlayerRestore } from './playerRestore';
import { createPlayerUiShell } from './playerUiShell';
import type { ScanLibraryOptions } from './playerLibraryScan';
import { useCoverCache } from './useCoverCache';
import { useCollectionsActions } from '../features/collections/useCollectionsActions';
import { useFileImport } from './useFileImport';
import { useLibrarySync } from '../features/library/useLibrarySync';
import { usePlaybackActions } from '../features/playback/usePlaybackActions';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';
import { useWindowActions } from './useWindowActions';
import { playerStorage } from '../services/storage/playerStorage';
import { historyApi } from '../services/tauri/historyApi';
import { playbackApi } from '../services/tauri/playbackApi';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { useNavigationStore } from '../shared/stores/navigation';
import { usePlaybackStore } from '../features/playback/store';
import { useUiStore } from '../shared/stores/ui';
import type { HistoryItem, LibrarySong, Song } from '../types';
import { useSongDetailCache } from './useSongDetailCache';
import {
  cleanupRemovedLibrarySongPaths,
  collectSongPathsInFolderScope,
  isPathInFolderScope,
} from './libraryRemovalCleanup';

interface PlaySongOptions {
  updateShuffleHistory?: boolean;
  clearShuffleFuture?: boolean;
  preserveQueue?: boolean;
  insertAfterCurrent?: boolean;
}

interface LibraryRefreshSummary {
  removedCount: number;
  removedPaths: string[];
}

const PLAYER_PLAYLIST_PATHS_KEY = 'player_playlist_paths';
const PLAYER_QUEUE_PATHS_KEY = 'player_queue_paths';
const PLAYER_LAST_SONG_PATH_KEY = 'player_last_song_path';
const LEGACY_PLAYER_PLAYLIST_KEY = 'player_playlist';
const LEGACY_PLAYER_QUEUE_KEY = 'player_queue';
const LEGACY_PLAYER_HISTORY_KEY = 'player_history';
const LEGACY_PLAYER_LAST_SONG_KEY = 'player_last_song';

const finalizeLibraryScanProgress = (songs: LibrarySong[], failed = false, message?: string) => {
  const libraryStore = useLibraryStore();
  const existing = libraryStore.libraryScanProgress;

  libraryStore.setLibraryScanProgress({
    phase: failed ? 'error' : 'complete',
    current: songs.length,
    total: songs.length,
    folder_path: existing?.folder_path ?? libraryStore.libraryScanSession?.sourcePath ?? '',
    folder_index: existing?.folder_index ?? 0,
    folder_total: existing?.folder_total ?? Math.max(1, libraryStore.libraryFolders.length),
    message: message ?? (failed ? 'Library scan failed' : `Scan completed, ${songs.length} songs indexed`),
    done: true,
    failed,
  });
};

const readStoredStringArray = (key: string): string[] | null => playerStorage.readStringArray(key);
const readStoredSongArray = (key: string): Song[] => playerStorage.readSongArray(key);
const readStoredSong = (key: string): Song | null => playerStorage.readSong(key);
const readStoredHistory = (key: string): HistoryItem[] => playerStorage.readHistory(key);

const dedupePaths = (paths: string[]) =>
  Array.from(new Set(paths.map(path => path.trim()).filter(Boolean)));

const dedupeSongs = (songs: Song[]) => {
  const seen = new Set<string>();

  return songs.filter(song => {
    if (seen.has(song.path)) {
      return false;
    }

    seen.add(song.path);
    return true;
  });
};

const createSongLookup = (fallbackSongs: Song[] = []) => {
  const libraryStore = useLibraryStore();
  const lookup = new Map<string, Song>();

  for (const song of fallbackSongs) {
    if (song?.path && !lookup.has(song.path)) {
      lookup.set(song.path, song);
    }
  }

  libraryStore.canonicalSongs.forEach((song) => {
    lookup.set(song.path, song);
  });

  return lookup;
};

const resolveSongsFromPaths = (paths: string[], fallbackSongs: Song[] = []) => {
  const libraryStore = useLibraryStore();
  return libraryStore.resolveSongsByPaths(paths, fallbackSongs);
};

const formatDuration = (seconds: number) => {
  if (!seconds) {
    return '00:00';
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatTimeAgo = (timestamp: number) => {
  const now = Date.now();
  const diff = now - timestamp;
  const oneHour = 60 * 60 * 1000;

  if (diff < oneHour) {
    return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  }

  if (diff < 24 * oneHour) {
    return `${Math.floor(diff / oneHour)}h ago`;
  }

  return `${Math.floor(diff / (24 * oneHour))}d ago`;
};

function createPlayerCore() {
  const { loadLyrics } = useLyrics();
  const { showToast } = useToast();
  const { clearCoverCaches } = useCoverCache();
  const { clearSongDetailCache } = useSongDetailCache();

  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const navigationStore = useNavigationStore();
  const playbackStore = usePlaybackStore();
  const uiStore = useUiStore();

  const collectionsRefs = storeToRefs(collectionsStore);
  const libraryRefs = storeToRefs(libraryStore);
  const navigationRefs = storeToRefs(navigationStore);
  const playbackRefs = storeToRefs(playbackStore);
  const uiRefs = storeToRefs(uiStore);

  const { playlistSortMode } = collectionsRefs;
  const {
    artistSortMode,
    albumSortMode,
    albumDetailSortMode,
    artistCustomOrder,
    albumCustomOrder,
    folderSortMode,
    folderCustomOrder,
    localSortMode,
    localCustomOrder,
  } = libraryRefs;
  const {
    currentSong,
    currentSongPath,
    playMode,
    isPlaying,
    isSongLoaded,
    currentCover,
    currentCoverFull,
    currentTime,
  } = playbackRefs;

  const libraryView = usePlayerLibraryView();
  const {
    artistList,
    albumList,
    filteredArtistList,
    filteredAlbumList,
    folderList,
    favoriteSongList,
    favArtistList,
    favAlbumList,
    recentAlbumList,
    recentPlaylistList,
    currentViewSongs,
    isLocalMusic,
    isFolderMode,
  } = libraryView;

  const {
    applyLibraryScanBatch,
    flushBufferedLibraryScanBatch,
    refreshStateSongReferences,
    dispose: disposeLibraryBatch,
  } = createPlayerLibraryBatch({
    createSongLookup,
  });

  let librarySync: ReturnType<typeof useLibrarySync>;
  let playerQueue: ReturnType<typeof createPlayerQueue>;
  let playerPlayback: ReturnType<typeof createPlayerPlayback>;
  let libraryRuntime: ReturnType<typeof createPlayerLibraryRuntime>;

  const addLibraryFolder = async (): Promise<void> => {
    await librarySync.addLibraryFolder();
  };
  const addLibraryFolderPath = async (path: string): Promise<void> => {
    await librarySync.addLibraryFolderPath(path);
  };
  const removeLibraryFolderPath = async (path: string): Promise<void> => {
    await librarySync.removeLibraryFolderPath(path);
  };
  const collectRemovedLibraryFolderSongPaths = (path: string) => {
    const candidates = [
      ...libraryStore.canonicalSongs,
      ...libraryStore.sourceSongs,
      ...playbackStore.playQueue,
      ...playbackStore.tempQueue,
      ...(playbackStore.currentSong ? [playbackStore.currentSong] : []),
    ];

    return collectSongPathsInFolderScope(candidates, path);
  };

  const removeLibraryFolderLinked = async (
    path: string,
    options: { showToast?: boolean } = {},
  ): Promise<void> => {
    const removedPaths = collectRemovedLibraryFolderSongPaths(path);
    const activeSongPath = currentSongPath.value ?? currentSong.value?.path ?? null;

    if (activeSongPath && isPathInFolderScope(path, activeSongPath)) {
      if (!removedPaths.some(songPath => songPath === activeSongPath)) {
        removedPaths.push(activeSongPath);
      }
      await stopPlaybackForMissingSong();
    }

    await librarySync.removeLibraryFolderLinked(path, options);
    await cleanupRemovedLibrarySongPaths({
      removedPaths,
      removedFolderPath: path,
      stopPlayback: stopPlaybackForMissingSong,
      removeFromHistory: songPaths => playerHistoryFavorites.removeFromHistory(songPaths),
      removeSongStatistics: songPaths => historyApi.removeSongsFromHistoryAndStatistics(songPaths),
      clearCaches: () => {
        clearCoverCaches();
        clearSongDetailCache();
      },
    });
  };
  const resetShuffleState = () => playerQueue.resetShuffleState();

  const playerPlaylist = createPlayerPlaylist();

  const playerHistoryFavorites = createPlayerHistoryFavorites({
    legacyPlayerHistoryKey: LEGACY_PLAYER_HISTORY_KEY,
  });

  const collectionsActions = useCollectionsActions({
    playerPlaylist,
    playerHistoryFavorites,
  });

  const playerFileManager = createPlayerFileManager({
    removeLibraryFolderLinked,
    removeFromHistory: (songPaths: string[]) => playerHistoryFavorites.removeFromHistory(songPaths),
    showToast,
  });

  const {
    fetchLibraryFolders,
    addLibraryFolderRecord,
    removeLibraryFolderRecord,
    linkLibraryFolder,
    unlinkLibraryFolder,
    processExternalPaths,
  } = createPlayerLibraryManager({
    fetchFolderTree,
    scanLibrary,
    playSong,
    dedupePaths,
    dedupeSongs,
    resetShuffleState,
  });

  const playerFolderTree = createPlayerFolderTree({
    addLibraryFolderPath,
    removeLibraryFolderPath,
    showToast,
  });

  const playerFolderImport = createPlayerFolderImport({
    showToast,
  });

  const playerUiShell = createPlayerUiShell({
    addFolder: () => addLibraryFolder(),
    removeFromHistory: (songPaths: string[]) => playerHistoryFavorites.removeFromHistory(songPaths),
  });

  const playbackActions = usePlaybackActions({
    currentSong,
    playMode,
    getPlayerPlayback: () => playerPlayback,
    getPlayerQueue: () => playerQueue,
    playerUiShell,
  });

  libraryRuntime = createPlayerLibraryRuntime({
    fetchLibraryFolders,
    fetchFolderTree,
    flushBufferedLibraryScanBatch,
    refreshStateSongReferences,
    finalizeLibraryScanProgress,
    onSilentScanError: () => {
      showToast('Background library scan failed. Please retry in library settings.', 'error');
    },
  });

  const {
    restoreRecentHistory,
    restorePathBackedState,
  } = createPlayerRestore({
    keys: {
      playerPlaylistPaths: PLAYER_PLAYLIST_PATHS_KEY,
      playerQueuePaths: PLAYER_QUEUE_PATHS_KEY,
      playerLastSongPath: PLAYER_LAST_SONG_PATH_KEY,
      legacyPlayerPlaylist: LEGACY_PLAYER_PLAYLIST_KEY,
      legacyPlayerQueue: LEGACY_PLAYER_QUEUE_KEY,
      legacyPlayerHistory: LEGACY_PLAYER_HISTORY_KEY,
      legacyPlayerLastSong: LEGACY_PLAYER_LAST_SONG_KEY,
    },
    createSongLookup,
    resolveSongsFromPaths,
    readStoredHistory,
    readStoredSongArray,
    readStoredSong,
    readStoredStringArray,
    loadLibrarySongsFromCache: () => libraryRuntime.loadLibrarySongsFromCache(),
  });

  const {
    flushPersistedState,
    schedulePersistedState,
    dispose: disposePlayerPersistence,
  } = createPlayerPersistence({
    keys: {
      playerPlaylistPaths: PLAYER_PLAYLIST_PATHS_KEY,
      playerQueuePaths: PLAYER_QUEUE_PATHS_KEY,
      legacyPlayerPlaylist: LEGACY_PLAYER_PLAYLIST_KEY,
      legacyPlayerQueue: LEGACY_PLAYER_QUEUE_KEY,
    },
  });

  const playerLifecycle = createPlayerLifecycle({
    bootstrapLibrary: () => libraryRuntime.bootstrapLibrary(),
    togglePlay,
    nextSong,
    prevSong,
    applyLibraryScanBatch,
    flushBufferedLibraryScanBatch,
    handleSeekCompleted: payload => playerPlayback.handleSeekCompleted(payload),
    schedulePersistedState,
    flushPersistedState,
    restorePathBackedState,
    restoreRecentHistory,
    refreshStateSongReferences,
    loadLyrics,
    disposePlayerPlayback: () => playerPlayback.dispose(),
    disposeLibraryRuntime: () => libraryRuntime.dispose(),
    disposePlayerPersistence,
    disposeLibraryBatch,
    lastSongPathKey: PLAYER_LAST_SONG_PATH_KEY,
    legacyLastSongKey: LEGACY_PLAYER_LAST_SONG_KEY,
  });

  playerQueue = createPlayerQueue({
    playSong: (song, options) => playerPlayback.playSong(song, options),
    stopPlaybackRuntime: () => playerPlayback.stopPlaybackRuntime(),
    showToast,
  });

  playerPlayback = createPlayerPlayback({
    getDisplaySongList: () => currentViewSongs.value,
    addToHistory,
    loadLyrics,
    handleAutoNext: playbackActions.handleAutoNext,
    onBeforePlay: (song, options) => {
      playerQueue.handleBeforePlay(song, options);
    },
  });

  librarySync = useLibrarySync({
    fetchLibraryFolders,
    scanLibrary,
    refreshFolder,
    refreshAllFolders,
    linkLibraryFolder,
    unlinkLibraryFolder,
    processExternalPaths,
    addLibraryFolderRecord,
    removeLibraryFolderRecord,
  });

  const fileImportActions = useFileImport({
    addFolder,
    addFoldersFromStructure,
    getSongsInFolder,
    clearLocalMusic,
  });

  const windowActions = useWindowActions({
    playerUiShell,
  });

  async function deleteFolder(path: string) {
    return playerFileManager.deleteFolder(path);
  }

  async function moveFilePhysical(sourcePath: string, targetFolderPath: string) {
    return playerFileManager.moveFilePhysical(sourcePath, targetFolderPath);
  }

  async function scanLibrary(options: ScanLibraryOptions = {}) {
    return libraryRuntime.scanLibrary(options);
  }

  async function fetchFolderTree() {
    return playerFolderTree.fetchFolderTree();
  }

  async function ensureFolderChildrenLoaded(targetPath: string) {
    return playerFolderTree.ensureFolderChildrenLoaded(targetPath);
  }

  async function createFolder(parentPath: string, folderName: string) {
    return playerFolderTree.createFolder(parentPath, folderName);
  }

  async function toggleFolderNode(targetPath: string) {
    return playerFolderTree.toggleFolderNode(targetPath);
  }

  async function addFoldersFromStructure() {
    return playerFolderImport.addFoldersFromStructure();
  }

  function getSongsInFolder(folderPath: string) {
    return playerFolderImport.getSongsInFolder(folderPath);
  }

  async function moveFilesToFolder(paths: string[], targetFolder: string) {
    return playerFileManager.moveFilesToFolder(paths, targetFolder);
  }

  async function refreshFolder(folderPath: string) {
    return playerFileManager.refreshFolder(folderPath);
  }

  function removeFolder(folderPath: string) {
    playerFileManager.removeFolder(folderPath);
  }

  async function addToHistory(song: Song) {
    return playerHistoryFavorites.addToHistory(song);
  }

  function clearLocalMusic() {
    playerFolderImport.clearLocalMusic();
  }

  async function addFolder() {
    return playerFolderImport.addFolder();
  }

  function generateOrganizedPath(song: Song): string {
    return playerFileManager.generateOrganizedPath(song);
  }

  async function moveFile(song: Song, newPath: string) {
    return playerFileManager.moveFile(song, newPath);
  }

  async function openInFinder(path: string) {
    return playerFileManager.openInFinder(path);
  }

  async function deleteFromDisk(song: Song) {
    return playerFileManager.deleteFromDisk(song);
  }

  const syncRemovedSongPreferences = (removedPaths: string[]) => {
    if (removedPaths.length === 0) {
      return;
    }

    const removedSet = new Set(removedPaths);
    collectionsStore.favoritePaths = collectionsStore.favoritePaths.filter(path => !removedSet.has(path));
    collectionsStore.playlists.forEach((playlist) => {
      playlist.songPaths = playlist.songPaths.filter(path => !removedSet.has(path));
    });
    localCustomOrder.value = localCustomOrder.value.filter(path => !removedSet.has(path));

    folderCustomOrder.value = Object.fromEntries(
      Object.entries(folderCustomOrder.value).map(([folderPath, paths]) => [
        folderPath,
        paths.filter(path => !removedSet.has(path)),
      ]),
    );
  };

  const stopPlaybackForMissingSong = async () => {
    await playbackApi.stopAudio().catch(async () => {
      await playbackApi.pauseAudio().catch(() => {});
    });
    playerPlayback.stopPlaybackRuntime();
    isPlaying.value = false;
    isSongLoaded.value = false;
    currentSong.value = null;
    currentSongPath.value = null;
    currentTime.value = 0;
    currentCover.value = '';
    currentCoverFull.value = '';
  };

  const refreshLibraryAndCollectSummary = async (
    options: ScanLibraryOptions = { trigger: 'manual-rescan', visibility: 'inline' },
  ): Promise<LibraryRefreshSummary> => {
    const previousPaths = [...libraryStore.canonicalSongPaths];
    const previousPathSet = new Set(previousPaths);
    const activeSongPath = currentSongPath.value;

    await libraryRuntime.scanLibrary(options);

    const currentPathSet = new Set(libraryStore.canonicalSongPaths);
    const removedPaths = previousPaths.filter(path => !currentPathSet.has(path));

    if (removedPaths.length > 0) {
      syncRemovedSongPreferences(removedPaths);
      await playerHistoryFavorites.removeFromHistory(removedPaths);
      refreshStateSongReferences();
    }

    if (activeSongPath && previousPathSet.has(activeSongPath) && !currentPathSet.has(activeSongPath)) {
      await stopPlaybackForMissingSong();
      showToast('当前歌曲已不存在', 'info');
    }

    return {
      removedCount: removedPaths.length,
      removedPaths,
    };
  };

  async function playSong(song: Song, options: PlaySongOptions = {}) {
    return playerPlayback.playSong(song, options);
  }

  async function togglePlay() {
    return playerPlayback.togglePlay();
  }

  function nextSong() {
    playerQueue.nextSong();
  }

  function prevSong() {
    playerQueue.prevSong();
  }

  function init() {
    playerLifecycle.init();
  }

  async function refreshAllFolders() {
    return refreshLibraryAndCollectSummary({
      trigger: 'manual-rescan',
      visibility: 'inline',
    });
  }

  const state = {
    ...collectionsRefs,
    ...libraryRefs,
    ...navigationRefs,
    ...playbackRefs,
    ...uiRefs,
  };

  const views = {
    artistList,
    albumList,
    filteredArtistList,
    filteredAlbumList,
    folderList,
    favoriteSongList,
    favArtistList,
    favAlbumList,
    recentAlbumList,
    recentPlaylistList,
    currentViewSongs,
    displaySongList: currentViewSongs,
    isLocalMusic,
    isFolderMode,
  };

  const playbackDomain = {
    playSong,
    pauseSong: playbackActions.pauseSong,
    togglePlay,
    nextSong,
    prevSong,
    seekTo: playbackActions.seekTo,
    stepSeek: playbackActions.stepSeek,
    playAt: playbackActions.playAt,
    handleSeek: playbackActions.handleSeek,
    handleVolume: playbackActions.handleVolume,
    handleVolumeWheel: playbackActions.handleVolumeWheel,
    toggleMute: playbackActions.toggleMute,
    toggleMode: playbackActions.toggleMode,
    togglePlaylist: playbackActions.togglePlaylist,
    toggleMiniPlaylist: playbackActions.toggleMiniPlaylist,
    closeMiniPlaylist: playbackActions.closeMiniPlaylist,
    clearQueue: playbackActions.clearQueue,
    addSongToQueue: playbackActions.addSongToQueue,
    addSongsToQueue: playbackActions.addSongsToQueue,
    addAlbumToQueueTail: playbackActions.addAlbumToQueueTail,
    removeSongFromQueue: playbackActions.removeSongFromQueue,
    playNext: playbackActions.playNext,
    handleScan: playbackActions.handleScan,
    removeSongFromList: playbackActions.removeSongFromList,
    formatDuration,
  };

  const libraryDomain = {
    ...librarySync,
    ...fileImportActions,
    removeFolder,
    moveFile,
    generateOrganizedPath,
    openInFinder,
    deleteFromDisk,
    moveFilesToFolder,
    deleteFolder,
    moveFilePhysical,
    fetchFolderTree,
    ensureFolderChildrenLoaded,
    createFolder,
    toggleFolderNode,
    expandFolderPath: (targetPath: string) => playerFolderTree.expandFolderPath(targetPath),
    loadLibrarySongsFromCache: () => libraryRuntime.loadLibrarySongsFromCache(),
  };

  const sortingDomain = {
    reorderWatchedFolders: (from: number, to: number) => libraryStore.reorderWatchedFolders(from, to),
    reorderPlaylists: (from: number, to: number) => collectionsStore.reorderPlaylists(from, to),
    updateArtistOrder: (newOrder: string[]) => {
      artistCustomOrder.value = newOrder;
      if (artistSortMode.value !== 'custom') {
        artistSortMode.value = 'custom';
      }
    },
    updateAlbumOrder: (newOrder: string[]) => {
      albumCustomOrder.value = newOrder;
      if (albumSortMode.value !== 'custom') {
        albumSortMode.value = 'custom';
      }
    },
    updateFolderOrder: (folderPath: string, newOrder: string[]) => {
      folderCustomOrder.value = {
        ...folderCustomOrder.value,
        [folderPath]: newOrder,
      };
      if (folderSortMode.value !== 'custom') {
        folderSortMode.value = 'custom';
      }
    },
    updateLocalOrder: (newOrder: string[]) => {
      localCustomOrder.value = newOrder;
      if (localSortMode.value !== 'custom') {
        localSortMode.value = 'custom';
      }
    },
    setFolderSortMode: (mode: 'title' | 'name' | 'artist' | 'added_at' | 'custom') => {
      folderSortMode.value = mode;
    },
    setLocalSortMode: (mode: 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc' | 'custom') => {
      localSortMode.value = mode;
    },
    setAlbumDetailSortMode: (mode: 'track_number' | 'track_number_desc' | 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc') => {
      albumDetailSortMode.value = mode;
    },
    setPlaylistSortMode: (mode: 'title' | 'name' | 'artist' | 'added_at' | 'custom') => {
      playlistSortMode.value = mode;
    },
  };

  const lifecycle = {
    init,
    formatTimeAgo,
  };

  const appShellDomain = {
    init,
    playQueue: playbackRefs.playQueue,
    isMiniMode: uiRefs.isMiniMode,
    showPlayerDetail: uiRefs.showPlayerDetail,
    showMiniPlaylist: uiRefs.showMiniPlaylist,
    showPlaylist: uiRefs.showPlaylist,
    closeMiniPlaylist: playbackDomain.closeMiniPlaylist,
    showVolumePopover: uiRefs.showVolumePopover,
    handleExternalPaths: libraryDomain.handleExternalPaths,
    libraryScanProgress: libraryRefs.libraryScanProgress,
  };

  const legacyApi = {
    ...state,
    ...views,
    ...lifecycle,
    ...libraryDomain,
    ...collectionsActions,
    ...playbackDomain,
    ...windowActions,
    ...sortingDomain,
  };

  return {
    state,
    views,
    lifecycle,
    appShellDomain,
    libraryDomain,
    collectionsDomain: collectionsActions,
    playbackDomain,
    windowDomain: windowActions,
    sortingDomain,
    legacyApi,
  };
}

let playerCore: ReturnType<typeof createPlayerCore> | null = null;

export function usePlayerCore() {
  if (!playerCore) {
    playerCore = createPlayerCore();
  }

  return playerCore;
}
