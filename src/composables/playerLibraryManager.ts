import { getLibraryAddScanOptions, resolveScanLibraryOptions } from './playerLibraryScan';
import type { ScanLibraryOptions } from './playerLibraryScan';
import type { Song } from '../types';
import { fileApi } from '../services/tauri/fileApi';
import { libraryApi } from '../services/tauri/libraryApi';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';

interface ProcessExternalPathsOptions {
  source?: 'drop' | 'open';
}

interface PlaySongOptions {
  preserveQueue?: boolean;
  insertAfterCurrent?: boolean;
}

interface CreatePlayerLibraryManagerDeps {
  fetchFolderTree: () => Promise<void>;
  scanLibrary: (options?: ScanLibraryOptions) => Promise<void>;
  playSong: (song: Song, options?: PlaySongOptions) => Promise<void>;
  dedupePaths: (paths: string[]) => string[];
  dedupeSongs: (songs: Song[]) => Song[];
  resetShuffleState: () => void;
}

export interface ProcessExternalPathsResult {
  source: 'drop' | 'open';
  importedFolderCount: number;
  skippedFolderCount: number;
  playableSongs: Song[];
  ignoredFileCount: number;
}

export const createPlayerLibraryManager = ({
  fetchFolderTree,
  scanLibrary,
  playSong,
  dedupePaths,
  dedupeSongs,
  resetShuffleState,
}: CreatePlayerLibraryManagerDeps) => {
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const settingsStore = useSettingsStore();
  const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const isWithinLibraryRoot = (path: string, root: string) => {
    const normalizedPath = normalizePath(path);
    const normalizedRoot = normalizePath(root);
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
  };

  const fetchLibraryFolders = async () => {
    try {
      const folders = await libraryApi.getLibraryFolders();
      libraryStore.setLibraryFolders(folders);
    } catch (error) {
      console.error('Failed to fetch library folders:', error);
    }
  };

  const addLibraryFolderRecord = async (path: string, scanOptions?: ScanLibraryOptions) => {
    await libraryApi.addLibraryFolder(path);
    await fetchLibraryFolders();
    await scanLibrary(scanOptions ?? getLibraryAddScanOptions(path));
    await fetchFolderTree();
  };

  const removeLibraryFolderRecord = async (path: string) => {
    await libraryApi.removeLibraryFolder(path);
    await fetchLibraryFolders();
    await scanLibrary({ trigger: 'manual-rescan', visibility: 'inline' });
    await fetchFolderTree();
  };

  const linkLibraryFolder = async (path: string, scanOptions?: ScanLibraryOptions) => {
    const resolvedScanOptions = resolveScanLibraryOptions(scanOptions ?? getLibraryAddScanOptions(path));
    await addLibraryFolderRecord(path, resolvedScanOptions);
    return resolvedScanOptions;
  };

  const unlinkLibraryFolder = async (path: string) => {
    await removeLibraryFolderRecord(path);
  };

  const playExternalSongs = async (songs: Song[]) => {
    const queue = dedupeSongs(songs);
    if (queue.length === 0) return;

    playbackStore.playQueue = [...queue];
    playbackStore.tempQueue = [];
    resetShuffleState();

    await playSong(queue[0], { preserveQueue: true });
  };

  const processExternalPaths = async (
    paths: string[],
    options: ProcessExternalPathsOptions = {},
  ): Promise<ProcessExternalPathsResult> => {
    const source = options.source ?? 'drop';
    const uniquePaths = dedupePaths(paths);
    if (uniquePaths.length === 0) {
      return {
        source,
        importedFolderCount: 0,
        skippedFolderCount: 0,
        playableSongs: [],
        ignoredFileCount: 0,
      };
    }

    const pathKinds = await Promise.all(
      uniquePaths.map(async path => ({
        path,
        isDirectory: await fileApi.isDirectory(path).catch(() => false),
      })),
    );

    const directoryPaths = pathKinds.filter(item => item.isDirectory).map(item => item.path);
    const filePaths = pathKinds.filter(item => !item.isDirectory).map(item => item.path);

    const existingLibraryPaths = new Set(
      libraryStore.libraryFolders.map(folder => normalizePath(folder.path)),
    );
    let importedFolderCount = 0;
    let skippedFolderCount = 0;
    let shouldRescanExistingLibrary = false;

    for (const directoryPath of directoryPaths) {
      const isExistingRoot = existingLibraryPaths.has(normalizePath(directoryPath));
      const isNestedInExistingRoot = libraryStore.libraryFolders.some(folder =>
        isWithinLibraryRoot(directoryPath, folder.path),
      );

      if (isExistingRoot || isNestedInExistingRoot) {
        skippedFolderCount += 1;
        shouldRescanExistingLibrary = true;
        continue;
      }

      try {
        await linkLibraryFolder(directoryPath);
        importedFolderCount += 1;
      } catch (error) {
        console.error('Failed to import external folder:', directoryPath, error);
      }
    }

    if (shouldRescanExistingLibrary) {
      await scanLibrary({ trigger: 'manual-rescan', visibility: 'silent' });
    }

    const parsedSongs = filePaths.length > 0
      ? await fileApi.parseAudioFiles(
        filePaths,
        settingsStore.settings.libraryMinDurationSeconds,
      ).catch(error => {
        console.error('Failed to parse external audio files:', error);
        return [];
      })
      : [];

    const playableSongs = dedupeSongs(parsedSongs);
    if (playableSongs.length > 0) {
      await playExternalSongs(playableSongs);
    }

    return {
      source,
      importedFolderCount,
      skippedFolderCount,
      playableSongs,
      ignoredFileCount: Math.max(0, filePaths.length - playableSongs.length),
    };
  };

  return {
    fetchLibraryFolders,
    addLibraryFolderRecord,
    removeLibraryFolderRecord,
    linkLibraryFolder,
    unlinkLibraryFolder,
    processExternalPaths,
  };
};
