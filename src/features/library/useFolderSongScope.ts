import { computed, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../shared/stores/navigation';
import { useLibraryStore } from './store';
import { useSettingsStore } from '../settings/store';

const normalizeFolderPath = (path: string) =>
  path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Folder collections always include descendants without changing the normal folder preference. */
export function useFolderSongScope(folderPath?: Ref<string>) {
  const { currentFolderFilter, currentViewMode, folderCollectionPath, activeRootPath } = storeToRefs(useNavigationStore());
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

  const includesDescendantsFor = (path: string) => {
    const collectionPath = normalizeFolderPath(folderCollectionPath.value);
    if (folderCollectionPath.value && currentViewMode.value === 'folder'
      && normalizeFolderPath(currentFolderFilter.value) === collectionPath
      && normalizeFolderPath(path) === collectionPath) return true;
    return settingsStore.settings.folderIncludeSubfolders && canIncludeDescendants(path);
  };

  const includeSubfolders = computed(() => includesDescendantsFor(selectedFolder.value));

  return {
    includeSubfolders,
    includesDescendantsFor,
  };
}
