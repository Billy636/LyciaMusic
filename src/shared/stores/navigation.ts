import { ref } from 'vue';
import { defineStore } from 'pinia';

export type NavigationViewMode =
  | 'all'
  | 'folder'
  | 'artist'
  | 'album'
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
  const currentArtistFilter = ref('');
  const currentAlbumFilter = ref('');
  const currentFolderFilter = ref('');
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
    currentArtistFilter,
    currentAlbumFilter,
    currentFolderFilter,
    favTab,
    favDetailFilter,
    recentTab,
    activeRootPath,
    setSearch,
    refreshSearch,
  };
});
