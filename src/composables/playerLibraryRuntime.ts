import { invoke } from '@tauri-apps/api/core';
import {
  beginLibraryScanProgress,
  resolveScanLibraryOptions,
  startLibraryScanSession,
} from './playerLibraryScan';
import type { ScanLibraryOptions } from './playerLibraryScan';
import type {
  AlbumCatalogItem,
  ArtistCatalogItem,
  LibraryScanVisibility,
  LibrarySong,
  Song,
} from '../types';
import { useLibraryAllSongPathCache } from './useLibraryAllSongPathCache';
import { useLibraryCollectionSongPathCache } from './useLibraryCollectionSongPathCache';
import { useLibraryDetailSongPathCache } from './useLibraryDetailSongPathCache';
import { useLibraryFolderSongPathCache } from './useLibraryFolderSongPathCache';
import { useSettingsStore } from '../features/settings/store';
import { useLibraryStore } from '../features/library/store';

let hasBootstrappedLibrary = false;
let libraryBootstrapPromise: Promise<void> | null = null;
let libraryRefreshPromise: Promise<void> | null = null;
let queuedLibraryRefreshOptions: Required<ScanLibraryOptions> | null = null;
let queuedLibraryRefreshPromise: Promise<void> | null = null;
let libraryRefreshIdleId: number | null = null;
let libraryRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const LIBRARY_SCAN_VISIBILITY_PRIORITY: Record<LibraryScanVisibility, number> = {
  silent: 1,
  inline: 2,
  hero: 3,
};

interface CreatePlayerLibraryRuntimeDeps {
  fetchLibraryFolders: () => Promise<void>;
  fetchFolderTree: () => Promise<void>;
  flushBufferedLibraryScanBatch: () => void;
  refreshStateSongReferences: (fallbackSongs?: Song[]) => void;
  finalizeLibraryScanProgress: (
    songs: LibrarySong[],
    failed?: boolean,
    message?: string,
  ) => void;
  onSilentScanError: (message: string) => void;
}

