import { ref, watch, type Ref } from 'vue';

import type { FolderNode } from '../types';

interface ConfirmOptions {
  title: string;
  confirmText: string;
  message: string;
  action: () => void | Promise<void>;
}

interface UseHomeFolderManagementOptions {
  isManagementMode: Ref<boolean>;
  activeRootPath: Ref<string | null>;
  currentFolderFilter: Ref<string>;
  libraryHierarchy: Ref<FolderNode[]>;
  sourceSongPaths: Ref<string[]>;
  refreshFolder: (folderPath: string) => Promise<unknown>;
  fetchFolderTree: () => Promise<unknown>;
  createFolder: (parentPath: string, folderName: string) => Promise<string>;
  deleteFolder: (path: string) => Promise<unknown>;
  expandFolderPath: (path: string) => Promise<unknown>;
  addLibraryFolder: () => Promise<unknown>;
  removeLibraryFolderLinked: (path: string) => Promise<unknown>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  openConfirm: (options: ConfirmOptions) => void;
}

export function useHomeFolderManagement({
  isManagementMode,
  activeRootPath,
  currentFolderFilter,
  libraryHierarchy,
  sourceSongPaths,
  refreshFolder,
  fetchFolderTree,
  createFolder,
  deleteFolder,
  expandFolderPath,
  addLibraryFolder,
  removeLibraryFolderLinked,
  showToast,
  openConfirm,
}: UseHomeFolderManagementOptions) {
  const showCreateFolderModal = ref(false);
  const createFolderParentPath = ref('');
  const createFolderRootPath = ref<string | null>(null);
  const showFolderDeleteConfirm = ref(false);
  const folderToDeletePath = ref('');
  const skipNextRootSync = ref(false);

  const normalizePath = (path: string | null) => (path || '').replace(/\\/g, '/').replace(/\/+$/, '');

  const getOwningRootPath = (path: string) => {
    const normalizedTarget = normalizePath(path);
    const matchedRoots = libraryHierarchy.value
      .map(node => node.path)
      .filter(root => {
        const normalizedRoot = normalizePath(root);
        return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
      })
      .sort((left, right) => normalizePath(right).length - normalizePath(left).length);

    return matchedRoots[0] || activeRootPath.value || null;
  };

  const getParentFolderPath = (path: string) => path.replace(/[\\/][^\\/]+$/, '');

  const syncRootSelection = async (path: string | null, options: { forceRefresh?: boolean } = {}) => {
    const normalizedPath = path || '';
    const shouldRefresh =
      !!normalizedPath && (
        options.forceRefresh ||
        activeRootPath.value !== normalizedPath ||
        currentFolderFilter.value !== normalizedPath
      );

    activeRootPath.value = path;
    currentFolderFilter.value = normalizedPath;

    if (!shouldRefresh) {
      return;
    }

    try {
      await refreshFolder(normalizedPath);
    } catch (error: any) {
      showToast(`切换文件夹失败: ${error?.message || error}`, 'error');
    }
  };

  const handleActiveRootChange = (path: string | null) => {
    void syncRootSelection(path, { forceRefresh: true });
  };

  watch(activeRootPath, (newPath, oldPath) => {
    if (skipNextRootSync.value) {
      skipNextRootSync.value = false;
      return;
    }

    if (!newPath || newPath === oldPath) {
      return;
    }

    void syncRootSelection(newPath);
  });

  const requestCreateFolder = (parentPath: string) => {
    if (!isManagementMode.value) {
      return;
    }

    createFolderParentPath.value = parentPath;
    createFolderRootPath.value = getOwningRootPath(parentPath);
    showCreateFolderModal.value = true;
  };

  const confirmCreateFolder = async (folderName: string) => {
    if (!createFolderParentPath.value) {
      return;
    }

    try {
      const newFolderPath = await createFolder(createFolderParentPath.value, folderName);
      await fetchFolderTree();

      if (createFolderRootPath.value) {
        skipNextRootSync.value = true;
        activeRootPath.value = createFolderRootPath.value;
      }

      await expandFolderPath(newFolderPath);
      currentFolderFilter.value = newFolderPath;
      showToast(`已创建文件夹: ${folderName}`, 'success');
    } catch (error: any) {
      showToast(`新建文件夹失败: ${error?.message || error}`, 'error');
    } finally {
      showCreateFolderModal.value = false;
      createFolderParentPath.value = '';
      createFolderRootPath.value = null;
    }
  };

  const requestDeleteFolder = (folderPath: string) => {
    if (!isManagementMode.value) {
      return;
    }

    folderToDeletePath.value = folderPath;
    showFolderDeleteConfirm.value = true;
  };

  const executeDeleteFolder = async () => {
    if (!folderToDeletePath.value) {
      return;
    }

    const deletedPath = folderToDeletePath.value;
    const owningRootPath = getOwningRootPath(deletedPath);
    const deletedRoot = owningRootPath && normalizePath(owningRootPath) === normalizePath(deletedPath);
    const fallbackPath = deletedRoot
      ? null
      : (() => {
          const parentPath = getParentFolderPath(deletedPath);
          if (!owningRootPath) {
            return parentPath || '';
          }
          const normalizedRoot = normalizePath(owningRootPath);
          const normalizedParent = normalizePath(parentPath);
          return normalizedParent.startsWith(normalizedRoot) ? parentPath : owningRootPath;
        })();

    try {
      await deleteFolder(deletedPath);
      await fetchFolderTree();

      if (deletedRoot) {
        const nextRoot = libraryHierarchy.value[0]?.path || null;
        if (nextRoot) {
          await syncRootSelection(nextRoot, { forceRefresh: true });
        } else {
          await syncRootSelection(null);
          sourceSongPaths.value = [];
        }
      } else if (fallbackPath) {
        if (owningRootPath) {
          skipNextRootSync.value = true;
          activeRootPath.value = owningRootPath;
        }
        await expandFolderPath(fallbackPath);
        currentFolderFilter.value = fallbackPath;
      }

      showToast('文件夹已删除', 'success');
    } catch (error: any) {
      showToast(`删除文件夹失败: ${error?.message || error}`, 'error');
    } finally {
      showFolderDeleteConfirm.value = false;
      folderToDeletePath.value = '';
    }
  };

  const handleAddFolder = async () => {
    await addLibraryFolder();
  };

  const handleRootCreateFolderRequest = (path: string) => {
    requestCreateFolder(path);
  };

  const handleRootDeleteFolderRequest = (path: string) => {
    requestDeleteFolder(path);
  };

  const handleRefreshFolder = async () => {
    if (!currentFolderFilter.value) {
      return;
    }

    try {
      const summary = await refreshFolder(currentFolderFilter.value);
      await fetchFolderTree();
      if (summary && typeof summary === 'object') {
        const removedCount = Number((summary as any).removedCount) || 0;
        const addedCount = Number((summary as any).addedCount) || 0;
        if (addedCount > 0 && removedCount > 0) {
          showToast(`刷新成功，新增 ${addedCount} 首，减少 ${removedCount} 首歌曲`, 'success');
        } else if (addedCount > 0) {
          showToast(`刷新成功，检测到新增 ${addedCount} 首歌曲`, 'success');
        } else if (removedCount > 0) {
          showToast(`刷新成功，检测到少了 ${removedCount} 首歌曲`, 'success');
        } else {
          showToast('刷新成功，文件夹歌曲已是最新', 'success');
        }
        return;
      }

      showToast('刷新成功', 'success');
    } catch (error: any) {
      showToast(`刷新失败: ${error?.message || error}`, 'error');
    }
  };

  const handleRemoveFolderWithConfirm = (path: string, name?: string) => {
    openConfirm({
      title: '移除文件夹',
      confirmText: '移除',
      message: name
        ? `确定要移除“${name}”吗？这不会删除本地文件。`
        : '确定要移除此文件夹吗？这不会删除本地文件。',
      action: async () => {
        const wasActive = activeRootPath.value === path;
        await removeLibraryFolderLinked(path);

        if (wasActive) {
          if (libraryHierarchy.value.length > 0) {
            await syncRootSelection(libraryHierarchy.value[0].path, { forceRefresh: true });
          } else {
            await syncRootSelection(null);
            sourceSongPaths.value = [];
          }
        }
      },
    });
  };

  return {
    showCreateFolderModal,
    showFolderDeleteConfirm,
    folderToDeletePath,
    syncRootSelection,
    handleActiveRootChange,
    requestCreateFolder,
    confirmCreateFolder,
    requestDeleteFolder,
    executeDeleteFolder,
    handleAddFolder,
    handleRootCreateFolderRequest,
    handleRootDeleteFolderRequest,
    handleRefreshFolder,
    handleRemoveFolderWithConfirm,
  };
}
