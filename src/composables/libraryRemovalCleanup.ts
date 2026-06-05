import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import type { Song } from '../types';

interface CleanupRemovedLibrarySongPathsOptions {
  removedPaths: string[];
  removedFolderPath?: string;
  stopPlayback?: () => Promise<void> | void;
  removeFromHistory?: (songPaths: string[]) => Promise<void> | void;
  removeSongStatistics?: (songPaths: string[]) => Promise<void> | void;
  clearCaches?: (songPaths: string[]) => Promise<void> | void;
}

export const normalizePathForScope = (path: string | null | undefined) =>
  (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export const isPathInFolderScope = (folderPath: string, path: string) => {
  const normalizedFolder = normalizePathForScope(folderPath);
  const normalizedPath = normalizePathForScope(path);

  return !!normalizedFolder
    && !!normalizedPath
    && (
      normalizedPath === normalizedFolder ||
      normalizedPath.startsWith(`${normalizedFolder}/`)
    );
};

export const collectSongPathsInFolderScope = (songs: Song[], folderPath: string) => {
  const seen = new Set<string>();
  const paths: string[] = [];

  songs.forEach((song) => {
    if (!song?.path || !isPathInFolderScope(folderPath, song.path)) {
      return;
    }

    const normalizedPath = normalizePathForScope(song.path);
    if (seen.has(normalizedPath)) {
      return;
    }

    seen.add(normalizedPath);
    paths.push(song.path);
  });

  return paths;
};

const dedupePaths = (paths: string[]) => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  paths.forEach((path) => {
    const normalizedPath = normalizePathForScope(path);
    if (!normalizedPath || seen.has(normalizedPath)) {
      return;
    }

    seen.add(normalizedPath);
    deduped.push(path);
  });

  return deduped;
};

export const cleanupRemovedLibrarySongPaths = async ({
  removedPaths,
  removedFolderPath = '',
  stopPlayback,
  removeFromHistory,
  removeSongStatistics,
  clearCaches,
}: CleanupRemovedLibrarySongPathsOptions) => {
  const uniqueRemovedPaths = dedupePaths(removedPaths);
  if (uniqueRemovedPaths.length === 0) {
    return;
  }

  const libraryStore = useLibraryStore();
  const collectionsStore = useCollectionsStore();
  const playbackStore = usePlaybackStore();
  const removedPathSet = new Set(uniqueRemovedPaths.map(normalizePathForScope));
  const isRemovedPath = (path: string | null | undefined) =>
    !!path && removedPathSet.has(normalizePathForScope(path));
  const isRemovedFolderPath = (path: string | null | undefined) =>
    !!path && !!removedFolderPath && isPathInFolderScope(removedFolderPath, path);

  playbackStore.playQueue = playbackStore.playQueue.filter(song => !isRemovedPath(song.path));
  playbackStore.tempQueue = playbackStore.tempQueue.filter(song => !isRemovedPath(song.path));

  const activeSongPath = playbackStore.currentSongPath ?? playbackStore.currentSong?.path ?? null;
  if (isRemovedPath(activeSongPath) || isRemovedFolderPath(activeSongPath)) {
    await stopPlayback?.();
    playbackStore.isPlaying = false;
    playbackStore.isSongLoaded = false;
    playbackStore.currentTime = 0;
    playbackStore.currentSong = null;
    playbackStore.currentCover = '';
    playbackStore.currentCoverPath = '';
    playbackStore.currentCoverFull = '';
  }

  collectionsStore.favoritePaths = collectionsStore.favoritePaths.filter(path => !isRemovedPath(path));
  collectionsStore.playlists.forEach((playlist) => {
    playlist.songPaths = playlist.songPaths.filter(path => !isRemovedPath(path));
  });
  collectionsStore.recentSongs = collectionsStore.recentSongs.filter(item => !isRemovedPath(item.path));

  libraryStore.localCustomOrder = libraryStore.localCustomOrder.filter(path => !isRemovedPath(path));
  libraryStore.folderCustomOrder = Object.fromEntries(
    Object.entries(libraryStore.folderCustomOrder).map(([folderPath, paths]) => [
      folderPath,
      paths.filter(path => !isRemovedPath(path)),
    ]),
  );

  await removeFromHistory?.(uniqueRemovedPaths);
  await removeSongStatistics?.(uniqueRemovedPaths);
  await clearCaches?.(uniqueRemovedPaths);
};