export const createPlayerLibraryRuntime = ({
  fetchLibraryFolders,
  fetchFolderTree,
  flushBufferedLibraryScanBatch,
  refreshStateSongReferences,
  finalizeLibraryScanProgress,
  onSilentScanError,
}: CreatePlayerLibraryRuntimeDeps) => {
  const libraryStore = useLibraryStore();
  const settingsStore = useSettingsStore();
  const { clearLibraryAllSongPathCache } = useLibraryAllSongPathCache();
  const { clearLibraryCollectionSongPathCache } = useLibraryCollectionSongPathCache();
  const { clearLibraryDetailSongPathCache } = useLibraryDetailSongPathCache();
  const { clearLibraryFolderSongPathCache } = useLibraryFolderSongPathCache();

  const clearLibraryPathCaches = () => {
    clearLibraryAllSongPathCache();
    clearLibraryCollectionSongPathCache();
    clearLibraryDetailSongPathCache();
    clearLibraryFolderSongPathCache();
  };

  const mergeQueuedScanOptions = (
    current: Required<ScanLibraryOptions> | null,
    next: Required<ScanLibraryOptions>,
  ): Required<ScanLibraryOptions> => {
    if (!current) {
      return next;
    }

    return {
      trigger:
        next.trigger === 'bootstrap' && current.trigger !== 'bootstrap'
          ? current.trigger
          : next.trigger,
      visibility:
        LIBRARY_SCAN_VISIBILITY_PRIORITY[next.visibility] >= LIBRARY_SCAN_VISIBILITY_PRIORITY[current.visibility]
          ? next.visibility
          : current.visibility,
      sourcePath: next.sourcePath || current.sourcePath,
    };
  };

  const cancelScheduledLibraryRefresh = () => {
    if (libraryRefreshTimer) {
      clearTimeout(libraryRefreshTimer);
      libraryRefreshTimer = null;
    }
    if (libraryRefreshIdleId !== null && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(libraryRefreshIdleId);
      libraryRefreshIdleId = null;
    }
    queuedLibraryRefreshOptions = null;
  };

  const loadLibrarySongsFromCache = async () => {
    try {
      flushBufferedLibraryScanBatch();
      const songs = await invoke<LibrarySong[]>('get_library_songs_cached');

      // 使用增量 Patch 和极速路径覆盖，替代高开销的全量 normalize，加速启动
      libraryStore.patchLibrarySongs({ songs, deleted_paths: [] });
      const paths = songs.map(song => song.path);
      libraryStore.setCanonicalSongOrder(paths);

      clearLibraryPathCaches();
      refreshStateSongReferences(songs);
      await fetchFolderTree();
    } catch (error) {
      console.error('Failed to load cached library songs:', error);
    }
  };

  const loadLibraryCatalogsFromCache = async () => {
    try {
      const [artists, albums] = await Promise.all([
        invoke<ArtistCatalogItem[]>('get_library_artist_catalog'),
        invoke<AlbumCatalogItem[]>('get_library_album_catalog'),
      ]);

      libraryStore.setArtistCatalog(artists);
      libraryStore.setAlbumCatalog(albums);
    } catch (error) {
      console.error('Failed to load cached library catalogs:', error);
    }
  };

  const scanLibrary = async (options: ScanLibraryOptions = {}) => {
    const resolvedOptions = resolveScanLibraryOptions(options);

    if (libraryRefreshPromise) {
      startLibraryScanSession(resolvedOptions);
      queuedLibraryRefreshOptions = mergeQueuedScanOptions(queuedLibraryRefreshOptions, resolvedOptions);

      if (!queuedLibraryRefreshPromise) {
        queuedLibraryRefreshPromise = libraryRefreshPromise
          .then(async () => {
            while (queuedLibraryRefreshOptions) {
              const nextOptions = queuedLibraryRefreshOptions;
              queuedLibraryRefreshOptions = null;
              await scanLibrary(nextOptions);
            }
          })
          .finally(() => {
            queuedLibraryRefreshPromise = null;
          });
      }

      return queuedLibraryRefreshPromise;
    }

    cancelScheduledLibraryRefresh();

    if (libraryStore.libraryFolders.length === 0) {
      flushBufferedLibraryScanBatch();
      libraryStore.setLibrarySongs([]);
      libraryStore.setSourceSongs([]);
      libraryStore.setLibraryHierarchy([]);
      libraryStore.setArtistCatalog([]);
      libraryStore.setAlbumCatalog([]);
      clearLibraryPathCaches();
      refreshStateSongReferences([]);
      libraryStore.setLibraryScanSession(null);
      libraryStore.setLibraryScanProgress(null);
      libraryStore.setLastLibraryScanError(null);
      return Promise.resolve();
    }

    const session = startLibraryScanSession(resolvedOptions);
    beginLibraryScanProgress(session);
    libraryStore.setLastLibraryScanError(null);

    libraryRefreshPromise = (async () => {
      try {
        const songs = await invoke<LibrarySong[]>('scan_library', {
          minimumDurationSeconds: settingsStore.settings.libraryMinDurationSeconds,
        });

        // 1. 先进行最终的增量补全 patch，规避未 patch 到的空洞风险项
        libraryStore.patchLibrarySongs({ songs, deleted_paths: [] });

        // 2. 提取路径并使用独立的 setCanonicalSongOrder 极速重排覆盖，杜绝 setter 的全量 normalize
        const paths = songs.map(song => song.path);
        libraryStore.setCanonicalSongOrder(paths);

        clearLibraryPathCaches();
        refreshStateSongReferences(songs);
        await Promise.all([
          fetchLibraryFolders(),
          fetchFolderTree(),
          loadLibraryCatalogsFromCache(),
        ]);

        if (!libraryStore.libraryScanProgress?.done) {
          finalizeLibraryScanProgress(songs);
        }
      } catch (error) {
        console.error('Library scan failed:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        libraryStore.setLastLibraryScanError(errorMessage);
        finalizeLibraryScanProgress([], true, errorMessage || '扫描音乐库时出现问题');
        if (session.visibility === 'silent') {
          onSilentScanError(errorMessage);
        }
      } finally {
        libraryRefreshPromise = null;
      }
    })();

    return libraryRefreshPromise;
  };

  const scheduleLibraryRefresh = () => {
    if (libraryRefreshPromise || libraryRefreshIdleId !== null || libraryRefreshTimer) {
      return;
    }

    if (libraryStore.libraryFolders.length === 0) {
      return;
    }

    const scheduledSession = startLibraryScanSession({
      trigger: 'bootstrap',
      visibility: 'silent',
      sourcePath: '',
    });
    beginLibraryScanProgress(scheduledSession);

    const runRefresh = () => {
      libraryRefreshIdleId = null;
      libraryRefreshTimer = null;
      void scanLibrary({ trigger: 'bootstrap', visibility: 'silent' });
    };

    if ('requestIdleCallback' in window) {
      libraryRefreshIdleId = window.requestIdleCallback(runRefresh, { timeout: 400 });
      return;
    }

    libraryRefreshTimer = setTimeout(runRefresh, 220);
  };

  const bootstrapLibrary = async () => {
    if (hasBootstrappedLibrary) return;
    hasBootstrappedLibrary = true;

    if (!libraryBootstrapPromise) {
      libraryBootstrapPromise = (async () => {
        await Promise.all([
          loadLibrarySongsFromCache(),
          loadLibraryCatalogsFromCache(),
          fetchLibraryFolders(),
        ]);
        scheduleLibraryRefresh();
      })();
    }

    await libraryBootstrapPromise;
  };

  return {
    bootstrapLibrary,
    loadLibraryCatalogsFromCache,
    loadLibrarySongsFromCache,
    scanLibrary,
    dispose: cancelScheduledLibraryRefresh,
  };
};
