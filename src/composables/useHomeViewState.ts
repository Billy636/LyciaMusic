import { computed, ref, watch, type Ref } from 'vue';
import { type ArtistTabId, getDefaultArtistTab } from '../utils/artistTabsOrder';

interface UseHomeViewStateOptions {
  currentViewMode: Ref<string>;
  filterCondition: Ref<string>;
  isManagementMode: Ref<boolean>;
}

export function useHomeViewState({
  currentViewMode,
  filterCondition,
  isManagementMode,
}: UseHomeViewStateOptions) {
  const localViewMode = ref(currentViewMode.value);
  const localFilterCondition = ref(filterCondition.value);
  const artistActiveTab = ref<ArtistTabId>(getDefaultArtistTab());

  const viewTransitionKey = computed(
    () => `${localViewMode.value}:${localFilterCondition.value}`,
  );

  watch(
    currentViewMode,
    (newMode, oldMode) => {
      localViewMode.value = newMode;
      if (oldMode !== 'artist' && newMode === 'artist') {
        artistActiveTab.value = getDefaultArtistTab();
      }
      if (newMode !== 'folder') {
        isManagementMode.value = false;
      }
    },
    { immediate: true },
  );

  watch(
    filterCondition,
    newFilter => {
      localFilterCondition.value = newFilter;
    },
    { immediate: true },
  );

  return {
    localViewMode,
    localFilterCondition,
    artistActiveTab,
    viewTransitionKey,
  };
}

