import { ref } from 'vue';
import { defineStore } from 'pinia';

export type ArtistBrowseMode = 'artist' | 'albumArtist';

export type NavigationViewMode =
  | 'all'
  | 'folder'
  | 'artist'
  | 'album'
  | 'genre'
  | 'playlist'
  | 'recent'
  | 'favorites'
  | 'statistics';

export const useNavigationStore = defineStore('navigation', () => {
  const currentViewMode = ref<NavigationViewMode>('all');
  const filterCondition = ref('');
  const searchQuery = ref('');
  const searchRevision = ref(0);
  const localMusicTab = ref<'default' | 'artist' | 'album'>('default');
  const artistBrowseMode = ref<ArtistBrowseMode>('artist');
  const currentArtistBrowseMode = ref<ArtistBrowseMode>('artist');
  const currentArtistFilter = ref('');
  const currentAlbumFilter = ref('');
  const currentFolderFilter = ref('');
  const folderCollectionPath = ref('');
  const favTab = ref<'songs' | 'artists' | 'albums'>('songs');
  const favDetailFilter = ref<{ type: 'artist' | 'album'; name: string } | null>(null);
  const recentTab = ref<'songs' | 'playlists' | 'albums'>('songs');
  const activeRootPath = ref<string | null>(null);

  const setSearch = (query: string) => {
    searchQuery.value = query;
  };

  const refreshSearch = () => {
    searchRevision.value += 1;
  };

  return {
    currentViewMode,
    filterCondition,
    searchQuery,
    searchRevision,
    localMusicTab,
    artistBrowseMode,
    currentArtistBrowseMode,
    currentArtistFilter,
    currentAlbumFilter,
    currentFolderFilter,
    folderCollectionPath,
    favTab,
    favDetailFilter,
    recentTab,
    activeRootPath,
    setSearch,
    refreshSearch,
  };
});
