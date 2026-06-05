<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue';

import { usePlayer } from '../../composables/player';
import { useToast } from '../../composables/toast';
import { dragSession } from '../../composables/dragState';
import { useLibraryFolderSongPathCache } from '../../composables/useLibraryFolderSongPathCache';
import { useListScrollMemory } from '../../composables/useListScrollMemory';
import type { FolderNode, Song } from '../../types';
import FolderTreeItem from '../common/FolderTreeItem.vue';
import ModernInputModal from '../common/ModernInputModal.vue';
import ModernModal from '../common/ModernModal.vue';
import FolderContextMenu from '../overlays/FolderContextMenu.vue';
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog';

const props = withDefaults(defineProps<{
  isManagementMode?: boolean;
}>(), {
  isManagementMode: false,
});

const {
  folderTree,
  activeRootPath,
  currentFolderFilter,
  currentViewMode,
  searchQuery,
  folderSortMode,
  folderCustomOrder,
  songLookup,
  fetchFolderTree,
  toggleFolderNode,
  expandFolderPath,
  refreshFolder,
  refreshAllFolders,
  removeLibraryFolder,
  deleteFolder,
  moveFilesToFolder,
  getSongsInFolder,
  playSong,
  addSongsToQueue,
  openInFinder,
  createPlaylist,
  createFolder,
} = usePlayer();

const toast = useToast();
const { loadFolderViewSongPaths } = useLibraryFolderSongPathCache();

const sidebarWidth = ref(240);
const isResizing = ref(false);
const treeContainerRef = ref<HTMLElement | null>(null);
let resizeStartX = 0;
let resizeStartWidth = 0;

const showMenu = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const targetFolder = ref<{ name: string; path: string } | null>(null);

const showCreateFolderModal = ref(false);
const createFolderParentPath = ref('');

const showPhysicalDeleteConfirm = ref(false);
const folderToPhysicalDelete = ref<string | null>(null);

const showMoveConfirm = ref(false);
const dragPendingFiles = ref<string[]>([]);
const moveTarget = ref<{ name: string; path: string } | null>(null);
let skipNextSelectionExpand = false;

const activeTreeNodes = computed(() => {
  if (!activeRootPath.value) {
    return [];
  }

  const rootNode = folderTree.value.find(node => node.path === activeRootPath.value);
  return rootNode?.children ?? [];
});

const isTargetFolderRoot = computed(() => {
  if (!targetFolder.value) {
    return false;
  }

  return folderTree.value.some(
    node => normalizePath(node.path) === normalizePath(targetFolder.value?.path ?? ''),
  );
});

const treeScrollMemoryKey = computed(() =>
  ['master-panel-tree', activeRootPath.value || ''].join('::'),
);

const {
  restoreScrollPosition: restoreTreeScrollPosition,
} = useListScrollMemory(treeScrollMemoryKey, treeContainerRef);

watch(
  folderTree,
  async newTree => {
    if (newTree.length === 0) {
      activeRootPath.value = null;
      return;
    }

    if (!activeRootPath.value || !newTree.find(node => node.path === activeRootPath.value)) {
      activeRootPath.value = newTree[0].path;
    }

    const selectedRoot = newTree.find(node => node.path === activeRootPath.value);
    if (selectedRoot && selectedRoot.children.length === 0 && selectedRoot.song_count > 0) {
      currentFolderFilter.value = selectedRoot.path;
      try {
        await refreshFolder(selectedRoot.path);
      } catch (error) {
        console.error('Failed to auto-load root folder songs:', error);
      }
    }
  },
  { immediate: true },
);

watch(currentFolderFilter, async newPath => {
  if (!newPath) {
    return;
  }

  if (skipNextSelectionExpand) {
    skipNextSelectionExpand = false;
    return;
  }

  try {
    await expandFolderPath(newPath);
  } catch (error) {
    console.error('Failed to expand folder path:', error);
  }
});

const normalizePath = (path: string | null) => (path || '').replace(/\\/g, '/').replace(/\/+$/, '');

const restoreFolderViewState = async () => {
  if (folderTree.value.length === 0) {
    await fetchFolderTree();
  }

  const restorePath = currentFolderFilter.value || activeRootPath.value || '';
  if (!restorePath) {
    return;
  }

  try {
    await expandFolderPath(restorePath);
    await nextTick();
    await restoreTreeScrollPosition();
    await nextTick();

    const selectedElement = Array.from(
      treeContainerRef.value?.querySelectorAll<HTMLElement>('[data-folder-path]') ?? [],
    ).find(element => element.dataset.folderPath === currentFolderFilter.value);

    selectedElement?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    });
  } catch (error) {
    console.error('Failed to restore folder tree state:', error);
  }
};

