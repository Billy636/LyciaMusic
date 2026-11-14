import { computed } from 'vue';
import { useCollectionsStore } from './store';
import { useNavigationStore } from '../../shared/stores/navigation';
import type { PlaylistSortMode } from '../../services/storage/playerStorage';

export function usePlaylistSort() {
  const collections = useCollectionsStore();
  const navigation = useNavigationStore();
  const override = computed(() => navigation.currentViewMode === 'playlist'
    ? collections.getPlaylistSortOverride(navigation.filterCondition) : undefined);
  const playlistSortMode = computed(() => override.value ?? collections.playlistSortMode);
  const followsDefault = computed(() => override.value === undefined);
  const setPlaylistSortMode = (mode: PlaylistSortMode | null) => {
    if (navigation.currentViewMode === 'playlist') {
      collections.setPlaylistSortOverride(navigation.filterCondition, mode);
    }
  };
  return { playlistSortMode, followsDefault, setPlaylistSortMode };
}
