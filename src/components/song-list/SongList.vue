<script setup lang="ts">
import { usePlayer, Song, dragSession } from '../../composables/player';
import { computed, watch, ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
// 引用子组件
import SongTable from './SongTable.vue'; 
import SongListHeader from './SongListHeader.vue';
import SongListSidebar from './SongListSidebar.vue';
import AddToPlaylistModal from '../overlays/AddToPlaylistModal.vue';
import SongContextMenu from '../overlays/SongContextMenu.vue';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import FavoritesGrid from '../common/FavoritesGrid.vue';
import DragGhost from '../common/DragGhost.vue';
import MoveToFolderModal from '../overlays/MoveToFolderModal.vue';

const route = useRoute();
const router = useRouter();

const { 
  songList, displaySongList, currentViewMode, 
  favTab, favDetailFilter, playSong, 
  addSongsToPlaylist, favoritePaths, moveFilesToFolder,
  switchViewToAll, switchToRecent, switchToFavorites
} = usePlayer();

// 状态管理
const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());

// --- 弹窗与右键菜单状态 ---
const showAddToPlaylistModal = ref(false);
const showMoveToFolderModal = ref(false);
const showConfirm = ref(false);
const showToast = ref(false);
const toastMessage = ref('');
const confirmMessage = ref('');
const confirmAction = ref<() => void>(() => {});
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetSong = ref<Song | null>(null);

watch(isBatchMode, (val) => { if (!val) selectedPaths.value.clear(); });

// --- 业务逻辑处理 ---

const handleContextMenu = (e: MouseEvent, song: Song) => {
  if (isBatchMode.value) return; 
  contextMenuTargetSong.value = song;
  contextMenuX.value = e.clientX;
  const menuHeight = 250;
  contextMenuY.value = e.clientY + menuHeight > window.innerHeight ? e.clientY - menuHeight : e.clientY;
  showContextMenu.value = true;
};

const handleBatchPlay = () => {
  const selected = displaySongList.value.filter(s => selectedPaths.value.has(s.path));
  if (selected.length > 0) playSong(selected[0]);
};

const executeBatchDelete = () => {
  if (currentViewMode.value === 'all' && route.path === '/') {
    const newPathSet = new Set(selectedPaths.value);
    songList.value = songList.value.filter(s => !newPathSet.has(s.path));
  } else if (route.path === '/favorites') {
    const newPathSet = new Set(selectedPaths.value);
    favoritePaths.value = favoritePaths.value.filter(p => !newPathSet.has(p));
  }
  selectedPaths.value.clear();
  showConfirm.value = false;
};

const requestBatchDelete = () => {
  if (selectedPaths.value.size === 0) return;
  confirmMessage.value = `确定要移除选中的 ${selectedPaths.value.size} 首歌曲吗？`;
  confirmAction.value = executeBatchDelete;
  showConfirm.value = true;
};

const handleBatchMove = () => { if (selectedPaths.value.size > 0) showMoveToFolderModal.value = true; };
const confirmBatchMove = async (targetFolder: string, folderName: string) => {
  try {
    const paths = Array.from(selectedPaths.value);
    const count = await moveFilesToFolder(paths, targetFolder);
    toastMessage.value = `已成功移动 ${count} 首歌曲到 "${folderName}"`;
    showToast.value = true; setTimeout(() => showToast.value = false, 3000);
    showMoveToFolderModal.value = false; selectedPaths.value.clear();
  } catch (e) { alert("移动失败: " + e); }
};

const handleAddToPlaylist = (playlistId: string) => {
  const songsToAdd = isBatchMode.value ? Array.from(selectedPaths.value) : (contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : []);
  const addedCount = addSongsToPlaylist(playlistId, songsToAdd);
  showAddToPlaylistModal.value = false;
  toastMessage.value = addedCount === 0 ? "歌单内歌曲重复" : "已加入歌单";
  showToast.value = true; setTimeout(() => showToast.value = false, 2000);
};

// --- 🔥 恢复拖拽核心逻辑 (Drag Logic Restored) ---
let isMouseDown = false;
let startX = 0;
let startY = 0;
// 批量选择辅助
const lastSelectedIndex = ref<number>(-1);
const isSelectionDragging = ref(false);
const dragSelectAction = ref<'select' | 'deselect' | null>(null);