const handleTreeSelect = (node: FolderNode) => {
  skipNextSelectionExpand = true;
  currentFolderFilter.value = node.path;
};

const handleTreeToggle = async (node: FolderNode) => {
  await toggleFolderNode(node.path);
};

const handleTreeContextMenu = ({ event, node }: { event: MouseEvent; node: FolderNode }) => {
  skipNextSelectionExpand = true;
  currentFolderFilter.value = node.path;
  targetFolder.value = { name: node.name, path: node.path };
  menuX.value = event.clientX;
  menuY.value = event.clientY;
  showMenu.value = true;
};

const handleMenuCancel = () => {
  showMenu.value = false;
};

const handleRefreshFolder = async () => {
  if (!targetFolder.value) {
    return;
  }

  try {
    const summary = await refreshAllFolders();
    if (summary && typeof summary === 'object' && 'removedCount' in summary) {
      const removedCount = Number(summary.removedCount) || 0;
      toast.showToast(
        removedCount > 0
          ? `刷新成功，检测到少了 ${removedCount} 首歌曲`
          : '刷新成功',
        'success',
      );
    } else {
      toast.showToast('刷新成功', 'success');
    }
  } catch (error) {
    toast.showToast(`刷新失败: ${error}`, 'error');
  } finally {
    showMenu.value = false;
  }
};

const normalizeSearchText = (value: string) => value.trim().toLowerCase();

const songMatchesFolderSearch = (path: string, query: string) => {
  const song = songLookup.value.get(path);
  if (!song) {
    return false;
  }

  const loweredQuery = normalizeSearchText(query);
  if (!loweredQuery) {
    return true;
  }

  return song.name.toLowerCase().includes(loweredQuery)
    || (song.title || '').toLowerCase().includes(loweredQuery)
    || song.artist.toLowerCase().includes(loweredQuery)
    || song.album.toLowerCase().includes(loweredQuery)
    || path.toLowerCase().includes(loweredQuery)
    || song.artist_names.some(name => name.toLowerCase().includes(loweredQuery))
    || song.effective_artist_names.some(name => name.toLowerCase().includes(loweredQuery));
};

