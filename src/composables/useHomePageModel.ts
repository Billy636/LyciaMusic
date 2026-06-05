import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import type { Song } from '../types';

import { useCoverCache } from './useCoverCache';
import { useHomeArtistAlbums } from './useHomeArtistAlbums';
import { useHomeBatchActions } from './useHomeBatchActions';
import { useHomeFolderManagement } from './useHomeFolderManagement';
import { useHomeNavigation } from './useHomeNavigation';
import { useHomePlaylistRename } from './useHomePlaylistRename';
import { useScopedBatchSelection } from './useScopedBatchSelection';

import { useHomeViewState } from './useHomeViewState';
import { usePlayerViewState } from './usePlayerViewState';
import { useSongContextActions } from './useSongContextActions';
import { useSongDrag } from './useSongDrag';
import { useToast } from './toast';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';
import { useLibraryRuntimeActions } from '../features/library/useLibraryRuntimeActions';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useLibraryStore } from '../features/library/store';

export function useHomePageModel() {
  const route = useRoute();
  const router = useRouter();
  const { openHomeAlbum } = useHomeNavigation(router);
  const { showToast } = useToast();
  const { openAddToPlaylistDialog } = useAddToPlaylistDialog();

  const libraryStore = useLibraryStore();
  const {
    canonicalSongs,
    sourceSongs,
    albumSortMode,
    albumCustomOrder,
  } = storeToRefs(libraryStore);

  const {
    currentViewMode,
    activeRootPath,
    currentFolderFilter,
    filterCondition,
  } = usePlayerViewState();
  const {
    displaySongList,
    librarySongs,
    folderTree,
    searchQuery,
  } = usePlayerLibraryView();
  const { playSong } = usePlaybackController();
  const {
    moveFilesToFolder,
    refreshAllFolders,
    deleteFromDisk,
    addLibraryFolder,
    getSongsInFolder,
    createFolder,
    deleteFolder,
    expandFolderPath,
    fetchFolderTree,
    removeLibraryFolderLinked,
    refreshFolder,
  } = useLibraryRuntimeActions();
  const {
    createPlaylist,
    favoritePaths,
    removeFromHistory,
    playlists,
  } = useLibraryCollections();
  const { coverCache, loadingSet, preloadCovers } = useCoverCache();

  const isManagementMode = ref(false);
  const songTableRef = ref<any>(null);
  const setSongTableRef = (instance: any | null) => {
    songTableRef.value = instance;
  };

  const {
    localViewMode,
    localFilterCondition,
    artistActiveTab,
    viewTransitionKey,
  } = useHomeViewState({
    currentViewMode,
    filterCondition,
    isManagementMode,
  });

  const localSongList = computed(() => displaySongList.value);
  const selectedAlbumSong = computed(() => localSongList.value[0] || null);
  const batchSelectionScopeKey = computed(() =>
    [
      route.path,
      currentViewMode.value,
      filterCondition.value,
      currentFolderFilter.value,
    ].join('::'),
  );
  const {
    isBatchMode,
    selectedPaths,
  } = useScopedBatchSelection(batchSelectionScopeKey);

  const { handleTableDragStart } = useSongDrag(
    localSongList,
    isBatchMode,
    selectedPaths,
    songTableRef,
  );

  const {
    showContextMenu,
    contextMenuX,
    contextMenuY,
    contextMenuTargetSong,
    showSongPhysicalDeleteConfirm,
    songToPhysicalDelete,
    handleContextMenu,
    handleSongPhysicalDelete,
    executeSongPhysicalDelete,
  } = useSongContextActions({
    isBatchMode,
    deleteFromDisk,
  });

  const {
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
  } = useHomeBatchActions({
    currentViewMode,
    selectedPaths,
    isBatchMode,
    isManagementMode,
    canonicalSongs,
    sourceSongs,
    favoritePaths,
    playlists,
    moveFilesToFolder,
    removeFromHistory,
    showToast,
    getRoutePath: () => route.path,
  });

  const {
    showCreateFolderModal,
    showFolderDeleteConfirm,
    folderToDeletePath,
    handleActiveRootChange,
    confirmCreateFolder,
    executeDeleteFolder,
    handleAddFolder,
    handleRootCreateFolderRequest,
    handleRootDeleteFolderRequest,
    handleRefreshFolder,
    handleRemoveFolderWithConfirm,
  } = useHomeFolderManagement({
    isManagementMode,
    activeRootPath,
    currentFolderFilter,
    libraryHierarchy: folderTree,
    sourceSongs,
    refreshFolder,
    fetchFolderTree,
    createFolder,
    deleteFolder,
    expandFolderPath,
    addLibraryFolder,
    removeLibraryFolderLinked,
    showToast,
    openConfirm,
  });


  const {
    showRenameModal,
    renameInitialValue,
    handleRenamePlaylist,
    confirmRename,
  } = useHomePlaylistRename({
    currentViewMode,
    filterCondition,
    playlists,
    showToast,
  });

  const playlistDetail = computed(() => {
    if (localViewMode.value !== 'playlist') {
      return null;
    }

    const playlist = playlists.value.find(item => item.id === localFilterCondition.value);
    if (!playlist) {
      return null;
    }

    return {
      name: playlist.name,
      date: (playlist as any).createdAt || '',
    };
  });

  const { artistAlbumList } = useHomeArtistAlbums({
    localFilterCondition,
    filterCondition,
    librarySongs,
    albumSortMode,
    albumCustomOrder,
    preloadCovers,
  });

  const handlePlayAll = () => {
    if (localSongList.value.length > 0) {
      void playSong(localSongList.value[0]);
    }
  };

  const handlePlaySong = (song: Song) => {
    const shouldInsertAfterCurrent =
      searchQuery.value.trim().length > 0 &&
      ['all', 'artist', 'album', 'folder'].includes(currentViewMode.value);

    void playSong(song, shouldInsertAfterCurrent ? { insertAfterCurrent: true } : undefined);
  };

  const handleBatchPlay = () => {
    const selectedSongs = localSongList.value.filter(song => selectedPaths.value.has(song.path));
    if (selectedSongs.length > 0) {
      void playSong(selectedSongs[0]);
    }
  };

  const handleAddToPlaylistRequest = () => {
    const songPaths = isBatchMode.value
      ? Array.from(selectedPaths.value)
      : (contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : []);

    openAddToPlaylistDialog(songPaths, {
      onAdded: () => {
        if (isBatchMode.value) {
          isBatchMode.value = false;
        }
      },
    });
  };

  const handleRefreshAll = async () => {
    try {
      const summary = await refreshAllFolders();
      if (summary && typeof summary === 'object' && 'removedCount' in summary) {
        const removedCount = Number(summary.removedCount) || 0;
        showToast(
          removedCount > 0
            ? `刷新成功，检测到少了 ${removedCount} 首歌曲`
            : '刷新成功',
          'success',
        );
        return;
      }

      showToast('刷新成功', 'success');
    } catch (error: any) {
      showToast(`刷新失败: ${error?.message || error}`, 'error');
    }
  };

  const handleRootCreatePlaylistRequest = (folderPath: string, folderName: string) => {
    const songs = getSongsInFolder(folderPath);
    if (songs.length === 0) {
      showToast('该文件夹下没有可用于创建歌单的歌曲', 'info');
      return;
    }

    createPlaylist(folderName, songs.map(song => song.path));
    showToast('已根据文件夹创建歌单', 'success');
  };

  const handleArtistAlbumClick = (albumKey: string) => {
    void openHomeAlbum(albumKey);
  };

  return {
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
    artistActiveTab,
    localFilterCondition,
    selectedAlbumSong,
    artistAlbumList,
    coverCache,
    loadingSet,
    songTableRef,
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
    playSong: handlePlaySong,
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
  };
}
