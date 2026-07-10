<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ModernInputModal from '../common/ModernInputModal.vue';
import ModernModal from '../common/ModernModal.vue';
import PlaylistContextMenu from '../overlays/PlaylistContextMenu.vue';
import { useCoverCache } from '../../composables/useCoverCache';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { usePlayerLibraryView } from '../../features/library/usePlayerLibraryView';
import { dragSession } from '../../composables/dragState';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useSettings } from '../../features/settings/useSettings';
import { useSidebarPlaylistContextMenu } from '../../composables/useSidebarPlaylistContextMenu';
import { useSidebarPlaylistCovers } from '../../composables/useSidebarPlaylistCovers';
import { useSidebarPlaylistDragDrop } from '../../composables/useSidebarPlaylistDragDrop';
import { useSidebarPlaylistSelection } from '../../composables/useSidebarPlaylistSelection';
import SidebarBrand from './SidebarBrand.vue';
import SidebarNavigation from './SidebarNavigation.vue';
import SidebarPlaylists from './SidebarPlaylists.vue';

const { artistList, albumList } = usePlayerLibraryView();
const { playSong, addSongsToQueue, clearQueue } = usePlaybackController();
const { settings } = useSettings();

const {
  currentViewMode,
  filterCondition,
  currentFolderFilter,
} = usePlayerViewState();

const {
  playlists,
  createPlaylist,
  deletePlaylist,
  reorderPlaylists,
  getSongsFromPlaylist,
} = useLibraryCollections();

const route = useRoute();
const router = useRouter();
const {
  openHomeAll,
  openHomeFolder,
  openHomePlaylist,
  openHomeStatistics,
  openArtists,
  openAlbums,
  openFavorites,
  openRecent,
} = useHomeNavigation(router);
const { preloadCovers, loadCover } = useCoverCache();

const isPlaylistOpen = ref(true);
const showCreateModal = ref(false);

const SIDEBAR_MIN_WIDTH = 192;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_KEYBOARD_STEP = 16;
const sidebarWidth = ref(SIDEBAR_MIN_WIDTH);
const isResizing = ref(false);
let resizeStartX = 0;
let resizeStartWidth = SIDEBAR_MIN_WIDTH;

const clampSidebarWidth = (width: number) =>
  Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));

const handleSidebarResize = (event: PointerEvent) => {
  if (!isResizing.value) {
    return;
  }

  sidebarWidth.value = clampSidebarWidth(
    resizeStartWidth + event.clientX - resizeStartX,
  );
};

