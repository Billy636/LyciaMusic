import { open } from '@tauri-apps/plugin-dialog';

import { getLibraryAddScanOptions } from '../../composables/playerLibraryScan';
import type { ScanLibraryOptions } from '../../composables/playerLibraryScan';
import { useToast } from '../../composables/toast';
import type { Song } from '../../types';

type ExternalPathSource = 'drop' | 'open';

interface HandleExternalPathsOptions {
  source?: ExternalPathSource;
}

interface ProcessExternalPathsResult {
  source: ExternalPathSource;
  importedFolderCount: number;
  skippedFolderCount: number;
  playableSongs: Song[];
  ignoredFileCount: number;
  playlistFileCount?: number;
}

interface UseLibrarySyncOptions {
  fetchLibraryFolders: () => Promise<unknown>;
  scanLibrary: (options?: ScanLibraryOptions) => Promise<unknown>;
  refreshFolder: (folderPath: string, forceMetadataRefresh?: boolean) => Promise<unknown>;
  refreshAllFolders: () => Promise<unknown>;
  addLibraryFolder?: () => Promise<unknown>;
  addLibraryFolderLinked?: (
    path: string,
    options?: { showToast?: boolean; scanOptions?: ScanLibraryOptions },
  ) => Promise<unknown>;
  removeLibraryFolder?: (path: string) => Promise<unknown>;
  removeLibraryFolderLinked?: (
    path: string,
    options?: { showToast?: boolean },
  ) => Promise<unknown>;
  handleExternalPaths?: (
    paths: string[],
    options?: HandleExternalPathsOptions,
  ) => Promise<void>;
  addLibraryFolderPath?: (path: string) => Promise<unknown>;
  removeLibraryFolderPath?: (path: string) => Promise<unknown>;
  linkLibraryFolder?: (
    path: string,
    scanOptions?: ScanLibraryOptions,
  ) => Promise<Required<ScanLibraryOptions>>;
  unlinkLibraryFolder?: (path: string) => Promise<unknown>;
  processExternalPaths?: (
    paths: string[],
    options?: HandleExternalPathsOptions,
  ) => Promise<ProcessExternalPathsResult>;
  addLibraryFolderRecord?: (path: string, scanOptions?: ScanLibraryOptions) => Promise<unknown>;
  removeLibraryFolderRecord?: (path: string) => Promise<unknown>;
}

const getSongTitleLabel = (song: Song) => song.title || song.name;

