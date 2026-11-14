import { computed } from 'vue';
import { getActivePinia, storeToRefs, type Pinia } from 'pinia';

import { useCollectionsStore } from '../collections/store';
import { usePlaylistSort } from '../collections/usePlaylistSort';
import { useLibraryStore } from './store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { useLibraryCatalogSelectors } from './useLibraryCatalogSelectors';
import { useLibraryCollectionSelectors } from './useLibraryCollectionSelectors';
import { useLibraryCurrentViewSongs } from './useLibraryCurrentViewSongs';
import { useLibraryFolderSelectors } from './useLibraryFolderSelectors';
import { useFolderSongScope } from './useFolderSongScope';
import { useFolderAlbumCollections } from './useFolderAlbumCollections';
import { isProfilingEnabled } from '../../utils/profiling';
export type { AlbumListItem, ArtistListItem } from './playerLibraryViewShared';

let playerLibraryViewInstanceCount = 0;
const playerLibraryViewByPinia = new WeakMap<Pinia, PlayerLibraryView>();

type PlayerLibraryView = ReturnType<typeof createPlayerLibraryView>;

const createPlayerLibraryView = () => {
  const debugInstanceId = ++playerLibraryViewInstanceCount;
  const debugStart = isProfilingEnabled() ? performance.now() : 0;
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const navigationStore = useNavigationStore();

  const {
    activeRootPath,
    currentAlbumFilter,
    currentArtistFilter,
    currentFolderFilter,
    currentViewMode,
    favDetailFilter,
    favTab,
    filterCondition,
    localMusicTab,
    searchQuery,
  } = storeToRefs(navigationStore);
  const {
    libraryHierarchy,
    libraryFolders,
    artistCatalog,
    albumCatalog,
    canonicalSongs,
    canonicalSongPaths,
    songLookup,
    sourceSongs,
    sourceSongPaths,
    watchedFolders,
    artistSortMode,
    albumArtistSortMode,
    albumSortMode,
    folderSortMode,
    folderCustomOrder,
    localSortMode,
    albumDetailSortMode,
    localCustomOrder,
  } = storeToRefs(libraryStore);
  const { favoritePaths, playlists, recentSongs } = storeToRefs(collectionsStore);
  const { playlistSortMode } = usePlaylistSort();
  const { catalog: albumBrowseCatalog } = storeToRefs(useFolderAlbumCollections());

  const isLocalMusic = computed(() =>
    currentViewMode.value === 'all' ||
    currentViewMode.value === 'artist' ||
    currentViewMode.value === 'album',
  );

  const isFolderMode = computed(() => currentViewMode.value === 'folder');

  const catalogSelectors = useLibraryCatalogSelectors({
    artistCatalog,
    albumCatalog: albumBrowseCatalog,
    metadataAlbumCatalog: albumCatalog,
    searchQuery,
    artistSortMode,
    albumSortMode,
    albumArtistSortMode,
  });

  const { includeSubfolders } = useFolderSongScope();
  const folderSelectors = useLibraryFolderSelectors({
    includeSubfolders,
    watchedFolders,
    sourceSongPaths,
    songLookup,
    currentFolderFilter,
    folderSortMode,
    folderCustomOrder,
  });

  const collectionSelectors = useLibraryCollectionSelectors({
    canonicalSongPaths,
    favoritePaths,
    playlists,
    recentSongs,
    songLookup,
  });

  const {
    currentViewSongPaths,
    currentViewSongs,
    loadMoreCurrentSearchResults,
    hasMoreCurrentSearchResults,
    currentSearchResultTotal,
  } = useLibraryCurrentViewSongs({
    canonicalSongPaths,
    playlists,
    recentSongs,
    songLookup,
    favoriteSongPaths: collectionSelectors.favoriteSongPaths,
    currentFolderSongPaths: folderSelectors.currentFolderSongPaths,
    currentViewMode,
    searchQuery,
    localMusicTab,
    currentArtistFilter,
    currentAlbumFilter,
    currentFolderFilter,
    filterCondition,
    favTab,
    favDetailFilter,
    folderSortMode,
    localSortMode,
    albumDetailSortMode,
    localCustomOrder,
    playlistSortMode,
    debugOwnerId: debugInstanceId,
  });

  if (isProfilingEnabled()) {
    console.log(
      `[Profiling] usePlayerLibraryView#${debugInstanceId} created in ${(performance.now() - debugStart).toFixed(2)}ms (total instances: ${playerLibraryViewInstanceCount})`,
    );
  }

  return {
    activeRootPath,
    albumList: catalogSelectors.albumList,
    artistList: catalogSelectors.artistList,
    albumArtistList: catalogSelectors.albumArtistList,
    canonicalSongs,
    currentFolderSongs: folderSelectors.currentFolderSongs,
    currentViewSongPaths,
    currentViewSongs,
    loadMoreCurrentSearchResults,
    hasMoreCurrentSearchResults,
    currentSearchResultTotal,
    favAlbumList: collectionSelectors.favAlbumList,
    favArtistList: collectionSelectors.favArtistList,
    favoriteSongList: collectionSelectors.favoriteSongList,
    filteredAlbumList: catalogSelectors.filteredAlbumList,
    filteredArtistList: catalogSelectors.filteredArtistList,
    filteredAlbumArtistList: catalogSelectors.filteredAlbumArtistList,
    folderList: folderSelectors.folderList,
    isFolderMode,
    isLocalMusic,
    libraryFolders,
    libraryHierarchy,
    recentAlbumList: collectionSelectors.recentAlbumList,
    recentPlaylistList: collectionSelectors.recentPlaylistList,
    searchQuery,
    sourceSongs,
    // Compatibility aliases for existing callers.
    displaySongList: currentViewSongs,
    folderTree: libraryHierarchy,
    librarySongs: canonicalSongs,
    songList: sourceSongs,
  };
};

export function usePlayerLibraryView() {
  const pinia = getActivePinia();
  if (!pinia) {
    return createPlayerLibraryView();
  }

  const existingView = playerLibraryViewByPinia.get(pinia);
  if (existingView) {
    return existingView;
  }

  const view = createPlayerLibraryView();
  playerLibraryViewByPinia.set(pinia, view);
  return view;
}