const stopSidebarResize = () => {
  if (!isResizing.value) {
    return;
  }

  isResizing.value = false;
  window.removeEventListener('pointermove', handleSidebarResize);
  window.removeEventListener('pointerup', stopSidebarResize);
  window.removeEventListener('pointercancel', stopSidebarResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
};

const startSidebarResize = (event: PointerEvent) => {
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }

  event.preventDefault();
  isResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartWidth = sidebarWidth.value;
  window.addEventListener('pointermove', handleSidebarResize);
  window.addEventListener('pointerup', stopSidebarResize);
  window.addEventListener('pointercancel', stopSidebarResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
};

const resizeSidebarBy = (delta: number) => {
  sidebarWidth.value = clampSidebarWidth(sidebarWidth.value + delta);
};

onBeforeUnmount(stopSidebarResize);

const handleHoverArtists = () => {
  if (artistList.value.length > 0) {
    preloadCovers(artistList.value.slice(0, 30).map(artist => artist.firstSongPath).filter(Boolean));
  }
};

const handleHoverAlbums = () => {
  if (albumList.value.length > 0) {
    preloadCovers(albumList.value.slice(0, 30).map(album => album.firstSongPath).filter(Boolean));
  }
};

const {
  selectedPlaylistIds,
  ensurePlaylistSelected,
  handlePlaylistClick,
  handleBackgroundClick,
} = useSidebarPlaylistSelection({
  playlists,
  currentViewMode,
  filterCondition,
  openHomePlaylist,
});

const clearPlaylistSelection = () => {
  selectedPlaylistIds.value.clear();
};

const {
  showContextMenu,
  contextMenuX,
  contextMenuY,
  targetPlaylist,
  showDeleteModal,
  deleteModalContent,
  handleDeletePlaylist,
  confirmDeletePlaylist,
  handlePlaylistContextMenu,
  handleMenuPlay,
  handleMenuAddToQueue,
  handleMenuDelete,
} = useSidebarPlaylistContextMenu({
  selectedPlaylistIds,
  ensurePlaylistSelected,
  getSongsFromPlaylist,
  addSongsToQueue,
  clearQueue,
  playSong,
  openHomePlaylist,
  deletePlaylist,
  clearSelection: clearPlaylistSelection,
});

const {
  dragOverId,
  dragPosition,
  handlePointerDown,
  handleItemPointerMove,
} = useSidebarPlaylistDragDrop({
  playlists,
  dragSession,
  reorderPlaylists,
});

const { playlistCoverCacheVersion, getPlaylistCover } = useSidebarPlaylistCovers({
  playlists,
  loadCover,
});

const handleCreatePlaylist = () => {
  showCreateModal.value = true;
};

const confirmCreatePlaylist = (name: string) => {
  if (name) {
    createPlaylist(name);
  }
};

const handleOpenAllView = () => {
  void openHomeAll();
};

const handleOpenArtistsView = () => {
  void openArtists();
};

const handleOpenAlbumsView = () => {
  void openAlbums();
};

const handleOpenFavoritesView = () => {
  void openFavorites();
};

const handleOpenRecentView = () => {
  void openRecent();
};

const handleOpenFolderView = () => {
  void openHomeFolder(currentFolderFilter.value || undefined);
};

const handleOpenStatisticsView = () => {
  void openHomeStatistics();
};
</script>

<template>
  <aside
    class="bg-transparent flex shrink-0 flex-col border-r border-transparent h-full select-none overflow-hidden relative transition-colors duration-600"
    :style="{ width: `${sidebarWidth}px` }"
  >
    <div
      class="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize touch-none transition-colors hover:bg-[#EC4141]"
      :class="{ 'bg-[#EC4141]': isResizing }"
      role="separator"
      aria-label="调整首页侧边栏宽度"
      aria-orientation="vertical"
      :aria-valuemin="SIDEBAR_MIN_WIDTH"
      :aria-valuemax="SIDEBAR_MAX_WIDTH"
      :aria-valuenow="sidebarWidth"
      tabindex="0"
      @pointerdown="startSidebarResize"
      @keydown.left.prevent="resizeSidebarBy(-SIDEBAR_KEYBOARD_STEP)"
      @keydown.right.prevent="resizeSidebarBy(SIDEBAR_KEYBOARD_STEP)"
    ></div>

    <SidebarBrand />

    <nav class="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4" @click="handleBackgroundClick">
      <SidebarNavigation
        :sidebar="settings.sidebar"
        :currentViewMode="currentViewMode"
        :currentPath="route.path"
        :isDragActive="dragSession.active"
        @openAll="handleOpenAllView"
        @openArtists="handleOpenArtistsView"
        @openAlbums="handleOpenAlbumsView"
        @openFavorites="handleOpenFavoritesView"
        @openRecent="handleOpenRecentView"
        @openFolder="handleOpenFolderView"
        @openStatistics="handleOpenStatisticsView"
        @hoverArtists="handleHoverArtists"
        @hoverAlbums="handleHoverAlbums"
      />

      <SidebarPlaylists
        v-model:isOpen="isPlaylistOpen"
        :playlists="playlists"
        :selectedPlaylistIds="selectedPlaylistIds"
        :playlistCoverCacheVersion="playlistCoverCacheVersion"
        :getPlaylistCover="getPlaylistCover"
        :dragState="dragSession"
        :dragOverId="dragOverId"
        :dragPosition="dragPosition"
        @createPlaylist="handleCreatePlaylist"
        @pointerDown="handlePointerDown"
        @itemPointerMove="handleItemPointerMove"
        @playlistClick="handlePlaylistClick"
        @playlistContextMenu="handlePlaylistContextMenu"
        @deletePlaylist="handleDeletePlaylist"
      />
    </nav>

    <PlaylistContextMenu
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :playlist-name="targetPlaylist?.name || ''"
      :selected-count="selectedPlaylistIds.size"
      @close="showContextMenu = false"
      @cancel="showContextMenu = false"
      @play="handleMenuPlay"
      @add-to-queue="handleMenuAddToQueue"
      @delete="handleMenuDelete"
    />

    <ModernModal
      v-model:visible="showDeleteModal"
      title="删除播放列表"
      :content="deleteModalContent"
      type="danger"
      confirm-text="删除"
      @confirm="confirmDeletePlaylist"
    />

    <ModernInputModal
      v-model:visible="showCreateModal"
      title="新建播放列表"
      placeholder="请输入播放列表名称"
      confirm-text="创建"
      @confirm="confirmCreatePlaylist"
    />
  </aside>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}
</style>
