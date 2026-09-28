import { usePlayerCore } from '../../composables/playerCore';

export function useLibraryRuntimeActions() {
  const { libraryDomain } = usePlayerCore();

  return {
    addLibraryFolder: libraryDomain.addLibraryFolder,
    addLibraryFolderLinked: libraryDomain.addLibraryFolderLinked,
    addLibraryFolderPath: libraryDomain.addLibraryFolderPath,
    removeLibraryFolder: libraryDomain.removeLibraryFolder,
    removeLibraryFolderLinked: libraryDomain.removeLibraryFolderLinked,
    removeLibraryFolderPath: libraryDomain.removeLibraryFolderPath,
    scanLibrary: libraryDomain.scanLibrary,
    refreshFolder: libraryDomain.refreshFolder,
    refreshAllFolders: libraryDomain.refreshAllFolders,
    fetchFolderTree: libraryDomain.fetchFolderTree,
    loadLibrarySongsFromCache: libraryDomain.loadLibrarySongsFromCache,
    ensureFolderChildrenLoaded: libraryDomain.ensureFolderChildrenLoaded,
    createFolder: libraryDomain.createFolder,
    deleteFolder: libraryDomain.deleteFolder,
    moveFolderToFolder: libraryDomain.moveFolderToFolder,
    toggleFolderNode: libraryDomain.toggleFolderNode,
    expandFolderPath: libraryDomain.expandFolderPath,
    moveFilesToFolder: libraryDomain.moveFilesToFolder,
    deleteFromDisk: libraryDomain.deleteFromDisk,
    openInFinder: libraryDomain.openInFinder,
    getSongsInFolder: libraryDomain.getSongsInFolder,
  };
}
