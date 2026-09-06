<template>
  <div class="flex flex-col h-full">
    <FavoritesHeader
      v-model:isBatchMode="isBatchMode"
      :selectedCount="selectedPaths.size"
      @playAll="handlePlayAll"
      @batchPlay="handleBatchPlay"
      @addToPlaylist="openAddToPlaylistSelection"
      @batchDelete="requestBatchDelete"
      @clearAll="handleClearAll"
      @addAllToQueue="handleAddAllToQueue"
    />
    
    <div class="flex-1 flex overflow-hidden relative">
      
      <section class="flex-1 flex overflow-hidden">
        <SongTable
          ref="songTableRef"
          :songs="localSongList"
          :songPaths="localSongPaths"
          :isBatchMode="isBatchMode"
          :selectedPaths="selectedPaths"
          memoryScopeKey="favorites-view"
          @play="handlePlaySong"
          @contextmenu="handleContextMenu"
          @update:selectedPaths="selectedPaths = $event"
          @drag-start="handleTableDragStart"
        />
      </section>
    </div>
    
    <!-- 弹窗组件 -->
    <DragGhost />
    
    <SongContextMenu 
      :visible="showContextMenu" 
      :x="contextMenuX" 
      :y="contextMenuY" 
      :song="contextMenuTargetSong" 
      :is-playlist-view="false" 
      @close="showContextMenu = false" 
      @add-to-playlist="openAddToPlaylistSelection"
    />
    
    <ModernModal 
      :visible="showConfirm" 
      title="移除歌曲" 
      :content="confirmMessage" 
      type="danger" 
      confirm-text="移除" 
      @confirm="executeConfirmAction" 
      @cancel="showConfirm = false" 
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Song } from '../types';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';

// 组件导入
import FavoritesHeader from '../components/headers/FavoritesHeader.vue';
import SongTable from '../components/song-list/SongTable.vue';
import DragGhost from '../components/common/DragGhost.vue';
import SongContextMenu from '../components/overlays/SongContextMenu.vue';
import ModernModal from '../components/common/ModernModal.vue';
import { useSongDrag } from '../composables/useSongDrag';
import { useLibrarySongResolver } from '../composables/useLibrarySongResolver';

const { currentViewSongPaths, displaySongList, searchQuery } = usePlayerLibraryView();
const { playSong, addSongPathsToQueue } = usePlaybackController();
const { loadSong } = useLibrarySongResolver();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const {
  favoritePaths,
  clearFavorites,
} = useLibraryCollections();

const localSongList = computed(() => displaySongList.value);
const localSongPaths = computed(() => currentViewSongPaths.value);

// ========== 状态管理 ==========
const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());
const songTableRef = ref<any>(null);

// 初始化拖拽逻辑
const { handleTableDragStart } = useSongDrag(localSongList, isBatchMode, selectedPaths, songTableRef, localSongPaths);

// 弹窗状态
const showConfirm = ref(false);
const confirmMessage = ref('');
const confirmAction = ref<() => void>(() => {});
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetSong = ref<Song | null>(null);

// 监听批量模式变化，清空选择
watch(isBatchMode, (val) => { if (!val) selectedPaths.value.clear(); });



// ========== 业务逻辑处理 ==========

const handlePlayAll = async () => {
  const song = await loadSong(localSongPaths.value[0] ?? '');
  if (song) {
    await playSong(song);
  }
};

const handlePlaySong = (song: Song) => {
  const shouldInsertAfterCurrent = searchQuery.value.trim().length > 0;
  void playSong(song, shouldInsertAfterCurrent ? { insertAfterCurrent: true } : undefined);
};

const handleAddAllToQueue = () => {
  addSongPathsToQueue(localSongPaths.value);
};

// 批量播放
const handleBatchPlay = async () => {
  const firstSelectedPath = localSongPaths.value.find(path => selectedPaths.value.has(path));
  const song = await loadSong(firstSelectedPath ?? '');
  if (song) {
    await playSong(song);
  }
};

// 批量删除（从收藏移除）
const executeBatchDelete = () => {
  const newPathSet = new Set(selectedPaths.value);
  favoritePaths.value = favoritePaths.value.filter(p => !newPathSet.has(p));
  selectedPaths.value.clear();
  showConfirm.value = false;
};

const requestBatchDelete = () => {
  if (selectedPaths.value.size === 0) return;
  confirmMessage.value = `确定要从收藏中移除选中的 ${selectedPaths.value.size} 首歌曲吗？`;
  confirmAction.value = executeBatchDelete;
  showConfirm.value = true;
};

const executeConfirmAction = async () => {
  await confirmAction.value();
  showConfirm.value = false;
};

// 清空收藏
const handleClearAll = () => {
  confirmMessage.value = "确定要清空收藏列表吗？";
  confirmAction.value = clearFavorites;
  showConfirm.value = true;
};

const openAddToPlaylistSelection = () => {
  const songPaths = isBatchMode.value
    ? Array.from(selectedPaths.value)
    : (contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : []);
  openAddToPlaylistDialog(songPaths);
};

// 右键菜单
const handleContextMenu = (e: MouseEvent, song: Song) => {
  if (isBatchMode.value) return; 
  contextMenuTargetSong.value = song;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};



// ========== 路由监听 ==========
</script>
