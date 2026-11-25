import { storeToRefs } from 'pinia';
import { computed } from 'vue';

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
    artistBrowseMode,
  } = storeToRefs(navigationStore);
  const {
    libraryFolders,
    canonicalSongPaths,
    sourceSongPaths,
    canonicalSongs,
    sourceSongs,
    libraryHierarchy,
    artistSortMode: trackArtistSortMode,
    albumArtistSortMode,
    albumSortMode,
  } = storeToRefs(libraryStore);

  const artistSortMode = computed({
    get: () => artistBrowseMode.value === 'albumArtist' ? albumArtistSortMode.value : trackArtistSortMode.value,
    set: mode => {
      if (artistBrowseMode.value === 'albumArtist') albumArtistSortMode.value = mode;
      else trackArtistSortMode.value = mode;
    },
  });

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
    artistBrowseMode,
    albumSortMode,
    artistList: computed(() => artistBrowseMode.value === 'albumArtist'
      ? libraryView.albumArtistList.value : libraryView.artistList.value),
    albumList: libraryView.albumList,
    currentFolderSongs: libraryView.currentFolderSongs,
    currentViewSongs: libraryView.currentViewSongs,
    filteredArtistList: computed(() => artistBrowseMode.value === 'albumArtist'
      ? libraryView.filteredAlbumArtistList.value : libraryView.filteredArtistList.value),
    filteredAlbumList: libraryView.filteredAlbumList,
    folderList: libraryView.folderList,
    favoriteSongList: libraryView.favoriteSongList,
    favArtistList: libraryView.favArtistList,
    favAlbumList: libraryView.favAlbumList,
    recentAlbumList: libraryView.recentAlbumList,
    recentPlaylistList: libraryView.recentPlaylistList,
    // Compatibility aliases for older callers.
    folderTree: libraryView.libraryHierarchy,
    librarySongs: libraryView.canonicalSongs,
    displaySongList: libraryView.currentViewSongs,
    reorderWatchedFolders,
  };
}