// 1. 接收子组件传来的 MouseDown
const handleTableDragStart = ({ event, song, index }: { event: MouseEvent; song: Song; index: number }) => {
  isMouseDown = true;
  startX = event.clientX;
  startY = event.clientY;

  // 批量选择逻辑
  if (isBatchMode.value) {
    const tr = event.currentTarget as HTMLElement;
    const rect = tr.getBoundingClientRect();
    if ((event.clientX - rect.left) / rect.width < 0.6) {
      isSelectionDragging.value = true;
      // 处理 Shift 连选逻辑
      if (event.shiftKey && lastSelectedIndex.value !== -1) {
        const start = Math.min(lastSelectedIndex.value, index);
        const end = Math.max(lastSelectedIndex.value, index);
        for (let i = start; i <= end; i++) {
           if (displaySongList.value[i]) selectedPaths.value.add(displaySongList.value[i].path);
        }
      } else {
        if (selectedPaths.value.has(song.path)) selectedPaths.value.delete(song.path);
        else selectedPaths.value.add(song.path);
        lastSelectedIndex.value = index;
      }
      dragSelectAction.value = selectedPaths.value.has(song.path) ? 'select' : 'deselect';
    } else {
      isSelectionDragging.value = false;
      if (!selectedPaths.value.has(song.path)) selectedPaths.value.add(song.path);
      dragSession.songs = displaySongList.value.filter(s => selectedPaths.value.has(s.path));
    }
  } else {
    // 普通模式：准备拖拽单首
    if (['folder', 'playlist', 'all'].includes(currentViewMode.value)) {
       dragSession.songs = [song];
    }
  }
};

// 2. 全局 MouseMove (检测拖拽意图 + 检测 Sidebar 目标)
const onGlobalMouseMove = (e: MouseEvent) => {
  if (!isMouseDown) return;
  if (isBatchMode.value && isSelectionDragging.value) return; 

  // 只有移动距离超过 5px 才视为拖拽，防止误触点击
  if (!dragSession.active) {
    const dist = Math.sqrt(Math.pow(e.clientX - startX, 2) + Math.pow(e.clientY - startY, 2));
    if (dist > 5) {
      dragSession.active = true;
    }
  }

  if (dragSession.active) {
    dragSession.mouseX = e.clientX;
    dragSession.mouseY = e.clientY;
    
    // 🔥 检测 Sidebar 元素
    const target = document.elementFromPoint(e.clientX, e.clientY);
    
    // A. 检测是否拖到了文件夹上
    const folderEl = target?.closest('.folder-drop-target');
    if (folderEl) {
      const path = folderEl.getAttribute('data-folder-path');
      const name = folderEl.getAttribute('data-folder-name');
      if (path && name) {
        dragSession.targetFolder = { path, name };
        dragSession.targetPlaylist = null;
        dragSession.sortLineTop = -1; 
        return; 
      }
    } else {
      dragSession.targetFolder = null;
    }

    // B. 检测是否拖到了歌单上
    const playlistEl = target?.closest('.playlist-drop-target');
    if (playlistEl) {
      const id = playlistEl.getAttribute('data-playlist-id');
      const name = playlistEl.getAttribute('data-playlist-name');
      if (id && name) {
        dragSession.targetPlaylist = { id, name };
        dragSession.targetFolder = null;
        dragSession.sortLineTop = -1;
        return;
      }
    } else {
      dragSession.targetPlaylist = null;
    }

    // C. 列表内排序检测 (如果既不是文件夹也不是歌单，且在 Table 区域)
    if (!dragSession.targetFolder && !dragSession.targetPlaylist) {
      const row = target?.closest('tr');
      if (row) {
        const rect = row.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;
        const rowIndex = parseInt(row.getAttribute('data-index') || '0');
        const rowOffsetTop = (row as HTMLElement).offsetTop; 
        const rowHeight = 60; // 固定高度

        if (relativeY < rect.height / 2) {
          dragSession.insertIndex = rowIndex;
          dragSession.sortLineTop = rowOffsetTop;
        } else {
          dragSession.insertIndex = rowIndex + 1;
          dragSession.sortLineTop = rowOffsetTop + rowHeight;
        }
      } else {
        dragSession.sortLineTop = -1;
        dragSession.insertIndex = -1;
      }
    }
  }
};

