<template>
  <div class="flex flex-col h-full">
    <HomeViewPane
      :viewTransitionKey="viewTransitionKey"
      :localViewMode="localViewMode"
      :isBatchMode="isBatchMode"
      :isManagementMode="isManagementMode"
      :activeRootPath="activeRootPath || ''"
      :selectedCount="selectedPaths.size"
      :folderTree="folderTree"
      :currentFolderFilter="currentFolderFilter"
      :playlistDetail="playlistDetail"
      :localSongList="localSongList"
      :localSongPaths="localSongPaths"
      :artistActiveTab="artistActiveTab"
      :localFilterCondition="localFilterCondition"
      :selectedAlbumSong="selectedAlbumSong"
      :artistAlbumList="artistAlbumList"
      :coverCache="coverCache"
      :loadingSet="loadingSet"
      :selectedPaths="selectedPaths"
      :setSongTableRef="setSongTableRef"
      @update:isBatchMode="isBatchMode = $event"
      @update:isManagementMode="isManagementMode = $event"
      @update:artistActiveTab="artistActiveTab = $event"
      @update:selectedPaths="selectedPaths = $event"
      @playAll="handlePlayAll"
      @batchPlay="handleBatchPlay"
      @showAddToPlaylist="handleAddToPlaylistRequest"
      @batchDelete="requestBatchDelete"
      @folderBatchDelete="handleFolderBatchDelete"
      @batchMove="handleBatchMove"
      @rootCreatePlaylist="handleRootCreatePlaylistRequest"
      @addFolder="handleAddFolder"
      @refreshFolder="handleRefreshFolder"
      @removeFolder="handleRemoveFolderWithConfirm"
      @rootCreateFolder="handleRootCreateFolderRequest"
      @rootDeleteFolder="handleRootDeleteFolderRequest"
      @activeRootChange="handleActiveRootChange"
      @renamePlaylist="handleRenamePlaylist"
      @refreshAll="handleRefreshAll"
      @playSong="playSong"
      @contextMenuSong="handleContextMenu"
      @tableDragStart="handleTableDragStart"
      @artistAlbumClick="handleArtistAlbumClick"
    />

    <DragGhost />

    <MoveToFolderModal
      :visible="showMoveToFolderModal"
      :selectedCount="selectedPaths.size"
      @close="showMoveToFolderModal = false"
      @confirm="confirmBatchMove"
    />

    <SongContextMenu
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="contextMenuTargetSong"
      :is-playlist-view="localViewMode === 'playlist'"
      :is-folder-view="localViewMode === 'folder'"
      :isManagementMode="isManagementMode"
      @close="showContextMenu = false"
      @add-to-playlist="handleAddToPlaylistRequest"
      @delete-disk="handleSongPhysicalDelete"
    />

    <ModernModal
      :visible="showConfirm"
      :title="confirmTitle"
      :content="confirmMessage"
      type="danger"
      :confirm-text="confirmButtonText"
      @confirm="executeConfirmAction"
      @cancel="showConfirm = false"
    />

    <ModernModal
      v-model:visible="showSongPhysicalDeleteConfirm"
      title="永久删除文件"
      :content="`确定要从磁盘中永久删除歌曲 '${songToPhysicalDelete?.title}' 吗？此操作不可逆！`"
      type="danger"
      confirm-text="永久删除"
      @confirm="executeSongPhysicalDelete"
    />

    <ModernModal
      v-model:visible="showFolderDeleteConfirm"
      title="删除文件夹"
      :content="`确定要删除文件夹 '${folderToDeletePath}' 吗？这也将移除其中的本地文件。`"
      type="danger"
      confirm-text="删除文件夹"
      @confirm="executeDeleteFolder"
    />

    <ModernInputModal
      :visible="showCreateFolderModal"
      title="新建文件夹"
      placeholder="请输入文件夹名称"
      confirm-text="创建"
      @cancel="showCreateFolderModal = false"
      @confirm="confirmCreateFolder"
    />

    <ModernInputModal
      :visible="showRenameModal"
      title="重命名播放列表"
      :initial-value="renameInitialValue"
      @cancel="showRenameModal = false"
      @confirm="confirmRename"
    />
  </div>
</template>

<script setup lang="ts">
import DragGhost from '../components/common/DragGhost.vue';
import HomeViewPane from '../components/home/HomeViewPane.vue';
import ModernInputModal from '../components/common/ModernInputModal.vue';
import ModernModal from '../components/common/ModernModal.vue';
import MoveToFolderModal from '../components/overlays/MoveToFolderModal.vue';
import SongContextMenu from '../components/overlays/SongContextMenu.vue';
import { useHomePageModel } from '../composables/useHomePageModel';

const {
  viewTransitionKey,
  localViewMode,
  isBatchMode,
  isManagementMode,
  activeRootPath,
  selectedPaths,
  folderTree,
  currentFolderFilter,
  playlistDetail,
  localSongList,
  localSongPaths,
  artistActiveTab,
  localFilterCondition,
  selectedAlbumSong,
  artistAlbumList,
  coverCache,
  loadingSet,
  setSongTableRef,
  handlePlayAll,
  handleBatchPlay,
  handleAddToPlaylistRequest,
  requestBatchDelete,
  handleFolderBatchDelete,
  handleBatchMove,
  handleRootCreatePlaylistRequest,
  handleAddFolder,
  handleRefreshFolder,
  handleRemoveFolderWithConfirm,
  handleRootCreateFolderRequest,
  handleRootDeleteFolderRequest,
  handleActiveRootChange,
  handleRenamePlaylist,
  handleRefreshAll,
  playSong,
  handleContextMenu,
  handleTableDragStart,
  handleArtistAlbumClick,
  showMoveToFolderModal,
  confirmBatchMove,
  showContextMenu,
  contextMenuX,
  contextMenuY,
  contextMenuTargetSong,
  showConfirm,
  confirmTitle,
  confirmMessage,
  confirmButtonText,
  executeConfirmAction,
  showSongPhysicalDeleteConfirm,
  songToPhysicalDelete,
  handleSongPhysicalDelete,
  executeSongPhysicalDelete,
  showFolderDeleteConfirm,
  folderToDeletePath,
  executeDeleteFolder,
  showCreateFolderModal,
  confirmCreateFolder,
  showRenameModal,
  renameInitialValue,
  confirmRename,
} = useHomePageModel();
</script>

<style scoped>
.home-view-fade-enter-active,
.home-view-fade-leave-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}

.home-view-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.home-view-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
