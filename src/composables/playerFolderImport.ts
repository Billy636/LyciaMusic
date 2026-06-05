import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { storeToRefs } from 'pinia';

import type { Song } from '../types';
import { useLibraryStore } from '../features/library/store';
import { useSettingsStore } from '../features/settings/store';

interface GeneratedFolder {
  name: string;
  path: string;
  songs: Song[];
}

interface CreatePlayerFolderImportDeps {
  showToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

const isDirectParent = (parentPath: string, childPath: string) => {
  if (!parentPath || !childPath) return false;

  const normalizedParent = parentPath.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedChild = childPath.replace(/\\/g, '/');
  const lastSlash = normalizedChild.lastIndexOf('/');

  return lastSlash !== -1 && normalizedChild.substring(0, lastSlash) === normalizedParent;
};

export const createPlayerFolderImport = ({
  showToast,
}: CreatePlayerFolderImportDeps) => {
  const libraryStore = useLibraryStore();
  const settingsStore = useSettingsStore();
  const { songList, watchedFolders } = storeToRefs(libraryStore);

  const addFoldersFromStructure = async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: '选择要导入的根目录',
      });

      if (!selectedPath || typeof selectedPath !== 'string') return;

      const newFolders = await invoke<GeneratedFolder[]>('scan_folder_as_playlists', {
        rootPath: selectedPath,
        minimumDurationSeconds: settingsStore.settings.libraryMinDurationSeconds,
      });

      if (newFolders.length === 0) {
        showToast('未在该目录下找到包含音乐文件的文件夹', 'error');
        return;
      }

      let addedCount = 0;
      const allNewSongs: Song[] = [];

      newFolders.forEach(folder => {
        if (!watchedFolders.value.includes(folder.path)) {
          watchedFolders.value.push(folder.path);
          addedCount += 1;
        }

        allNewSongs.push(...folder.songs);
      });

      const existingPaths = new Set(songList.value.map(song => song.path));
      const uniqueNewSongs = allNewSongs.filter(song => !existingPaths.has(song.path));
      songList.value = [...songList.value, ...uniqueNewSongs];

      showToast(`已添加 ${addedCount} 个文件夹到本地目录视图`, 'success');
    } catch (error) {
      console.error('添加目录结构失败:', error);
      showToast(`添加目录结构失败: ${error}`, 'error');
    }
  };

  const clearLocalMusic = () => {
    songList.value = [];
    watchedFolders.value = [];
  };

  const addFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || typeof selected !== 'string') return;

      const newFolders = await invoke<GeneratedFolder[]>('scan_folder_as_playlists', {
        rootPath: selected,
        minimumDurationSeconds: settingsStore.settings.libraryMinDurationSeconds,
      });

      if (newFolders.length === 0) {
        if (!watchedFolders.value.includes(selected)) {
          watchedFolders.value.push(selected);
        }

        const songs = await invoke<Song[]>('scan_music_folder', {
          folderPath: selected,
          minimumDurationSeconds: settingsStore.settings.libraryMinDurationSeconds,
        });
        const existingPaths = new Set(songList.value.map(song => song.path));
        const uniqueSongs = songs.filter(song => !existingPaths.has(song.path));
        songList.value = [...songList.value, ...uniqueSongs];
        return;
      }

      newFolders.forEach(folder => {
        if (!watchedFolders.value.includes(folder.path)) {
          watchedFolders.value.push(folder.path);
        }
      });

      const allNewSongs = newFolders.flatMap(folder => folder.songs);
      const existingPaths = new Set(songList.value.map(song => song.path));
      const uniqueNewSongs = allNewSongs.filter(song => !existingPaths.has(song.path));
      songList.value = [...songList.value, ...uniqueNewSongs];
    } catch (error) {
      console.error('添加文件夹失败:', error);
    }
  };

  const getSongsInFolder = (folderPath: string) => {
    return songList.value.filter(song => isDirectParent(folderPath, song.path));
  };

  return {
    addFoldersFromStructure,
    clearLocalMusic,
    addFolder,
    getSongsInFolder,
  };
};
