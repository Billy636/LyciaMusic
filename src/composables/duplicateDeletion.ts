import type { DuplicateDeleteGroup, DuplicateDeleteResult } from '../features/duplicates/types';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { duplicateApi } from '../services/tauri/duplicateApi';
import { historyApi } from '../services/tauri/historyApi';
import { libraryApi } from '../services/tauri/libraryApi';
import { tauriInvoke } from '../services/tauri/invoke';
import type { FolderNode } from '../types';
import { cleanupRemovedLibrarySongPaths, normalizePathForScope } from './libraryRemovalCleanup';
import { useLibraryAllSongPathCache } from './useLibraryAllSongPathCache';
import { useLibraryCollectionSongPathCache } from './useLibraryCollectionSongPathCache';
import { useLibraryDetailSongPathCache } from './useLibraryDetailSongPathCache';
import { useLibraryFolderSongPathCache } from './useLibraryFolderSongPathCache';

interface DuplicateDeletionDependencies {
  stopPlayback: () => Promise<void>;
  clearMetadataCaches: () => void;
  clearLegacyHistory: () => void;
  resetShuffleState: () => void;
  flushPersistedState: () => void;
  expandFolderPath: (path: string) => Promise<boolean>;
}

const describeError = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object' && 'message' in cause) return String(cause.message);
  return String(cause);
};

const collectExpandedFolders = (nodes: FolderNode[], paths: string[] = []): string[] => {
  for (const node of nodes) {
    if (node.is_expanded) paths.push(node.path);
    collectExpandedFolders(node.children, paths);
  }
  return paths;
};

/** The caller owns the file-operation lock; no existing single-file delete path is reused. */
export function createDuplicateDeletion(deps: DuplicateDeletionDependencies) {
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const { clearLibraryAllSongPathCache } = useLibraryAllSongPathCache();
  const { clearLibraryCollectionSongPathCache } = useLibraryCollectionSongPathCache();
  const { clearLibraryDetailSongPathCache } = useLibraryDetailSongPathCache();
  const { clearLibraryFolderSongPathCache } = useLibraryFolderSongPathCache();

  return async (groups: DuplicateDeleteGroup[]): Promise<DuplicateDeleteResult> => {
    const requestedKeys = new Set(groups.flatMap(group =>
      group.delete_files.map(file => normalizePathForScope(file.path)),
    ));
    if (requestedKeys.size === 0) {
      return { deleted_paths: [], missing_paths: [], failures: [], warnings: [] };
    }

    const activeSong = playbackStore.currentSong;
    const activePaths = [playbackStore.currentSongPath, activeSong?.path, activeSong?.cue_source_path];
    if (activePaths.some(path => path && requestedKeys.has(normalizePathForScope(path)))) {
      // A failed stop must abort before destructive I/O; a pause does not release the file.
      await deps.stopPlayback();
    }

    // An unknown command failure must propagate so the page can invalidate its snapshot.
    const result = await duplicateApi.deleteDuplicates(groups);
    if (result.deleted_paths.length === 0 && result.missing_paths.length === 0) return result;

    const attempt = async (label: string, action: () => void | Promise<unknown>) => {
      try { await action(); }
      catch (cause) { result.warnings.push(`${label}失败：${describeError(cause)}`); }
    };

    // Once the backend confirms disappearance, refresh failures must never hide that fact.
    try {
      const removedPaths = [...new Set([...result.deleted_paths, ...result.missing_paths])];
      const removedKeys = new Set(removedPaths.map(normalizePathForScope));
      const knownPaths = new Set([
        ...libraryStore.canonicalSongPaths,
        ...libraryStore.sourceSongPaths,
        ...playbackStore.playQueuePaths,
        ...playbackStore.tempQueuePaths,
        ...(playbackStore.currentSongPath ? [playbackStore.currentSongPath] : []),
        ...(activeSong?.path ? [activeSong.path] : []),
      ]);
      // patchLibrarySongPaths uses exact keys; include the library's original case/separators.
      for (const path of knownPaths) {
        const knownSong = activeSong?.path === path ? activeSong : playbackStore.getKnownSongByPath(path);
        const cueSourcePath = knownSong && 'cue_source_path' in knownSong
          && typeof knownSong.cue_source_path === 'string' ? knownSong.cue_source_path : undefined;
        if (removedKeys.has(normalizePathForScope(path))
          || (cueSourcePath && removedKeys.has(normalizePathForScope(cueSourcePath)))) {
          removedPaths.push(path);
        }
      }
      const confirmedPaths = [...new Set(removedPaths)];

      await attempt('同步音乐库歌曲列表', () => {
        libraryStore.patchLibrarySongPaths({ added_paths: [], deleted_paths: confirmedPaths });
      });
      await attempt('同步收藏、歌单、队列与排序', () => cleanupRemovedLibrarySongPaths({
        removedPaths: confirmedPaths,
        stopPlayback: deps.stopPlayback,
      }));
      await attempt('清理播放队列缓存', () => {
        // Materialized getters omit lazy path-only entries; preserve those after pruning
        // detached fallback records, just like the existing file-move state sync does.
        const remainingQueuePaths = [...playbackStore.playQueuePaths];
        const remainingTempQueuePaths = [...playbackStore.tempQueuePaths];
        playbackStore.playQueue = [...playbackStore.playQueue];
        playbackStore.tempQueue = [...playbackStore.tempQueue];
        playbackStore.playQueuePaths = remainingQueuePaths;
        playbackStore.tempQueuePaths = remainingTempQueuePaths;
        deps.resetShuffleState();
      });
      await attempt('清理旧版历史缓存', deps.clearLegacyHistory);
      await attempt('同步播放历史', () => historyApi.removeFromRecentHistory(confirmedPaths));
      await attempt('同步播放统计', () => historyApi.removeSongsFromHistoryAndStatistics(confirmedPaths));
      await attempt('清理歌曲信息缓存', deps.clearMetadataCaches);
      await attempt('清理音乐库路径缓存', () => {
        clearLibraryAllSongPathCache();
        clearLibraryCollectionSongPathCache();
        clearLibraryDetailSongPathCache();
        clearLibraryFolderSongPathCache();
      });

      // Use non-swallowing APIs so failed refreshes are visible in the deletion result.
      await Promise.all([
        attempt('刷新音乐库文件夹', async () => {
          libraryStore.setLibraryFolders(await libraryApi.getLibraryFolders());
        }),
        attempt('刷新音乐库目录', async () => {
          const expandedPaths = collectExpandedFolders(libraryStore.libraryHierarchy);
          libraryStore.setLibraryHierarchy(await libraryApi.getLibraryHierarchy());
          for (const path of expandedPaths.sort((left, right) => left.length - right.length)) {
            await deps.expandFolderPath(path);
          }
        }),
        attempt('刷新歌手目录', async () => {
          libraryStore.setArtistCatalog(await tauriInvoke('get_library_artist_catalog'));
        }),
        attempt('刷新专辑目录', async () => {
          libraryStore.setAlbumCatalog(await tauriInvoke('get_library_album_catalog'));
        }),
      ]);
    } catch (cause) {
      result.warnings.push(`文件处理结果已确认，但部分状态未能同步：${describeError(cause)}`);
    }
    await attempt('保存整理后的播放器状态', deps.flushPersistedState);
    return result;
  };
}
