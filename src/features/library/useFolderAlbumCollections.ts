import { computed, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';

import type { AlbumCatalogItem } from '../../types';
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import { tauriInvoke } from '../../services/tauri/invoke';
import { useLibraryStore } from './store';

const normalizePath = (path: string) => {
  let normalized = path.replace(/\\/g, '/');
  if (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || navigator.userAgent)) {
    normalized = normalized.replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '');
  }
  return normalized.replace(/\/+$/, '') || '/';
};
const pathKey = (path: string) => {
  const normalized = normalizePath(path);
  const caseInsensitive = typeof navigator !== 'undefined' && /Win|Mac/i.test(navigator.platform || navigator.userAgent);
  return caseInsensitive ? normalized.toLowerCase() : normalized;
};
const isDescendant = (path: string, parent: string) =>
  path.startsWith(parent.endsWith('/') ? parent : `${parent}/`);

const uniqueFolders = (paths: string[]) => {
  const seen = new Set<string>();
  return paths.filter(path => {
    if (!path.trim()) return false;
    const key = pathKey(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const readFolders = () => {
  try {
    return uniqueFolders(playerStorage.readStringArray(playerStorageKeys.albumFolderCollections) ?? []);
  } catch (error) {
    console.error('Failed to read album folder collections:', error);
    return [];
  }
};

/** Album-page presentation rules; canonical album identities remain untouched. */
export const useFolderAlbumCollections = defineStore('folderAlbumCollections', () => {
  const library = useLibraryStore();
  const paths = ref(readFolders());
  const groupedCatalog = shallowRef<AlbumCatalogItem[]>([]);
  const resolvedRules = ref('');
  const rulesKey = computed(() => JSON.stringify(paths.value));
  const loading = ref(false);
  const error = ref('');
  let requestId = 0;

  const catalog = computed(() => !paths.value.length
    ? library.albumCatalog
    : resolvedRules.value === rulesKey.value ? groupedCatalog.value : []);

  const refresh = async () => {
    const currentRequest = ++requestId;
    const currentRules = rulesKey.value;
    error.value = '';
    if (!paths.value.length) {
      groupedCatalog.value = [];
      resolvedRules.value = currentRules;
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const items = await tauriInvoke('get_library_album_catalog', { folderCollections: [...paths.value] });
      if (currentRequest !== requestId || currentRules !== rulesKey.value) return;
      groupedCatalog.value = items;
      resolvedRules.value = currentRules;
    } catch (cause) {
      if (currentRequest !== requestId || currentRules !== rulesKey.value) return;
      console.error('Failed to load album folder collections:', cause);
      error.value = '专辑合集加载失败，请重试';
    } finally {
      if (currentRequest === requestId) loading.value = false;
    }
  };

  const isMerged = (path: string) => paths.value.some(folder => pathKey(folder) === pathKey(path));
  const parentCollection = (path: string) => {
    const key = pathKey(path);
    return paths.value.find(folder => pathKey(folder) !== key && isDescendant(key, pathKey(folder)));
  };
  const saveFolders = (next: string[]) => {
    const unique = uniqueFolders(next);
    if (JSON.stringify(unique) === rulesKey.value) return;
    // Persist before changing the UI, so a storage error cannot look successful.
    playerStorage.setString(playerStorageKeys.albumFolderCollections, JSON.stringify(unique));
    paths.value = unique;
  };
  const setMerged = (path: string, enabled: boolean) => {
    if (!path.trim()) return;
    if (enabled && !isMerged(path)) saveFolders([...paths.value, path]);
    else if (!enabled) saveFolders(paths.value.filter(folder => pathKey(folder) !== pathKey(path)));
  };
  const remapFolders = (remap: (path: string) => string) => saveFolders(paths.value.map(remap));

  // Catalog replacement is the existing post-scan / tag-edit / delete signal.
  // Do not depend on windowed song records: they do not cover the whole library.
  watch([paths, () => library.albumCatalog], () => { void refresh(); }, { immediate: true });

  return { paths, catalog, loading, error, refresh, isMerged, parentCollection, setMerged, remapFolders };
});
