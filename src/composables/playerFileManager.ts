import { storeToRefs } from 'pinia';
import type { FolderNode, Song } from '../types';

import { fileApi } from '../services/tauri/fileApi';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { useNavigationStore } from '../shared/stores/navigation';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';
import { useLibraryAllSongPathCache } from './useLibraryAllSongPathCache';
import { useLibraryCollectionSongPathCache } from './useLibraryCollectionSongPathCache';
import { useLibraryDetailSongPathCache } from './useLibraryDetailSongPathCache';
import { useLibraryFolderSongPathCache } from './useLibraryFolderSongPathCache';
import { removeSongPathsFromPlaybackState } from './playbackCleanup';

interface CreatePlayerFileManagerDeps {
  removeLibraryFolderLinked: (
    path: string,
    options?: { showToast?: boolean }
  ) => Promise<void>;
  removeFromHistory: (songPaths: string[]) => Promise<void>;
  showToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

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

const incrementNodeCount = (nodes: FolderNode[], targetPath: string): boolean => {
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].path === targetPath) {
      nodes[index].song_count += 1;
      return true;
    }

    if (nodes[index].children.length > 0 && incrementNodeCount(nodes[index].children, targetPath)) {
      return true;
    }
  }

  return false;
};

const decrementNodeCount = (nodes: FolderNode[], targetPath: string): boolean => {
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].path === targetPath) {
      if (nodes[index].song_count > 0) {
        nodes[index].song_count -= 1;
      }
      return true;
    }

    if (nodes[index].children.length > 0 && decrementNodeCount(nodes[index].children, targetPath)) {
      return true;
    }
  }

  return false;
};

const updateFolderCover = (
  nodes: FolderNode[],
  folderPath: string,
  newCoverSongPath: string | null
): boolean => {
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].path === folderPath) {
      nodes[index].cover_song_path = newCoverSongPath;
      return true;
    }

    if (
      nodes[index].children.length > 0 &&
      updateFolderCover(nodes[index].children, folderPath, newCoverSongPath)
    ) {
      return true;
    }
  }

  return false;
};

const getParentFolder = (filePath: string): string => {
  const separator = filePath.includes('\\') ? '\\' : '/';
  const parts = filePath.split(separator);
  parts.pop();
  return parts.join(separator);
};

