import { computed, onMounted, ref, watch } from 'vue';

import { useLibraryStore } from '../features/library/store';
import { useNavigationStore } from '../shared/stores/navigation';
import { tauriInvoke } from '../services/tauri/invoke';
import type { SearchIndexStatus } from '../types';
import { createSearchIndexEntry } from '../utils/pinyinSearch';
import { useLibraryAllSongPathCache } from './useLibraryAllSongPathCache';
import { useLibraryCollectionSongPathCache } from './useLibraryCollectionSongPathCache';
import { useLibraryDetailSongPathCache } from './useLibraryDetailSongPathCache';
import { useLibraryFolderSongPathCache } from './useLibraryFolderSongPathCache';

const SEARCH_INDEX_BATCH_SIZE = 128;
const indexed = ref(0);
const total = ref(0);
const isBuilding = ref(false);
const lastError = ref<unknown>(null);
let activeBuild: Promise<void> | null = null;
let initialized = false;

const yieldToUi = () => new Promise<void>(resolve => window.setTimeout(resolve, 0));

const applyStatus = (status: SearchIndexStatus) => {
  indexed.value = status.indexed;
  total.value = status.total;
};

export function useLibrarySearchIndex() {
  const libraryStore = useLibraryStore();
  const navigationStore = useNavigationStore();
  const { clearLibraryAllSongPathCache } = useLibraryAllSongPathCache();
  const { clearLibraryCollectionSongPathCache } = useLibraryCollectionSongPathCache();
  const { clearLibraryDetailSongPathCache } = useLibraryDetailSongPathCache();
  const { clearLibraryFolderSongPathCache } = useLibraryFolderSongPathCache();

  const buildIndex = () => {
    if (activeBuild) {
      return activeBuild;
    }

    activeBuild = (async () => {
      isBuilding.value = true;
      lastError.value = null;
      let wasIncomplete = false;
      try {
        applyStatus(await tauriInvoke('get_search_index_status'));
        wasIncomplete = indexed.value < total.value;

        while (indexed.value < total.value) {
          const sources = await tauriInvoke('get_search_index_batch', {
            limit: SEARCH_INDEX_BATCH_SIZE,
          });
          if (sources.length === 0) {
            break;
          }
          const entries = sources.map(createSearchIndexEntry);
          applyStatus(await tauriInvoke('upsert_search_index_batch', { entries }));
          await yieldToUi();
        }

        applyStatus(await tauriInvoke('get_search_index_status'));
        if (wasIncomplete && indexed.value >= total.value && navigationStore.searchQuery.trim()) {
          clearLibraryAllSongPathCache();
          clearLibraryCollectionSongPathCache();
          clearLibraryDetailSongPathCache();
          clearLibraryFolderSongPathCache();
          navigationStore.refreshSearch();
        }
      } catch (error) {
        lastError.value = error;
        console.warn('Failed to build pinyin search index:', error);
      } finally {
        isBuilding.value = false;
        activeBuild = null;
      }
    })();

    return activeBuild;
  };

  if (!initialized) {
    initialized = true;
    onMounted(() => void buildIndex());
    watch(
      () => libraryStore.libraryDataVersion,
      () => void buildIndex(),
    );
  }

  return {
    searchIndexIndexed: computed(() => indexed.value),
    searchIndexTotal: computed(() => total.value),
    searchIndexBuilding: computed(() => isBuilding.value),
    searchIndexProgress: computed(() => (
      total.value > 0 ? Math.min(100, Math.round(indexed.value / total.value * 100)) : 100
    )),
    searchIndexError: computed(() => lastError.value),
    rebuildSearchIndex: buildIndex,
  };
}
