import { storeToRefs } from 'pinia';
import type { FolderNode, LibrarySong, Song } from '../types';

import { fileApi } from '../services/tauri/fileApi';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { useFolderAlbumCollections } from '../features/library/useFolderAlbumCollections';
import { useNavigationStore } from '../shared/stores/navigation';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';
import { useLibraryAllSongPathCache } from './useLibraryAllSongPathCache';
import { useLibraryCollectionSongPathCache } from './useLibraryCollectionSongPathCache';
import { useLibraryDetailSongPathCache } from './useLibraryDetailSongPathCache';
import { useLibraryFolderSongPathCache } from './useLibraryFolderSongPathCache';
import { useLibrarySongResolver } from './useLibrarySongResolver';
import { removeSongPathsFromPlaybackState } from './playbackCleanup';
import { remapFolderPath } from '../utils/folderMove';

interface CreatePlayerFileManagerDeps {
  removeLibraryFolderLinked: (
    path: string,
    options?: { showToast?: boolean }
  ) => Promise<void>;
  removeFromHistory: (songPaths: string[]) => Promise<void>;
  onSongPathsMoved?: (currentSongChanged: boolean) => Promise<void>;
  onFolderMetadataRefreshed?: (folderPaths: string[]) => Promise<void>;
  showToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

let fileMoveInProgress = false;

const removeNodeFromTree = (nodes: FolderNode[], targetPath: string): boolean => {
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].path === targetPath) {
      nodes.splice(index, 1);
      return true;
    }

    if (nodes[index].children.length > 0 && removeNodeFromTree(nodes[index].children, targetPath)) {
      return true;
    }
  }

  return false;
};

