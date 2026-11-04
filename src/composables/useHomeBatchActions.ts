import { onDeactivated, ref, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { fileApi } from '../services/tauri/fileApi';
import { usePlaybackStore } from '../features/playback/store';
import type { Playlist } from '../types';
import { removeSongPathsFromPlaybackState } from './playbackCleanup';
import { folderPathKey } from '../utils/folderMove';

interface ConfirmOptions {
  title: string;
  confirmText: string;
  message: string;
  action: () => void | Promise<void>;
  type?: 'danger' | 'info';
}

interface UseHomeBatchActionsOptions {
  currentViewMode: Ref<string>;
  filterCondition?: Ref<string>;
  selectedPaths: Ref<Set<string>>;
  isBatchMode: Ref<boolean>;
  isManagementMode: Ref<boolean>;
  selectionScope?: Ref<string>;
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
  selectionScope,
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
  const pendingMovePaths = ref<string[]>([]);
  const isMovingSongs = ref(false);
  const showConfirm = ref(false);
  const confirmType = ref<'danger' | 'info'>('danger');
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

  const openConfirm = ({ title, confirmText, message, action, type = 'danger' }: ConfirmOptions) => {
    confirmType.value = type;
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
      if (targetPlaylist && !targetPlaylist.importData?.linked) {
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
        if (playlist.importData?.linked) return;
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
    if (currentViewMode.value === 'playlist' && playlists.value.find(p => p.id === filterCondition?.value)?.importData?.linked) {
      showToast('文件关联歌单由源文件管理，请先复制为普通歌单', 'info');
      return;
    }

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
    const action = confirmAction.value;
    showConfirm.value = false;
    await action();
  };

  const canMoveSongs = () => !isMovingSongs.value
    && (currentViewMode.value !== 'folder' || isManagementMode.value);

  const handleBatchMove = () => {
    if (!canMoveSongs() || selectedPaths.value.size === 0) return;
    pendingMovePaths.value = Array.from(selectedPaths.value);
    showMoveToFolderModal.value = true;
  };

  const executeSongMove = async (paths: string[], targetFolder: string, folderName: string) => {
    if (!canMoveSongs() || paths.length === 0) return;
    const sourceScope = selectionScope?.value;
    isMovingSongs.value = true;
    try {
      const count = await moveFilesToFolder(paths, targetFolder);
      if (count === 0) {
        showToast('歌曲已在这个文件夹中', 'info');
        return;
      }
      showToast(`已移动 ${count} 首歌曲到“${folderName}”`, 'success');
      showMoveToFolderModal.value = false;
      pendingMovePaths.value = [];
      if (sourceScope === selectionScope?.value) {
        paths.forEach(path => selectedPaths.value.delete(path));
        if (selectedPaths.value.size === 0) isBatchMode.value = false;
      }
    } catch (error: any) {
      showToast(`移动失败: ${error?.message || error}`, 'error');
    } finally {
      isMovingSongs.value = false;
    }
  };

  const confirmBatchMove = (targetFolder: string, folderName: string) =>
    executeSongMove([...pendingMovePaths.value], targetFolder, folderName);

  const requestSongDrop = (paths: string[], target: { path: string; name: string }) => {
    if (!canMoveSongs() || showConfirm.value || showMoveToFolderModal.value) return;
    const movingPaths = [...new Set(paths)].filter(path =>
      folderPathKey(path.replace(/[/\\][^/\\]+$/, '')) !== folderPathKey(target.path),
    );
    if (!movingPaths.length) { showToast('歌曲已在这个文件夹中', 'info'); return; }
    const destination = { ...target };
    openConfirm({
      title: '移动歌曲',
      confirmText: '移动',
      message: `将 ${movingPaths.length} 首歌曲移动到“${destination.name}”？`,
      type: 'info',
      action: () => executeSongMove(movingPaths, destination.path, destination.name),
    });
  };

  watch([currentViewMode, isManagementMode], ([view, management], [previousView]) => {
    if (view !== previousView || (view === 'folder' && !management)) {
      showMoveToFolderModal.value = false;
      pendingMovePaths.value = [];
      if (confirmType.value === 'info') showConfirm.value = false;
    }
  });

  const cancelPendingActions = () => {
    showMoveToFolderModal.value = false;
    pendingMovePaths.value = [];
    showConfirm.value = false;
    confirmAction.value = () => {};
  };
  if (selectionScope) watch(selectionScope, cancelPendingActions, { flush: 'sync' });
  onDeactivated(cancelPendingActions);

  return {
    showMoveToFolderModal,
    pendingMovePaths,
    isMovingSongs,
    requestSongDrop,
    showConfirm,
    confirmType,
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
