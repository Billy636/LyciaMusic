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
  const { canonicalSongs, libraryHierarchy, sourceSongs, watchedFolders } = storeToRefs(libraryStore);
  const { favoritePaths, playlists, recentSongs } = storeToRefs(collectionsStore);
  const { currentSong, playQueue, tempQueue } = storeToRefs(playbackStore);

  const removeSongPathFromList = (songs: Song[], path: string) =>
    songs.filter(song => song.path !== path);

  const replaceSongPathInList = (songs: Song[], oldPath: string, newPath: string) => {
    let changed = false;
    const nextSongs = songs.map(song => {
      if (song.path !== oldPath) {
        return song;
      }

      changed = true;
      return { ...song, path: newPath };
    });

    return changed ? nextSongs : songs;
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

  const moveFilePhysical = async (sourcePath: string, targetFolderPath: string) => {
    const sourceFolderPath = getParentFolder(sourcePath);
    const sourceNode = findNode(libraryHierarchy.value, sourceFolderPath);
    const wasSourceCover = sourceNode?.cover_song_path === sourcePath;

    await fileApi.moveFileToFolder(sourcePath, targetFolderPath);

    sourceSongs.value = removeSongPathFromList(sourceSongs.value, sourcePath);

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
    sourceSongs.value = sourceSongs.value.filter(song => !movedOldPaths.has(song.path));

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
    const removedPaths = canonicalSongs.value
      .filter(song => isSongInFolderScope(folderPath, song.path))
      .map(song => song.path)
      .filter(path => !newSongs.some(song => song.path === path));
    const keepSong = (song: Song) => !isSongInFolderScope(folderPath, song.path);

    sourceSongs.value = [...sourceSongs.value.filter(keepSong), ...newSongs];
    canonicalSongs.value = [...canonicalSongs.value.filter(keepSong), ...newSongs];
    clearLibraryPathCaches();

    if (removedPaths.length > 0) {
      const removedPathSet = new Set(removedPaths);
      favoritePaths.value = favoritePaths.value.filter(path => !removedPathSet.has(path));
      playlists.value.forEach((playlist) => {
        playlist.songPaths = playlist.songPaths.filter(path => !removedPathSet.has(path));
      });
      recentSongs.value = recentSongs.value.filter(item => !removedPathSet.has(item.path));
      playQueue.value = playQueue.value.filter(song => !removedPathSet.has(song.path));
      tempQueue.value = tempQueue.value.filter(song => !removedPathSet.has(song.path));

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
      sourceSongs.value = replaceSongPathInList(sourceSongs.value, oldPath, newPath);
      canonicalSongs.value = replaceSongPathInList(canonicalSongs.value, oldPath, newPath);
      playQueue.value = replaceSongPathInList(playQueue.value, oldPath, newPath);
      tempQueue.value = replaceSongPathInList(tempQueue.value, oldPath, newPath);
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
      canonicalSongs.value = canonicalSongs.value.filter(item => item.path !== song.path);
      sourceSongs.value = sourceSongs.value.filter(item => item.path !== song.path);
      favoritePaths.value = favoritePaths.value.filter(path => path !== song.path);
      removeSongPathsFromPlaybackState({ playQueue, tempQueue, currentSong }, [song.path]);
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
      if (watchedFolders.value.length === 0 && sourceSongs.value.length > 0) {
        const potentialFolders = new Set<string>();
        sourceSongs.value.forEach(song => {
          const parent = song.path.replace(/[/\\][^/\\]+$/, '');
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

      let allNewSongs: Song[] = [];
      for (const folder of watchedFolders.value) {
        const songs = await fileApi.scanMusicFolder(folder);
        allNewSongs = allNewSongs.concat(songs);
      }

      const keptSongs = sourceSongs.value.filter(song => {
        return !watchedFolders.value.some(folder => song.path.startsWith(folder));
      });

      sourceSongs.value = [...keptSongs, ...allNewSongs];
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