const sanitizePathSegment = (value: string) => value.replace(/[<>:"/\\|?*]/g, '_').trim();

const normalizePathForMatch = (path: string) =>
  path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const isSongInFolderScope = (folderPath: string, songPath: string) => {
  const normalizedFolder = normalizePathForMatch(folderPath);
  const normalizedSong = normalizePathForMatch(songPath);
  return normalizedSong === normalizedFolder || normalizedSong.startsWith(`${normalizedFolder}/`);
};

export const createPlayerFileManager = ({
  removeLibraryFolderLinked,
  removeFromHistory,
  onSongPathsMoved,
  onFolderMetadataRefreshed,
  showToast,
}: CreatePlayerFileManagerDeps) => {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const navigationStore = useNavigationStore();
  const playbackStore = usePlaybackStore();
  const settingsStore = useSettingsStore();
  const { clearLibraryAllSongPathCache } = useLibraryAllSongPathCache();
  const { clearLibraryCollectionSongPathCache } = useLibraryCollectionSongPathCache();
  const { clearLibraryDetailSongPathCache } = useLibraryDetailSongPathCache();
  const { clearLibraryFolderSongPathCache } = useLibraryFolderSongPathCache();
  const { loadSongs, clearResolvedSongCache } = useLibrarySongResolver();
  const { canonicalSongPaths, libraryHierarchy, sourceSongPaths, watchedFolders } = storeToRefs(libraryStore);
  const { favoritePaths, playlists, recentSongs } = storeToRefs(collectionsStore);
  const { currentSong, currentCoverPath, playQueuePaths, tempQueuePaths } = storeToRefs(playbackStore);

  const runFileMove = async <T>(operation: () => Promise<T>): Promise<T> => {
    const scan = libraryStore.libraryScanProgress;
    if (scan && !scan.done && !scan.failed) {
      throw new Error('音乐库正在扫描，请稍后再移动');
    }
    if (fileMoveInProgress) {
      throw new Error('正在移动文件，请等待当前操作完成');
    }
    fileMoveInProgress = true;
    try {
      return await operation();
    } finally {
      fileMoveInProgress = false;
    }
  };

  const clearLibraryPathCaches = () => {
    clearLibraryAllSongPathCache();
    clearLibraryCollectionSongPathCache();
    clearLibraryDetailSongPathCache();
    clearLibraryFolderSongPathCache();
  };

  const deleteFolder = async (path: string) => {
    await fileApi.deleteFolder(path);

    const isRoot = libraryHierarchy.value.some(node => node.path === path);
    if (isRoot) {
      await removeLibraryFolderLinked(path, { showToast: false });
      return;
    }

    removeNodeFromTree(libraryHierarchy.value, path);
  };

  const applyMovedPathState = (remap: (path: string) => string) => {
    const remapSong = (song: Song): Song => ({
      ...song,
      path: remap(song.path),
      cue_source_path: song.cue_source_path ? remap(song.cue_source_path) : song.cue_source_path,
      cover_thumb_path: song.cover_thumb_path ? remap(song.cover_thumb_path) : song.cover_thumb_path,
    });
    const hasMovedPath = (song: Song) => remap(song.path) !== song.path
      || !!(song.cue_source_path && remap(song.cue_source_path) !== song.cue_source_path)
      || !!(song.cover_thumb_path && remap(song.cover_thumb_path) !== song.cover_thumb_path);

    // Capture the active and fallback records before replacing library keys:
    // pruning the old key must not turn the active song into null mid-move.
    const activeSong = currentSong.value;
    const currentSongChanged = !!activeSong && hasMovedPath(activeSong);
    const nextCurrentSong = activeSong && currentSongChanged ? remapSong(activeSong) : activeSong;
    const nextSourcePaths = sourceSongPaths.value.map(remap);
    const nextCanonicalPaths = canonicalSongPaths.value.map(remap);
    const nextQueuePaths = playQueuePaths.value.map(remap);
    const nextTempQueuePaths = tempQueuePaths.value.map(remap);
    const queueSongs = playQueuePaths.value
      .map(path => playbackStore.getKnownSongByPath(path))
      .filter((song): song is Song => !!song)
      .map(remapSong);
    const tempSongs = tempQueuePaths.value
      .map(path => playbackStore.getKnownSongByPath(path))
      .filter((song): song is Song => !!song)
      .map(remapSong);
    const changedRecords = [...libraryStore.songLookup.values()].filter(hasMovedPath);

    if (currentSongChanged && nextCurrentSong) currentSong.value = nextCurrentSong;
    libraryStore.patchLibrarySongs({
      songs: changedRecords.map(remapSong),
      deleted_paths: changedRecords.filter(song => remap(song.path) !== song.path).map(song => song.path),
    });
    libraryStore.setSourceSongOrder(nextSourcePaths);
    libraryStore.setCanonicalSongOrder(nextCanonicalPaths);
    favoritePaths.value = favoritePaths.value.map(remap);
    playlists.value.forEach(playlist => { playlist.songPaths = playlist.songPaths.map(remap); });
    recentSongs.value = recentSongs.value.map(item => ({ ...item, path: remap(item.path) }));
    // Use the song setters to migrate fallback records, then retain unresolved
    // path-only queue entries as well. None of this reloads or stops audio.
    playbackStore.playQueue = queueSongs;
    playbackStore.tempQueue = tempSongs;
    playQueuePaths.value = nextQueuePaths;
    tempQueuePaths.value = nextTempQueuePaths;
    if (currentSongChanged && nextCurrentSong) {
      const librarySong = libraryStore.getSongByPath(nextCurrentSong.path);
      if (librarySong) Object.assign(librarySong, nextCurrentSong);
      currentSong.value = nextCurrentSong;
    }
    currentCoverPath.value = remap(currentCoverPath.value);
    libraryStore.localCustomOrder = libraryStore.localCustomOrder.map(remap);
    libraryStore.folderCustomOrder = Object.fromEntries(Object.entries(libraryStore.folderCustomOrder)
      .map(([folder, paths]) => [remap(folder), paths.map(remap)]));
    libraryStore.setArtistCatalog(libraryStore.artistCatalog.map(item => ({ ...item, firstSongPath: remap(item.firstSongPath) })));
    libraryStore.setAlbumCatalog(libraryStore.albumCatalog.map(item => ({ ...item, firstSongPath: remap(item.firstSongPath) })));
    const overrides = settingsStore.settings.lyrics.readingOrderOverrides;
    if (overrides) settingsStore.settings.lyrics.readingOrderOverrides = Object.fromEntries(
      Object.entries(overrides).map(([path, value]) => [remap(path), value]),
    );
    navigationStore.currentFolderFilter = remap(navigationStore.currentFolderFilter);
    navigationStore.folderCollectionPath = remap(navigationStore.folderCollectionPath);
    try {
      useFolderAlbumCollections().remapFolders(remap);
    } catch (error) {
      console.error('Failed to update album folder collections after moving files:', error);
      showToast('文件已移动，专辑合集设置保存失败，请重新设置合并显示', 'error');
    }
    libraryStore.pruneSongPool();
    clearLibraryPathCaches();
    return currentSongChanged;
  };

  const refreshMovedPaths = async (currentSongChanged: boolean) => {
    try {
      await onSongPathsMoved?.(currentSongChanged);
    } catch (error) {
      console.error('Files moved but some views could not be refreshed:', error);
      showToast('文件已移动，部分视图刷新失败，请刷新音乐库', 'info');
    }
  };

  const moveFolderToFolder = (sourcePath: string, targetFolder: string) => runFileMove(async () => {
    const result = await fileApi.moveFolderToFolder(sourcePath, targetFolder);
    const currentSongChanged = applyMovedPathState(path => remapFolderPath(path, result.old_path, result.new_path));
    await refreshMovedPaths(currentSongChanged);
    return result.new_path;
  });

  const moveFilesToFolder = (paths: string[], targetFolder: string): Promise<number> => runFileMove(async () => {
    const result = await fileApi.batchMoveMusicFiles(paths, targetFolder);
    if (result.moved_paths.length === 0) return 0;

    const movedPaths = new Map(result.moved_paths.map(({ old_path, new_path }) => [normalizePathForMatch(old_path), new_path]));
    const currentSongChanged = applyMovedPathState(path => movedPaths.get(normalizePathForMatch(path)) ?? path);
    await refreshMovedPaths(currentSongChanged);
    return result.moved_paths.length;
  });

  const moveFilePhysical = async (sourcePath: string, targetFolderPath: string) => {
    await moveFilesToFolder([sourcePath], targetFolderPath);
  };

  const refreshFolder = async (folderPath: string, forceMetadataRefresh = true) => {
    // Capture membership before scan events can apply additions and deletions.
    const previousScopedPaths = canonicalSongPaths.value
      .filter(path => isSongInFolderScope(folderPath, path));
    const retainedLibrarySongs = new Map<string, LibrarySong>();
    for (const song of libraryStore.songLookup.values()) {
      if (isSongInFolderScope(folderPath, song.path)) {
        retainedLibrarySongs.set(normalizePathForMatch(song.path), song);
      }
    }
    const retainedPaths = new Set(retainedLibrarySongs.keys());
    for (const path of playbackStore.getRetainedFallbackSongPaths()) {
      if (isSongInFolderScope(folderPath, path)) retainedPaths.add(normalizePathForMatch(path));
    }
    const activeSong = currentSong.value;
    const activePathKey = activeSong ? normalizePathForMatch(activeSong.path) : null;
    const activePlaybackId = playbackStore.currentPlaybackId;
    if (activeSong && isSongInFolderScope(folderPath, activeSong.path)) {
      retainedPaths.add(normalizePathForMatch(activeSong.path));
    }
    if (forceMetadataRefresh) libraryStore.setLastLibraryScanError(null);
    const newPaths = await fileApi.scanMusicFolderPaths(
      folderPath,
      settingsStore.settings.libraryMinDurationSeconds,
      forceMetadataRefresh,
    );
    const normalizedNewPaths = new Map(newPaths.map(path => [normalizePathForMatch(path), path]));
    const normalizedOldPaths = new Set(previousScopedPaths.map(path => normalizePathForMatch(path)));

    const removedPaths = previousScopedPaths
      .filter(path => !normalizedNewPaths.has(normalizePathForMatch(path)));
    const addedPaths = newPaths.filter(path => !normalizedOldPaths.has(normalizePathForMatch(path)));

    const keepPath = (path: string) => !isSongInFolderScope(folderPath, path);
    const pathsToRefresh = newPaths.filter(path => retainedPaths.has(normalizePathForMatch(path)));
    clearResolvedSongCache();
    // Bound the temporary hydration result as well as the resolver cache. New
    // directory entries stay path-only until a viewport or playback needs them.
    let hydrationFailure: { error: unknown } | null = null;
    try {
      for (let offset = 0; offset < pathsToRefresh.length; offset += 256) {
        const songs = await loadSongs(pathsToRefresh.slice(offset, offset + 256));
        libraryStore.refreshRetainedSongRecords(songs.flatMap(song => {
          const previousSong = retainedLibrarySongs.get(normalizePathForMatch(song.path));
          return previousSong ? [{ previousSong, song }] : [];
        }));
        playbackStore.refreshRetainedFallbackSongs(songs);
        const refreshedActiveSong = songs.find(song => normalizePathForMatch(song.path) === activePathKey);
        if (refreshedActiveSong
          && currentSong.value
          && normalizePathForMatch(currentSong.value.path) === activePathKey
          && playbackStore.currentPlaybackId === activePlaybackId) {
          currentSong.value = { ...currentSong.value, ...refreshedActiveSong };
        }
      }
    } catch (error) {
      // The scan already succeeded. Reconcile its paths and invalidate views
      // even if the optional hydration of retained metadata could not finish.
      hydrationFailure = { error };
    }

    libraryStore.setSourceSongOrder([...sourceSongPaths.value.filter(keepPath), ...newPaths]);
    libraryStore.setCanonicalSongOrder([...canonicalSongPaths.value.filter(keepPath), ...newPaths]);
    libraryStore.pruneSongPool();
    // Same-path tag edits still need new metadata pages and updated sorting.
    libraryStore.notifyLibraryMetadataRefreshed();
    clearLibraryPathCaches();
    navigationStore.refreshSearch();

    if (removedPaths.length > 0) {
      const removedPathSet = new Set(removedPaths.map(normalizePathForMatch));
      favoritePaths.value = favoritePaths.value.filter(path => !removedPathSet.has(normalizePathForMatch(path)));
      playlists.value.forEach((playlist) => {
        playlist.songPaths = playlist.songPaths.filter(path => !removedPathSet.has(normalizePathForMatch(path)));
      });
      recentSongs.value = recentSongs.value.filter(item => !removedPathSet.has(normalizePathForMatch(item.path)));
      playQueuePaths.value = playQueuePaths.value.filter(path => !removedPathSet.has(normalizePathForMatch(path)));
      tempQueuePaths.value = tempQueuePaths.value.filter(path => !removedPathSet.has(normalizePathForMatch(path)));

      if (currentSong.value && removedPathSet.has(normalizePathForMatch(currentSong.value.path))) {
        currentSong.value = null;
      }
    }

    const canonicalQueuePath = (path: string) => normalizedNewPaths.get(normalizePathForMatch(path)) ?? path;
    playQueuePaths.value = playQueuePaths.value.map(canonicalQueuePath);
    tempQueuePaths.value = tempQueuePaths.value.map(canonicalQueuePath);

    if (removedPaths.length > 0) {
      await removeFromHistory(removedPaths);
    }
    await onFolderMetadataRefreshed?.([folderPath]);
    if (hydrationFailure) throw hydrationFailure.error;

    return {
      removedCount: removedPaths.length,
      removedPaths,
      addedCount: addedPaths.length,
      addedPaths,
    };
  };

  const removeFolder = (folderPath: string) => {
    watchedFolders.value = watchedFolders.value.filter(path => path !== folderPath);

    if (navigationStore.currentFolderFilter === folderPath) {
      navigationStore.currentFolderFilter =
        watchedFolders.value.length > 0 ? watchedFolders.value[0] : '';
    }
  };

  const generateOrganizedPath = (song: Song): string => {
    const root = settingsStore.settings.organizeRoot || 'D:\\Music';
    if (!settingsStore.settings.enableAutoOrganize) return '';

    const separator = root.includes('/') ? '/' : '\\';
    const artist = sanitizePathSegment(
      song.artist && song.artist !== 'Unknown' ? song.artist : 'Unknown Artist'
    );
    const album = sanitizePathSegment(
      song.album && song.album !== 'Unknown' ? song.album : 'Unknown Album'
    );
    const title = sanitizePathSegment(song.title || song.name);
    const year = sanitizePathSegment(song.year ? song.year.substring(0, 4) : '0000');

    let relativePath = settingsStore.settings.organizeRule
      .replace('{Artist}', artist)
      .replace('{Album}', album)
      .replace('{Title}', title)
      .replace('{Year}', year);

    relativePath = relativePath.replace(/\/\//g, '/').replace(/\\\\/g, '\\');
    return `${root}${separator}${relativePath}`;
  };

  const moveFile = async (song: Song, newPath: string) => {
    try {
      return await runFileMove(async () => {
        const oldPath = song.path;
        await fileApi.moveMusicFile(oldPath, newPath);
        const oldPathKey = normalizePathForMatch(oldPath);
        const currentSongChanged = applyMovedPathState(path => normalizePathForMatch(path) === oldPathKey ? newPath : path);
        await refreshMovedPaths(currentSongChanged);
        return true;
      });
    } catch (error) {
      showToast(`整理失败: ${error}`, 'error');
      return false;
    }
  };

  const openInFinder = async (path: string) => {
    await fileApi.showInFolder(path);
  };

  const deleteFromDisk = async (song: Song) => {
    try {
      await fileApi.deleteMusicFile(song.path);
      libraryStore.patchLibrarySongPaths({ added_paths: [], deleted_paths: [song.path] });
      favoritePaths.value = favoritePaths.value.filter(path => path !== song.path);
      removeSongPathsFromPlaybackState({ playQueuePaths, tempQueuePaths, currentSong }, [song.path]);
      await removeFromHistory([song.path]);
      playlists.value.forEach(playlist => {
        playlist.songPaths = playlist.songPaths.filter(path => path !== song.path);
      });
    } catch (error) {
      showToast(`删除失败: ${error}`, 'error');
    }
  };

  const refreshAllFolders = async () => {
    try {
      if (watchedFolders.value.length === 0 && sourceSongPaths.value.length > 0) {
        const potentialFolders = new Set<string>();
        sourceSongPaths.value.forEach(path => {
          const parent = path.replace(/[/\\][^/\\]+$/, '');
          if (parent) {
            potentialFolders.add(parent);
          }
        });

        if (potentialFolders.size > 0) {
          watchedFolders.value = Array.from(potentialFolders);
          showToast(`已恢复 ${potentialFolders.size} 个文件夹`, 'success');
        }
      }

      if (watchedFolders.value.length === 0) {
        showToast('没有可刷新的文件夹', 'info');
        return;
      }

      const previousPaths = [...sourceSongPaths.value];
      const previousPathSet = new Set(previousPaths);

      let allNewSongs: Song[] = [];
      for (const folder of watchedFolders.value) {
        const songs = await fileApi.scanMusicFolder(folder);
        allNewSongs = allNewSongs.concat(songs);
      }

      const keptSourcePaths = sourceSongPaths.value.filter(path => {
        return !watchedFolders.value.some(folder => isSongInFolderScope(folder, path));
      });
      libraryStore.setSourceSongOrder([...keptSourcePaths, ...allNewSongs.map(song => song.path)]);

      const keptCanonicalPaths = canonicalSongPaths.value.filter(path => {
        return !watchedFolders.value.some(folder => isSongInFolderScope(folder, path));
      });
      libraryStore.setCanonicalSongOrder([...keptCanonicalPaths, ...allNewSongs.map(song => song.path)]);

      const currentPathSet = new Set(sourceSongPaths.value);
      const removedPaths = previousPaths.filter(path => !currentPathSet.has(path));

      const queuePathsToCheck = [
        ...playQueuePaths.value,
        ...tempQueuePaths.value,
        ...(currentSong.value ? [currentSong.value.path] : []),
      ];
      const uniqueQueuePaths = Array.from(new Set(queuePathsToCheck));

      const allRemovedPaths = [...removedPaths];
      for (const path of uniqueQueuePaths) {
        if (!previousPathSet.has(path)) {
          try {
            const exists = await fileApi.fileExists(path);
            if (!exists) {
              allRemovedPaths.push(path);
            }
          } catch (error) {
            console.error(`Failed to verify file existence for external path: ${path}`, error);
          }
        }
      }

      if (allRemovedPaths.length > 0) {
        removeSongPathsFromPlaybackState({ playQueuePaths, tempQueuePaths, currentSong }, allRemovedPaths);
        await removeFromHistory(allRemovedPaths);
        playlists.value.forEach((playlist) => {
          const removedSet = new Set(allRemovedPaths);
          playlist.songPaths = playlist.songPaths.filter(path => !removedSet.has(path));
        });
        const removedSet = new Set(allRemovedPaths);
        recentSongs.value = recentSongs.value.filter(item => !removedSet.has(item.path));
        favoritePaths.value = favoritePaths.value.filter(path => !removedSet.has(path));
      }

      showToast('已刷新所有文件夹', 'success');
    } catch (error) {
      console.error('刷新文件夹失败:', error);
      showToast(`刷新失败: ${error}`, 'error');
    }
  };

  return {
    deleteFolder,
    moveFolderToFolder,
    moveFilePhysical,
    moveFilesToFolder,
    refreshFolder,
    removeFolder,
    generateOrganizedPath,
    moveFile,
    openInFinder,
    deleteFromDisk,
    refreshAllFolders,
  };
};
