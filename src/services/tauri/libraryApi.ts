import type { FolderNode, LibraryFolder } from '../../types';
import { tauriInvoke } from './invoke';

export const libraryApi = {
  getLibraryFolders: (): Promise<LibraryFolder[]> => tauriInvoke('get_library_folders'),
  getLibraryHierarchy: (): Promise<FolderNode[]> => tauriInvoke('get_library_hierarchy'),
  getFolderChildren: (folderPath: string): Promise<FolderNode[]> =>
    tauriInvoke('get_folder_children', { folderPath }),
  addLibraryFolder: (path: string): Promise<void> => tauriInvoke('add_library_folder', { path }),
  // Deprecated compat API. Do not use in new main-flow code.
  addSidebarFolder: (path: string): Promise<void> => tauriInvoke('add_sidebar_folder', { path }),
  removeLibraryFolder: (path: string): Promise<void> => tauriInvoke('remove_library_folder', { path }),
  // Deprecated compat API. Do not use in new main-flow code.
  removeSidebarFolder: (path: string): Promise<void> => tauriInvoke('remove_sidebar_folder', { path }),
  // Deprecated compat API. Main folder-tree flow must use getLibraryHierarchy().
  getSidebarHierarchy: (): Promise<FolderNode[]> => tauriInvoke('get_sidebar_hierarchy'),
  createFolder: (parentPath: string, folderName: string) =>
    tauriInvoke('create_folder', { parentPath, folderName }),
  refreshFolderSongs: (folderPath: string, minimumDurationSeconds = 0) =>
    tauriInvoke('refresh_folder_songs', { folderPath, minimumDurationSeconds }),
};
