import { ref, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { fileApi } from '../services/tauri/fileApi';
import { usePlaybackStore } from '../features/playback/store';
import type { Playlist } from '../types';
import { removeSongPathsFromPlaybackState } from './playbackCleanup';

interface ConfirmOptions {
  title: string;
  confirmText: string;
  message: string;
  action: () => void | Promise<void>;
}

interface UseHomeBatchActionsOptions {
  currentViewMode: Ref<string>;
  filterCondition?: Ref<string>;
  selectedPaths: Ref<Set<string>>;
  isBatchMode: Ref<boolean>;
  isManagementMode: Ref<boolean>;
  canonicalSongPaths: Ref<string[]>;
  sourceSongPaths: Ref<string[]>;
  favoritePaths: Ref<string[]>;
  playlists: Ref<Playlist[]>;
  moveFilesToFolder: (paths: string[], targetFolder: string) => Promise<number>;
  removeFromHistory: (songPaths: string[]) => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  getRoutePath: () => string;
}

export function useHomeBatchActions({
  currentViewMode,
  filterCondition,
  selectedPaths,
  isBatchMode,
  isManagementMode,
  canonicalSongPaths,
  sourceSongPaths,
  favoritePaths,
  playlists,
  moveFilesToFolder,
  removeFromHistory,
  showToast,
  getRoutePath,
}: UseHomeBatchActionsOptions) {
  const showMoveToFolderModal = ref(false);
  const showConfirm = ref(false);
  const confirmTitle = ref('移除歌曲');
  const confirmButtonText = ref('移除');
  const confirmMessage = ref('');
  const confirmAction = ref<() => void | Promise<void>>(() => {});
  const playbackStore = usePlaybackStore();
  const { playQueuePaths, tempQueuePaths, currentSong } = storeToRefs(playbackStore);

  const resetSelection = () => {
    selectedPaths.value.clear();
    isBatchMode.value = false;
  };

  const openConfirm = ({ title, confirmText, message, action }: ConfirmOptions) => {
    confirmTitle.value = title;
    confirmButtonText.value = confirmText;
    confirmMessage.value = message;
    confirmAction.value = action;
    showConfirm.value = true;
  };

  const executeBatchDelete = () => {
    if (currentViewMode.value === 'all' && getRoutePath() === '/') {
      const selected = new Set(selectedPaths.value);
      canonicalSongPaths.value = canonicalSongPaths.value.filter(path => !selected.has(path));
      sourceSongPaths.value = sourceSongPaths.value.filter(path => !selected.has(path));
    } else if (getRoutePath() === '/favorites') {
      const selected = new Set(selectedPaths.value);
      favoritePaths.value = favoritePaths.value.filter((path) => !selected.has(path));
    } else if (currentViewMode.value === 'playlist' && filterCondition?.value) {
      const selected = new Set(selectedPaths.value);
      const targetPlaylist = playlists.value.find(p => p.id === filterCondition.value);
      if (targetPlaylist) {
        targetPlaylist.songPaths = targetPlaylist.songPaths.filter(path => !selected.has(path));
      }
    }

    resetSelection();
    showConfirm.value = false;
  };

  const executeBatchPhysicalDelete = async () => {
    const paths = Array.from(selectedPaths.value);
    if (paths.length === 0) {
      return;
    }

    const deletedPaths = new Set<string>();

    for (const path of paths) {
      try {
        await fileApi.deleteMusicFile(path);
        deletedPaths.add(path);
      } catch (error) {
        console.error('Failed to delete song from disk:', path, error);
      }
    }

    if (deletedPaths.size > 0) {
      canonicalSongPaths.value = canonicalSongPaths.value.filter(path => !deletedPaths.has(path));
      sourceSongPaths.value = sourceSongPaths.value.filter(path => !deletedPaths.has(path));
      favoritePaths.value = favoritePaths.value.filter((path) => !deletedPaths.has(path));
      removeSongPathsFromPlaybackState({ playQueuePaths, tempQueuePaths, currentSong }, deletedPaths);
      await removeFromHistory(Array.from(deletedPaths));
      playlists.value.forEach((playlist) => {
        playlist.songPaths = playlist.songPaths.filter((path) => !deletedPaths.has(path));
      });

      showToast(`已删除 ${deletedPaths.size} 首本地歌曲`, 'success');
    }

    const failedCount = paths.length - deletedPaths.size;
    if (failedCount > 0) {
      showToast(`${failedCount} 首歌曲删除失败`, 'error');
    }

    resetSelection();
    showConfirm.value = false;
  };

  const requestBatchDelete = () => {
    if (selectedPaths.value.size === 0) return;

    openConfirm({
      title: '移除歌曲',
      confirmText: '移除',
      message: `确定要移除选中的 ${selectedPaths.value.size} 首歌曲吗？`,
      action: executeBatchDelete,
    });
  };

  const requestBatchPhysicalDelete = () => {
    if (selectedPaths.value.size === 0) return;

    openConfirm({
      title: '删除本地歌曲',
      confirmText: '删除',
      message: `确定要删除选中的 ${selectedPaths.value.size} 首本地歌曲吗？此操作会删除磁盘上的真实文件，且不可恢复。`,
      action: executeBatchPhysicalDelete,
    });
  };

  const handleFolderBatchDelete = () => {
    if (isManagementMode.value) {
      requestBatchPhysicalDelete();
      return;
    }

    requestBatchDelete();
  };

  const executeConfirmAction = async () => {
    await confirmAction.value();
    showConfirm.value = false;
  };

  const handleBatchMove = () => {
    if (selectedPaths.value.size > 0) {
      showMoveToFolderModal.value = true;
    }
  };

  const confirmBatchMove = async (targetFolder: string, folderName: string) => {
    try {
      const paths = Array.from(selectedPaths.value);
      const count = await moveFilesToFolder(paths, targetFolder);
      showToast(`已成功移动 ${count} 首歌曲到 "${folderName}"`, 'success');
      showMoveToFolderModal.value = false;
      resetSelection();
    } catch (error: any) {
      showToast(`移动失败: ${error?.message || error}`, 'error');
    }
  };

  return {
    showMoveToFolderModal,
    showConfirm,
    confirmTitle,
    confirmButtonText,
    confirmMessage,
    requestBatchDelete,
    handleFolderBatchDelete,
    executeConfirmAction,
    handleBatchMove,
    confirmBatchMove,
    openConfirm,
  };
}
