import { storeToRefs } from 'pinia';
import { useLibraryStore } from '../features/library/store';
import { useNavigationStore } from '../shared/stores/navigation';
import { useUiStore } from '../shared/stores/ui';
import { usePlaylistSort } from '../features/collections/usePlaylistSort';

export function usePlayerViewState() {
  const libraryStore = useLibraryStore();
  const navigationStore = useNavigationStore();
  const uiStore = useUiStore();
  const libraryRefs = storeToRefs(libraryStore);
  const navigationRefs = storeToRefs(navigationStore);
  const uiRefs = storeToRefs(uiStore);

  const setFolderSortMode = (mode: 'title' | 'name' | 'artist' | 'track_number' | 'added_at' | 'added_at_asc' | 'custom') => {
    libraryRefs.folderSortMode.value = mode;
  };

  const setLocalSortMode = (mode: 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc' | 'custom') => {
    libraryRefs.localSortMode.value = mode;
  };

  const setAlbumDetailSortMode = (mode: 'track_number' | 'track_number_desc' | 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc') => {
    libraryRefs.albumDetailSortMode.value = mode;
  };

  const { playlistSortMode, setPlaylistSortMode } = usePlaylistSort();

  return {
    ...navigationRefs,
    isMiniMode: uiRefs.isMiniMode,
    folderSortMode: libraryRefs.folderSortMode,
    localSortMode: libraryRefs.localSortMode,
    albumDetailSortMode: libraryRefs.albumDetailSortMode,
    playlistSortMode,
    setSearch: navigationStore.setSearch,
    setFolderSortMode,
    setLocalSortMode,
    setAlbumDetailSortMode,
    setPlaylistSortMode,
  };
}