// 3. 全局 MouseUp (执行 Drop / Reorder)
const onGlobalMouseUp = () => {
  isMouseDown = false;
  isSelectionDragging.value = false;
  dragSelectAction.value = null;

  if (dragSession.active) {
    if (dragSession.targetFolder) {
      // 移动到文件夹
      showMoveToFolderModal.value = true;
      selectedPaths.value = new Set(dragSession.songs.map(s => s.path));
      
    } else if (dragSession.targetPlaylist) {
      // 添加到歌单
      const paths = dragSession.songs.map(s => s.path);
      const count = addSongsToPlaylist(dragSession.targetPlaylist.id, paths);
      toastMessage.value = count > 0 ? `已添加 ${count} 首歌曲到 ${dragSession.targetPlaylist.name}` : '歌曲已存在于歌单';
      showToast.value = true;
      setTimeout(() => showToast.value = false, 2000);

    } else if (dragSession.insertIndex > -1) {
      // 🟢 恢复列表排序逻辑
      const movingSongs = dragSession.songs;
      if (movingSongs.length > 0) {
        // 1. 获取目标插入位置的参照歌曲
        // 注意：displaySongList 可能受过滤影响，所以我们需要根据这首歌去源列表中找位置
        const targetSong = displaySongList.value[dragSession.insertIndex];
        
        // 2. 复制源列表以便修改
        const newSongList = [...songList.value];
        const movingPaths = new Set(movingSongs.map(s => s.path));

        // 3. 从列表中移除被拖拽的歌曲
        const remaining = newSongList.filter(s => !movingPaths.has(s.path));

        // 4. 插入到新位置
        if (targetSong) {
          // 找到参照歌曲在剩余列表中的索引
          const targetIndex = remaining.findIndex(s => s.path === targetSong.path);
          if (targetIndex !== -1) {
            remaining.splice(targetIndex, 0, ...movingSongs);
          } else {
            // 如果找不到（极少数情况），追加到末尾
            remaining.push(...movingSongs);
          }
        } else {
          // 如果 targetSong 为 undefined，说明拖到了列表的最末尾
          remaining.push(...movingSongs);
        }

        // 5. 更新状态
        songList.value = remaining;
      }
    }
    
    // 重置状态
    dragSession.active = false;
    dragSession.sortLineTop = -1;
    dragSession.insertIndex = -1;
    setTimeout(() => { 
      dragSession.targetFolder = null; 
      dragSession.targetPlaylist = null;
    }, 100);
  }
};

onMounted(() => {
  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('mouseup', onGlobalMouseUp);
});
onUnmounted(() => {
  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
});

const enterFavDetail = (type: 'artist' | 'album', name: string) => { router.push({ query: { type, name } }); };
const isFavorites = computed(() => route.path === '/favorites');

watch(() => route.path, (path) => {
  if (path === '/favorites') {
    switchToFavorites();
  } else if (path === '/recent') {
    switchToRecent();
  } else if (path === '/') {
    if (currentViewMode.value !== 'folder' && currentViewMode.value !== 'playlist') {
       switchViewToAll();
    }
  }
}, { immediate: true });
</script>

<template>
  <div class="flex-1 flex flex-col h-full bg-transparent relative transition-colors duration-500">
    <DragGhost /> 
    <SongListHeader 
      v-model:isBatchMode="isBatchMode" 
      @batchPlay="handleBatchPlay" 
      @openAddToPlaylist="showAddToPlaylistModal = true" 
      @batchDelete="requestBatchDelete" 
      @batchMove="handleBatchMove" 
    />

    <div class="flex-1 flex overflow-hidden relative">
      <SongListSidebar />

      <section class="flex-1 flex overflow-hidden">
        <FavoritesGrid v-if="isFavorites && !favDetailFilter && favTab !== 'songs'" @enterDetail="enterFavDetail"/>
        
        <SongTable 
          v-else
          :songs="displaySongList"
          :isBatchMode="isBatchMode"
          :selectedPaths="selectedPaths"
          @play="playSong"
          @contextmenu="handleContextMenu"
          @drag-start="handleTableDragStart" 
        />
      </section>
    </div>
    
    <AddToPlaylistModal :visible="showAddToPlaylistModal" :selectedCount="isBatchMode ? selectedPaths.size : 1" @close="showAddToPlaylistModal = false" @add="handleAddToPlaylist"/>
    <MoveToFolderModal :visible="showMoveToFolderModal" :selectedCount="selectedPaths.size" @close="showMoveToFolderModal = false" @confirm="confirmBatchMove" />
    <SongContextMenu :visible="showContextMenu" :x="contextMenuX" :y="contextMenuY" :song="contextMenuTargetSong" :is-playlist-view="currentViewMode === 'playlist'" @close="showContextMenu = false" @add-to-playlist="showAddToPlaylistModal = true" />
    <ConfirmModal :visible="showConfirm" title="my-cloud-music" :content="confirmMessage" @confirm="executeBatchDelete" @cancel="showConfirm = false" />

    <Teleport to="body">
      <div v-if="showToast" class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/70 text-white px-6 py-2 rounded-full text-sm shadow-lg z-[10000] animate-in fade-in duration-200">{{ toastMessage }}</div>
    </Teleport>
  </div>
</template>

<style scoped>
:deep(.custom-scrollbar)::-webkit-scrollbar {
  display: none;
  width: 0 !important;
  height: 0 !important;
}
:deep(.custom-scrollbar) {
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
}
</style>