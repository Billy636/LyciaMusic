import { useLibraryStore } from '../features/library/store';
import type {
  LibraryScanSession,
  LibraryScanTrigger,
  LibraryScanVisibility,
} from '../types';

const LIBRARY_SCAN_VISIBILITY_PRIORITY: Record<LibraryScanVisibility, number> = {
  silent: 1,
  inline: 2,
  hero: 3,
};

export interface ScanLibraryOptions {
  trigger?: LibraryScanTrigger;
  visibility?: LibraryScanVisibility;
  sourcePath?: string;
}

const getLibraryStore = () => useLibraryStore();

export const resolveScanLibraryOptions = (
  options: ScanLibraryOptions = {},
): Required<ScanLibraryOptions> => ({
  trigger: options.trigger ?? 'manual-rescan',
  visibility: options.visibility ?? 'inline',
  sourcePath: options.sourcePath ?? '',
});

export const isLibraryScanActive = () => {
  const libraryStore = getLibraryStore();
  return !!libraryStore.libraryScanProgress
    && !libraryStore.libraryScanProgress.done
    && !libraryStore.libraryScanProgress.failed;
};

const shouldReplaceLibraryScanSession = (nextVisibility: LibraryScanVisibility) => {
  const libraryStore = getLibraryStore();

  if (!libraryStore.libraryScanSession) {
    return true;
  }

  if (!isLibraryScanActive()) {
    return true;
  }

  const currentPriority = LIBRARY_SCAN_VISIBILITY_PRIORITY[libraryStore.libraryScanSession.visibility];
  const nextPriority = LIBRARY_SCAN_VISIBILITY_PRIORITY[nextVisibility];
  return nextPriority > currentPriority;
};

export const startLibraryScanSession = (options: Required<ScanLibraryOptions>) => {
  const libraryStore = getLibraryStore();
  const nextSession: LibraryScanSession = {
    trigger: options.trigger,
    visibility: options.visibility,
    startedAt: Date.now(),
    hadLibraryFoldersAtStart: libraryStore.libraryFolders.length > 0,
    hadSongsAtStart: libraryStore.librarySongs.length > 0,
    sourcePath: options.sourcePath || undefined,
  };

  if (shouldReplaceLibraryScanSession(options.visibility)) {
    libraryStore.setLibraryScanSession(nextSession);
    return nextSession;
  }

  if (
    libraryStore.libraryScanSession
    && !libraryStore.libraryScanSession.sourcePath
    && nextSession.sourcePath
  ) {
    libraryStore.setLibraryScanSession({
      ...libraryStore.libraryScanSession,
      sourcePath: nextSession.sourcePath,
    });
  }

  return libraryStore.libraryScanSession!;
};

export const beginLibraryScanProgress = (session: LibraryScanSession) => {
  const libraryStore = getLibraryStore();
  libraryStore.setLibraryScanProgress({
    phase: 'collecting',
    current: 0,
    total: 0,
    folder_path: session.sourcePath ?? '',
    folder_index: session.sourcePath ? 1 : 0,
    folder_total: Math.max(1, libraryStore.libraryFolders.length),
    message: null,
    done: false,
    failed: false,
  });
};

export const getLibraryAddScanOptions = (path: string): Required<ScanLibraryOptions> => {
  const libraryStore = getLibraryStore();
  const isFirstImport = libraryStore.libraryFolders.length === 0 && libraryStore.librarySongs.length === 0;

  return {
    trigger: isFirstImport ? 'first-import' : 'folder-add',
    visibility: isFirstImport ? 'hero' : 'silent',
    sourcePath: path,
  };
};

export const finalizeLibraryScanProgress = (
  songs: ArrayLike<unknown>,
  failed = false,
  message?: string,
) => {
  const libraryStore = getLibraryStore();
  const existing = libraryStore.libraryScanProgress;

  libraryStore.setLibraryScanProgress({
    phase: failed ? 'error' : 'complete',
    current: songs.length,
    total: songs.length,
    folder_path: existing?.folder_path ?? libraryStore.libraryScanSession?.sourcePath ?? '',
    folder_index: existing?.folder_index ?? 0,
    folder_total: existing?.folder_total ?? Math.max(1, libraryStore.libraryFolders.length),
    message: message ?? (failed ? 'Library scan failed' : `Scan complete: ${songs.length} songs`),
    done: true,
    failed,
  });
};