const resolveFolderMenuSongs = async (folderPath: string) => {
  if (!folderPath) {
    return [];
  }

  if (currentViewMode.value !== 'folder') {
    return getSongsInFolder(folderPath);
  }

  if (folderSortMode.value !== 'custom') {
    const sortedPaths = await loadFolderViewSongPaths({
      folderPath,
      query: searchQuery.value,
      sortMode: folderSortMode.value,
    });

    return sortedPaths
      .map(path => songLookup.value.get(path))
      .filter((song): song is Song => !!song);
  }

  let songs = getSongsInFolder(folderPath);

  if (searchQuery.value.trim()) {
    songs = songs.filter(song => songMatchesFolderSearch(song.path, searchQuery.value));
  }

  const customOrder = folderCustomOrder.value[folderPath] || [];
  if (customOrder.length > 0) {
    const orderMap = new Map(customOrder.map((path, index) => [path, index]));
    songs = [...songs].sort((left, right) => {
      const leftIndex = orderMap.has(left.path) ? orderMap.get(left.path)! : Number.MAX_SAFE_INTEGER;
      const rightIndex = orderMap.has(right.path) ? orderMap.get(right.path)! : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
  }

  return songs;
};

const playFolder = async () => {
  if (!targetFolder.value) {
    return;
  }

  const songs = await resolveFolderMenuSongs(targetFolder.value.path);
  if (songs.length > 0) {
    await playSong(songs[0]);
    currentFolderFilter.value = targetFolder.value.path;
  }

  showMenu.value = false;
};

const addToQueue = async () => {
  if (!targetFolder.value) {
    return;
  }

  addSongsToQueue(await resolveFolderMenuSongs(targetFolder.value.path));
  showMenu.value = false;
};

const createPlaylistFromFolder = async () => {
  if (!targetFolder.value) {
    return;
  }

  const songs = await resolveFolderMenuSongs(targetFolder.value.path);
  if (songs.length > 0) {
    createPlaylist(targetFolder.value.name, songs.map(song => song.path));
    toast.showToast('Playlist created from folder', 'success');
  } else {
    toast.showToast('No songs found in folder', 'info');
  }

  showMenu.value = false;
};

const addFolderToPlaylist = async () => {
  if (!targetFolder.value) {
    return;
  }

  const songs = await resolveFolderMenuSongs(targetFolder.value.path);
  if (songs.length > 0) {
    const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
    openAddToPlaylistDialog(songs.map(song => song.path));
  } else {
    toast.showToast('No songs found in folder', 'info');
  }

  showMenu.value = false;
};

const openFolder = () => {
  if (!targetFolder.value) {
    return;
  }

  openInFinder(targetFolder.value.path);
  showMenu.value = false;
};

const removeFolderItem = async () => {
  if (!targetFolder.value) {
    return;
  }

  const targetPath = targetFolder.value.path;
  const isRoot = folderTree.value.some(node => normalizePath(node.path) === normalizePath(targetPath));
  if (!isRoot) {
    toast.showToast('Only library root folders can be removed from the library list', 'info');
    showMenu.value = false;
    return;
  }

  try {
    await removeLibraryFolder(targetPath);
    showMenu.value = false;
  } catch (error) {
    toast.showToast(`Remove failed: ${error}`, 'error');
  }
};

const handleCreateFolder = () => {
  if (!props.isManagementMode || !targetFolder.value) {
    return;
  }

  createFolderParentPath.value = targetFolder.value.path;
  showCreateFolderModal.value = true;
  showMenu.value = false;
};

const executeCreateFolder = async (folderName: string) => {
  if (!createFolderParentPath.value) {
    return;
  }

  try {
    const newFolderPath = await createFolder(createFolderParentPath.value, folderName);
    await fetchFolderTree();
    await expandFolderPath(newFolderPath);
    currentFolderFilter.value = newFolderPath;
    toast.showToast(`Created folder: ${folderName}`, 'success');
  } catch (error) {
    toast.showToast(`Failed to create folder: ${error}`, 'error');
  } finally {
    showCreateFolderModal.value = false;
    createFolderParentPath.value = '';
  }
};

const handlePhysicalDelete = () => {
  if (!props.isManagementMode || !targetFolder.value) {
    return;
  }

  folderToPhysicalDelete.value = targetFolder.value.path;
  showPhysicalDeleteConfirm.value = true;
  showMenu.value = false;
};

const executePhysicalDelete = async () => {
  if (!folderToPhysicalDelete.value) {
    return;
  }

  try {
    const deletedPath = folderToPhysicalDelete.value;
    const rootPath = activeRootPath.value || '';
    const shouldResetSelection =
      normalizePath(currentFolderFilter.value) === normalizePath(deletedPath) ||
      normalizePath(currentFolderFilter.value).startsWith(`${normalizePath(deletedPath)}/`);
    const fallbackPath = shouldResetSelection
      ? (() => {
          const parentPath = deletedPath.replace(/[\\/][^\\/]+$/, '');
          const normalizedRoot = normalizePath(rootPath);
          const normalizedParent = normalizePath(parentPath);
          return normalizedRoot && normalizedParent.startsWith(normalizedRoot)
            ? parentPath
            : rootPath;
        })()
      : currentFolderFilter.value;

    await deleteFolder(deletedPath);
    await fetchFolderTree();

    if (fallbackPath) {
      await expandFolderPath(fallbackPath);
      currentFolderFilter.value = fallbackPath;
    }

    toast.showToast('Folder deleted permanently', 'success');
  } catch (error) {
    toast.showToast(`Delete failed: ${error}`, 'error');
  } finally {
    showPhysicalDeleteConfirm.value = false;
    folderToPhysicalDelete.value = null;
  }
};

const handleDropEvent = () => {
  if (!props.isManagementMode) {
    return;
  }

  if (!dragSession.targetFolder || dragSession.targetFolder.path === currentFolderFilter.value) {
    return;
  }

  const songsToMove = dragSession.songs && dragSession.songs.length > 0
    ? dragSession.songs
    : (dragSession.data ? [dragSession.data] : []);

  if (songsToMove.length === 0) {
    return;
  }

  dragPendingFiles.value = songsToMove.map(song => song.path);
  moveTarget.value = { ...dragSession.targetFolder };
  showMoveConfirm.value = true;
};

const resetMoveState = () => {
  dragPendingFiles.value = [];
  showMoveConfirm.value = false;
  moveTarget.value = null;
  dragSession.showGhost = false;
  dragSession.active = false;
  dragSession.targetFolder = null;
  dragSession.songs = [];
};

const executeMove = async () => {
  if (!moveTarget.value || dragPendingFiles.value.length === 0) {
    resetMoveState();
    return;
  }

  try {
    await moveFilesToFolder(dragPendingFiles.value, moveTarget.value.path);
    toast.showToast('Files moved successfully', 'success');
  } catch (error) {
    toast.showToast(`Move failed: ${error}`, 'error');
  } finally {
    resetMoveState();
  }
};

const cancelMove = () => {
  resetMoveState();
};

const startResize = (event: MouseEvent) => {
  isResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartWidth = sidebarWidth.value;
  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
};

const handleResize = (event: MouseEvent) => {
  if (!isResizing.value) {
    return;
  }

  const delta = event.clientX - resizeStartX;
  sidebarWidth.value = Math.max(150, Math.min(500, resizeStartWidth + delta));
};

const stopResize = () => {
  isResizing.value = false;
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
};

onMounted(async () => {
  window.addEventListener('custom-drop-trigger', handleDropEvent);
  await restoreFolderViewState();
});

onActivated(async () => {
  await restoreFolderViewState();
});

onUnmounted(() => {
  window.removeEventListener('custom-drop-trigger', handleDropEvent);
  stopResize();
});
</script>

<template>
  <aside
    class="h-full border-r border-white/10 bg-transparent shrink-0 select-none relative group/sidebar"
    :style="{ width: `${sidebarWidth}px` }"
  >
    <div
      class="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-[#EC4141] transition-colors z-10"
      :class="{ 'bg-[#EC4141]': isResizing }"
      @mousedown="startResize"
    ></div>

    <div class="h-full overflow-y-auto custom-scrollbar">
      <div class="flex flex-col h-full bg-transparent">
        <div ref="treeContainerRef" class="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4 space-y-0.5 mt-1">
          <div v-if="activeTreeNodes.length > 0">
            <FolderTreeItem
              v-for="node in activeTreeNodes"
              :key="node.path"
              :node="node"
              :depth="0"
              :selectedPath="currentFolderFilter"
              @select="handleTreeSelect"
              @toggle="handleTreeToggle"
              @contextmenu="handleTreeContextMenu"
            />
          </div>

          <div
            v-else-if="activeRootPath"
            class="flex flex-col items-center justify-center py-10 text-gray-400 dark:text-gray-500 space-y-2 text-center px-4"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span class="text-xs leading-relaxed">当前根目录下没有子文件夹。</span>
          </div>

          <div
            v-if="folderTree.length === 0"
            class="flex flex-col items-center justify-center py-10 text-gray-400 dark:text-gray-500 space-y-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 00-2-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" /></svg>
            <span class="text-xs">还没有添加音乐库文件夹。</span>
          </div>
        </div>
      </div>
    </div>

    <FolderContextMenu
      :visible="showMenu"
      :x="menuX"
      :y="menuY"
      :folder-path="targetFolder?.path || ''"
      :selected-count="1"
      :isManagementMode="isManagementMode"
      :is-root-folder="isTargetFolderRoot"
      @close="showMenu = false"
      @cancel="handleMenuCancel"
      @play="playFolder"
      @add-to-queue="addToQueue"
      @create-playlist="createPlaylistFromFolder"
      @add-to-playlist="addFolderToPlaylist"
      @open-folder="openFolder"
      @refresh="handleRefreshFolder"
      @remove="removeFolderItem"
      @new-folder="handleCreateFolder"
      @delete-disk="handlePhysicalDelete"
    />

    <ModernModal
      v-model:visible="showMoveConfirm"
      title="Move Files"
      :content="`Move ${dragPendingFiles.length} file(s) to folder '${moveTarget?.name}'?`"
      @confirm="executeMove"
      @cancel="cancelMove"
    />

    <ModernModal
      v-model:visible="showPhysicalDeleteConfirm"
      title="永久删除文件夹"
      :content="`确定要永久删除文件夹 '${folderToPhysicalDelete}' 吗？此操作不可逆！`"
      type="danger"
      confirm-text="永久删除"
      @confirm="executePhysicalDelete"
      @cancel="showPhysicalDeleteConfirm = false"
    />

    <ModernInputModal
      :visible="showCreateFolderModal"
      title="新建文件夹"
      placeholder="请输入文件夹名称"
      confirm-text="创建"
      @cancel="showCreateFolderModal = false"
      @confirm="executeCreateFolder"
    />
  </aside>
</template>
