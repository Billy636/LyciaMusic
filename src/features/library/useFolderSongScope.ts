import { computed, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../shared/stores/navigation';
import { useLibraryStore } from './store';
import { useSettingsStore } from '../settings/store';

const normalizeFolderPath = (path: string) =>
  path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** The recursive view is available only for folders below a library root. */
export function useFolderSongScope(folderPath?: Ref<string>) {
  const { currentFolderFilter, activeRootPath } = storeToRefs(useNavigationStore());
  const library = useLibraryStore();
  const settingsStore = useSettingsStore();
  const selectedFolder = folderPath ?? currentFolderFilter;

  const canIncludeDescendants = (path: string) => {
    if (!path || !activeRootPath.value) return false;
    const folder = normalizeFolderPath(path);
    const root = normalizeFolderPath(activeRootPath.value);
    if (!folder.startsWith(`${root}/`)) return false;
    // A nested watched root must retain the root-directory behavior too.
    return !library.libraryHierarchy.some(node => normalizeFolderPath(node.path) === folder)
      && !library.watchedFolders.some(path => normalizeFolderPath(path) === folder);
  };

  const includeSubfolders = computed(() =>
    settingsStore.settings.folderIncludeSubfolders && canIncludeDescendants(selectedFolder.value),
  );

  return {
    includeSubfolders,
    includesDescendantsFor: (path: string) => settingsStore.settings.folderIncludeSubfolders && canIncludeDescendants(path),
  };
}