const findNode = (
  nodes: FolderNode[],
  targetPath: string
): FolderNode | null => {
  for (const node of nodes) {
    if (node.path === targetPath) return node;

    if (node.children.length > 0) {
      const found = findNode(node.children, targetPath);
      if (found) return found;
    }
  }

  return null;
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
  const { canonicalSongPaths, libraryHierarchy, sourceSongPaths, watchedFolders } = storeToRefs(libraryStore);
  const { favoritePaths, playlists, recentSongs } = storeToRefs(collectionsStore);
  const { currentSong, playQueuePaths, tempQueuePaths } = storeToRefs(playbackStore);

  const replacePathInList = (paths: string[], oldPath: string, newPath: string) =>
    paths.map(path => path === oldPath ? newPath : path);

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

  const moveFilePhysical = async (sourcePath: string, targetFolderPath: string) => {
    const sourceFolderPath = getParentFolder(sourcePath);
    const sourceNode = findNode(libraryHierarchy.value, sourceFolderPath);
    const wasSourceCover = sourceNode?.cover_song_path === sourcePath;

    await fileApi.moveFileToFolder(sourcePath, targetFolderPath);

    sourceSongPaths.value = sourceSongPaths.value.filter(path => path !== sourcePath);

    decrementNodeCount(libraryHierarchy.value, sourceFolderPath);

    if (wasSourceCover) {
      try {
        const newCoverPath = await fileApi.getFolderFirstSong(sourceFolderPath);
        updateFolderCover(libraryHierarchy.value, sourceFolderPath, newCoverPath);
      } catch {
        updateFolderCover(libraryHierarchy.value, sourceFolderPath, null);
      }
    }

    incrementNodeCount(libraryHierarchy.value, targetFolderPath);

    try {
      const targetCoverPath = await fileApi.getFolderFirstSong(targetFolderPath);
      updateFolderCover(libraryHierarchy.value, targetFolderPath, targetCoverPath);
    } catch {
      updateFolderCover(libraryHierarchy.value, targetFolderPath, null);
    }
  };

  const moveFilesToFolder = async (paths: string[], targetFolder: string) => {
    const moveResult = await fileApi.batchMoveMusicFiles(paths, targetFolder);
    const movedOldPaths = new Set(moveResult.moved_paths.map(entry => entry.old_path));
    const sourceFolderMap = new Map<string, { count: number; coverPaths: string[] }>();

    moveResult.moved_paths.forEach(({ old_path: oldPath }) => {
      const sourceFolder = getParentFolder(oldPath);
      if (!sourceFolderMap.has(sourceFolder)) {
        const node = findNode(libraryHierarchy.value, sourceFolder);
        sourceFolderMap.set(sourceFolder, {
          count: 0,
          coverPaths: node?.cover_song_path === oldPath ? [oldPath] : [],
        });
      }

      const entry = sourceFolderMap.get(sourceFolder)!;
      entry.count += 1;

      const node = findNode(libraryHierarchy.value, sourceFolder);
      if (node?.cover_song_path === oldPath && !entry.coverPaths.includes(oldPath)) {
        entry.coverPaths.push(oldPath);
      }
    });

    const movedCount = moveResult.moved_paths.length;
    sourceSongPaths.value = sourceSongPaths.value.filter(path => !movedOldPaths.has(path));

    for (const [sourceFolder, entry] of sourceFolderMap) {
      for (let index = 0; index < entry.count; index += 1) {
        decrementNodeCount(libraryHierarchy.value, sourceFolder);
      }

      if (entry.coverPaths.length > 0) {
        try {
          const newCoverPath = await fileApi.getFolderFirstSong(sourceFolder);
          updateFolderCover(libraryHierarchy.value, sourceFolder, newCoverPath);
        } catch {
          updateFolderCover(libraryHierarchy.value, sourceFolder, null);
        }
      }
    }

    for (let index = 0; index < movedCount; index += 1) {
      incrementNodeCount(libraryHierarchy.value, targetFolder);
    }

    try {
      const targetCoverPath = await fileApi.getFolderFirstSong(targetFolder);
      updateFolderCover(libraryHierarchy.value, targetFolder, targetCoverPath);
    } catch {
      updateFolderCover(libraryHierarchy.value, targetFolder, null);
    }

    return movedCount;
  };

  const refreshFolder = async (folderPath: string) => {
    const newSongs = await fileApi.scanMusicFolder(
      folderPath,
      settingsStore.settings.libraryMinDurationSeconds,
    );
    const removedPaths = canonicalSongPaths.value
      .filter(path => isSongInFolderScope(folderPath, path))
      .filter(path => !newSongs.some(song => song.path === path));
    const keepPath = (path: string) => !isSongInFolderScope(folderPath, path);
    const newPaths = newSongs.map(song => song.path);

    libraryStore.setSourceSongOrder([...sourceSongPaths.value.filter(keepPath), ...newPaths]);
    libraryStore.setCanonicalSongOrder([...canonicalSongPaths.value.filter(keepPath), ...newPaths]);
    clearLibraryPathCaches();

    if (removedPaths.length > 0) {
      const removedPathSet = new Set(removedPaths);
      favoritePaths.value = favoritePaths.value.filter(path => !removedPathSet.has(path));
      playlists.value.forEach((playlist) => {
        playlist.songPaths = playlist.songPaths.filter(path => !removedPathSet.has(path));
      });
      recentSongs.value = recentSongs.value.filter(item => !removedPathSet.has(item.path));
      playQueuePaths.value = playQueuePaths.value.filter(path => !removedPathSet.has(path));
      tempQueuePaths.value = tempQueuePaths.value.filter(path => !removedPathSet.has(path));

      if (currentSong.value && removedPathSet.has(currentSong.value.path)) {
        currentSong.value = null;
      }

      await removeFromHistory(removedPaths);
    }

    return {
      removedCount: removedPaths.length,
      removedPaths,
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
      await fileApi.moveMusicFile(song.path, newPath);

      const oldPath = song.path;
      libraryStore.setSourceSongOrder(replacePathInList(sourceSongPaths.value, oldPath, newPath));
      libraryStore.setCanonicalSongOrder(replacePathInList(canonicalSongPaths.value, oldPath, newPath));
      libraryStore.setSongRecord({ ...song, path: newPath });
      playQueuePaths.value = playQueuePaths.value.map(path => path === oldPath ? newPath : path);
      tempQueuePaths.value = tempQueuePaths.value.map(path => path === oldPath ? newPath : path);
      recentSongs.value = recentSongs.value.map(item =>
        item.path === oldPath
          ? { ...item, path: newPath }
          : item
      );

      if (currentSong.value?.path === oldPath) {
        currentSong.value = {
          ...currentSong.value,
          path: newPath,
        };
      }

      playlists.value.forEach(playlist => {
        const songIndex = playlist.songPaths.indexOf(oldPath);
        if (songIndex !== -1) {
          playlist.songPaths[songIndex] = newPath;
        }
      });

      const favoriteIndex = favoritePaths.value.indexOf(oldPath);
      if (favoriteIndex !== -1) {
        favoritePaths.value = favoritePaths.value.map(path => (path === oldPath ? newPath : path));
      }

      return true;
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
