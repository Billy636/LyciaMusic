<template>
  <div class="flex flex-col h-full">
    <RecentHeader
      @playAll="handlePlayAll"
      @addAllToQueue="handleAddAllToQueue"
    />
    
    <div class="flex-1 flex overflow-hidden relative">

      <section class="flex-1 flex overflow-hidden">
        <RecentCollectionsGrid v-if="recentTab !== 'songs'" />
        <SongTable
          v-else
          ref="songTableRef"
          :songs="localSongList"
          :songPaths="localSongPaths"
          :isBatchMode="false"
          :selectedPaths="selectedPaths"
          memoryScopeKey="recent-view"
          @play="handlePlaySong"
          @contextmenu="handleContextMenu"
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
      title="删除记录" 
      :content="confirmMessage" 
      type="danger" 
      confirm-text="删除" 
      @confirm="executeConfirmAction" 
      @cancel="showConfirm = false" 
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { Song } from '../types';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';

// 组件导入
import RecentHeader from '../components/headers/RecentHeader.vue';
import RecentCollectionsGrid from '../components/common/RecentCollectionsGrid.vue';
import SongTable from '../components/song-list/SongTable.vue';
import DragGhost from '../components/common/DragGhost.vue';
import SongContextMenu from '../components/overlays/SongContextMenu.vue';
import ModernModal from '../components/common/ModernModal.vue';
import { useSongDrag } from '../composables/useSongDrag';
import { useLibrarySongResolver } from '../composables/useLibrarySongResolver';
import { useNavigationStore } from '../shared/stores/navigation';

const { currentViewSongPaths, displaySongList, searchQuery } = usePlayerLibraryView();
const navigationStore = useNavigationStore();
const { recentTab } = storeToRefs(navigationStore);
const { currentSong, playSong, addSongPathsToQueue } = usePlaybackController();
const { loadSong } = useLibrarySongResolver();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();

// 当前正在播放的歌必须出现在第一首：列表顺序可能来自旧的持久化数据，
// 这里在展示层再做一次兜底，保证「最近播放-单曲」的第一行永远是正在播放的歌。
// 路径比较放宽大小写 / 斜杠 / \\?\ 前缀，避免因为写法差异认不出同一首。
const pathKey = (path: string | null | undefined) => String(path ?? '')
  .replace(/^\\\\\?\\/, '')
  .replace(/\\/g, '/')
  .toLowerCase();
const localSongList = computed(() => {
  const list = displaySongList.value;
  const playingPath = currentSong.value?.path;
  if (!playingPath) return list;
  const playingKey = pathKey(playingPath);
  const index = list.findIndex(song => pathKey(song.path) === playingKey);
  if (index <= 0) return list;
  const reordered = list.slice();
  const [playing] = reordered.splice(index, 1);
  reordered.unshift(playing);
  return reordered;
});
// 路径列表跟随同一顺序，避免选择、批量与拖拽按旧索引取到别的歌。
const localSongPaths = computed(() => {
  const paths = currentViewSongPaths.value;
  const playingPath = currentSong.value?.path;
  if (!playingPath) return paths;
  const playingKey = pathKey(playingPath);
  // 列表里没解析出这首歌时保持原顺序，避免 songs 与 songPaths 索引错位。
  if (pathKey(localSongList.value[0]?.path) !== playingKey) return paths;
  const index = paths.findIndex(path => pathKey(path) === playingKey);
  if (index <= 0) return paths;
  const reordered = paths.slice();
  reordered.unshift(...reordered.splice(index, 1));
  return reordered;
});

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

// ========== 业务逻辑处理 ==========

// 播放全部
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


const executeConfirmAction = async () => {
  await confirmAction.value();
  showConfirm.value = false;
};


const openAddToPlaylistSelection = () => {
  const songPaths = contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : [];
  openAddToPlaylistDialog(songPaths);
};

// 右键菜单
const handleContextMenu = (e: MouseEvent, song: Song) => {
  contextMenuTargetSong.value = song;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

// ========== 路由监听 ==========
</script>