export function useLibrarySync(options: UseLibrarySyncOptions) {
  const { showToast } = useToast();

  const addLibraryFolderLinked = options.addLibraryFolderLinked ?? (async (
    path: string,
    config: { showToast?: boolean; scanOptions?: ScanLibraryOptions } = {},
  ) => {
    if (!options.linkLibraryFolder) {
      return;
    }

    const { showToast: shouldShowToast = false, scanOptions } = config;
    const resolvedScanOptions = await options.linkLibraryFolder(path, scanOptions);

    if (shouldShowToast) {
      showToast(
        resolvedScanOptions.visibility === 'silent'
          ? '已将文件夹加入音乐库'
          : '已添加音乐库文件夹',
        'success',
      );
    }
  });

  const handleExternalPaths = options.handleExternalPaths ?? (async (
    paths: string[],
    config: HandleExternalPathsOptions = {},
  ) => {
    if (!options.processExternalPaths) {
      return;
    }

    const {
      source,
      importedFolderCount,
      skippedFolderCount,
      playableSongs,
      ignoredFileCount,
      playlistFileCount,
    } = await options.processExternalPaths(paths, config);

    if (importedFolderCount > 0 && playableSongs.length > 0) {
      showToast(
        `已导入 ${importedFolderCount} 个文件夹，并开始播放 ${getSongTitleLabel(playableSongs[0])}`,
        'success',
      );
      if (ignoredFileCount > 0) {
        showToast(`已忽略 ${ignoredFileCount} 个不支持的文件`, 'info');
      }
      if (skippedFolderCount > 0) {
        showToast(`${skippedFolderCount} 个文件夹已在音乐库中，已跳过`, 'info');
      }
      return;
    }

    if (importedFolderCount > 0) {
      showToast(`已导入 ${importedFolderCount} 个文件夹`, 'success');
      if (ignoredFileCount > 0) {
        showToast(`已忽略 ${ignoredFileCount} 个不支持的文件`, 'info');
      }
      if (skippedFolderCount > 0) {
        showToast(`${skippedFolderCount} 个文件夹已在音乐库中，已跳过`, 'info');
      }
      return;
    }

    if (playableSongs.length > 1) {
      showToast(`已载入 ${playableSongs.length} 首歌曲并开始播放`, 'success');
      if (ignoredFileCount > 0) {
        showToast(`已忽略 ${ignoredFileCount} 个不支持的文件`, 'info');
      }
      if (skippedFolderCount > 0) {
        showToast(`${skippedFolderCount} 个文件夹已在音乐库中，已跳过`, 'info');
      }
      return;
    }

    if (playableSongs.length === 1) {
      showToast(`正在播放 ${getSongTitleLabel(playableSongs[0])}`, 'success');
      if (skippedFolderCount > 0) {
        showToast(`${skippedFolderCount} 个文件夹已在音乐库中，已跳过`, 'info');
      }
      return;
    }

    if (skippedFolderCount > 0) {
      showToast(`${skippedFolderCount} 个文件夹已在音乐库中，未重复导入`, 'info');
      return;
    }

    if (playlistFileCount) {
      if (playlistFileCount > 1) showToast('已打开第一个歌单文件，请逐个导入其他歌单', 'info');
      return;
    }

    showToast(
      source === 'open'
        ? '没有找到可导入的音乐文件或文件夹'
        : '拖入的内容中没有可导入的音乐文件或文件夹',
      'error',
    );
  });

  const removeLibraryFolderLinked = options.removeLibraryFolderLinked ?? (async (
    path: string,
    config: { showToast?: boolean } = {},
  ) => {
    if (!options.unlinkLibraryFolder) {
      return;
    }

    const { showToast: shouldShowToast = true } = config;
    await options.unlinkLibraryFolder(path);

    if (shouldShowToast) {
      showToast('已从音乐库移除文件夹', 'success');
    }
  });

  const addLibraryFolder = options.addLibraryFolder ?? (async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择音乐文件夹',
      });

      if (!selected || typeof selected !== 'string') {
        return;
      }

      const scanOptions = getLibraryAddScanOptions(selected);
      await addLibraryFolderLinked(selected, {
        showToast: scanOptions.visibility === 'silent',
        scanOptions,
      });
    } catch (error) {
      console.error('Failed to add library folder:', error);
      showToast(`添加音乐文件夹失败: ${error}`, 'error');
    }
  });

  const addLibraryFolderPath = options.addLibraryFolderPath ?? (async (path: string) => {
    if (!options.addLibraryFolderRecord) {
      return;
    }

    try {
      await options.addLibraryFolderRecord(path, getLibraryAddScanOptions(path));
    } catch (error) {
      console.error('Failed to add library folder path:', error);
    }
  });

  const removeLibraryFolderPath = options.removeLibraryFolderPath ?? (async (path: string) => {
    if (!options.removeLibraryFolderRecord) {
      return;
    }

    try {
      await options.removeLibraryFolderRecord(path);
    } catch (error) {
      console.error('Failed to remove library folder path:', error);
    }
  });

  const removeLibraryFolder = options.removeLibraryFolder ?? (async (path: string) => {
    try {
      await removeLibraryFolderLinked(path);
    } catch (error) {
      console.error('Failed to remove library folder:', error);
    }
  });

  return {
    fetchLibraryFolders: options.fetchLibraryFolders,
    addLibraryFolder,
    addLibraryFolderLinked,
    removeLibraryFolder,
    removeLibraryFolderLinked,
    handleExternalPaths,
    scanLibrary: options.scanLibrary,
    addLibraryFolderPath,
    removeLibraryFolderPath,
    refreshFolder: options.refreshFolder,
    refreshAllFolders: options.refreshAllFolders,
  };
}
