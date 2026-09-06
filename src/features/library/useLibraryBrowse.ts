import { storeToRefs } from 'pinia';

import { useLibraryStore } from './store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { usePlayerLibraryView } from './usePlayerLibraryView';

export function useLibraryBrowse() {
  const libraryStore = useLibraryStore();
  const navigationStore = useNavigationStore();
  const libraryView = usePlayerLibraryView();

  const {
    searchQuery,
    localMusicTab,
    currentViewMode,
    currentFolderFilter,
    activeRootPath,
  } = storeToRefs(navigationStore);
  const {
    libraryFolders,
    canonicalSongPaths,
    sourceSongPaths,
    canonicalSongs,
    sourceSongs,
    libraryHierarchy,
    artistSortMode,
    albumSortMode,
    artistCustomOrder,
    albumCustomOrder,
  } = storeToRefs(libraryStore);

  const updateArtistOrder = (newOrder: string[]) => {
    artistCustomOrder.value = newOrder;
    if (artistSortMode.value !== 'custom') {
      artistSortMode.value = 'custom';
    }
  };

  const updateAlbumOrder = (newOrder: string[]) => {
    albumCustomOrder.value = newOrder;
    if (albumSortMode.value !== 'custom') {
      albumSortMode.value = 'custom';
    }
  };

  const reorderWatchedFolders = (from: number, to: number) => {
    libraryStore.reorderWatchedFolders(from, to);
  };

  return {
    searchQuery,
    localMusicTab,
    currentViewMode,
    currentFolderFilter,
    activeRootPath,
    libraryHierarchy,
    libraryFolders,
    canonicalSongPaths,
    sourceSongPaths,
    canonicalSongs,
    sourceSongs,
    artistSortMode,
    albumSortMode,
    artistList: libraryView.artistList,
    albumList: libraryView.albumList,
    currentFolderSongs: libraryView.currentFolderSongs,
    currentViewSongs: libraryView.currentViewSongs,
    filteredArtistList: libraryView.filteredArtistList,
    filteredAlbumList: libraryView.filteredAlbumList,
    folderList: libraryView.folderList,
    favoriteSongList: libraryView.favoriteSongList,
    favArtistList: libraryView.favArtistList,
    favAlbumList: libraryView.favAlbumList,
    recentPlaylistList: libraryView.recentPlaylistList,
    // Compatibility aliases for older callers.
    folderTree: libraryView.libraryHierarchy,
    librarySongs: libraryView.canonicalSongs,
    displaySongList: libraryView.currentViewSongs,
    updateArtistOrder,
    updateAlbumOrder,
    reorderWatchedFolders,
  };
}
