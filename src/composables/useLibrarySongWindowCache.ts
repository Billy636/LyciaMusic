import { computed, shallowRef } from 'vue';

import { tauriInvoke } from '../services/tauri/invoke';
import type { LibrarySong } from '../types';
import { resolveSongPageCachePolicy } from '../utils/songPageCachePolicy';

interface EnsureSongWindowOptions {
  paths: string[];
  start: number;
  end: number;
  viewportHeight: number;
  rowHeight: number;
  scrollVelocityPxPerSecond?: number;
  memoryBudgetBytes?: number;
}

export function useLibrarySongWindowCache() {
  const songsByIndex = shallowRef(new Map<number, LibrarySong>());
  const loadedPageCount = shallowRef(0);
  const lastError = shallowRef<unknown>(null);
  const loadedPages = new Set<number>();
  const pageLastAccess = new Map<number, number>();
  const inFlightPages = new Map<number, Promise<void>>();

  let activePaths: string[] | null = null;
  let activePageSize = 0;
  let generation = 0;
  let ensureSequence = 0;
  let accessSequence = 0;

  const reset = (paths: string[] | null = null, pageSize = 0) => {
    generation += 1;
    ensureSequence += 1;
    activePaths = paths;
    activePageSize = pageSize;
    songsByIndex.value = new Map();
    loadedPages.clear();
    pageLastAccess.clear();
    inFlightPages.clear();
    loadedPageCount.value = 0;
    lastError.value = null;
  };

  const removePage = (pageIndex: number) => {
    if (!loadedPages.delete(pageIndex)) {
      return;
    }
    pageLastAccess.delete(pageIndex);
    const firstIndex = pageIndex * activePageSize;
    const nextSongs = new Map(songsByIndex.value);
    for (let index = firstIndex; index < firstIndex + activePageSize; index += 1) {
      nextSongs.delete(index);
    }
    songsByIndex.value = nextSongs;
    loadedPageCount.value = loadedPages.size;
  };

  const prunePages = (maxCachedPages: number, protectedPages: Set<number>) => {
    if (loadedPages.size <= maxCachedPages) {
      return;
    }

    const evictionCandidates = Array.from(loadedPages)
      .filter(pageIndex => !protectedPages.has(pageIndex))
      .sort((left, right) => (pageLastAccess.get(left) ?? 0) - (pageLastAccess.get(right) ?? 0));

    while (loadedPages.size > maxCachedPages && evictionCandidates.length > 0) {
      removePage(evictionCandidates.shift()!);
    }
  };

  const loadPage = (pageIndex: number, paths: string[], requestGeneration: number) => {
    pageLastAccess.set(pageIndex, ++accessSequence);
    if (loadedPages.has(pageIndex)) {
      return Promise.resolve();
    }

    const existingRequest = inFlightPages.get(pageIndex);
    if (existingRequest) {
      return existingRequest;
    }

    const offset = pageIndex * activePageSize;
    const pagePaths = paths.slice(offset, offset + activePageSize);
    if (pagePaths.length === 0) {
      return Promise.resolve();
    }

    const request = tauriInvoke('get_library_songs_by_paths', { paths: pagePaths })
      .then((songs) => {
        if (generation !== requestGeneration || activePaths !== paths) {
          return;
        }

        const songsByPath = new Map(songs.map(song => [song.path, song] as const));
        const nextSongs = new Map(songsByIndex.value);
        pagePaths.forEach((path, relativeIndex) => {
          const song = songsByPath.get(path);
          if (song) {
            nextSongs.set(offset + relativeIndex, song);
          }
        });
        songsByIndex.value = nextSongs;
        loadedPages.add(pageIndex);
        loadedPageCount.value = loadedPages.size;
        lastError.value = null;
      })
      .catch((error) => {
        if (generation === requestGeneration) {
          lastError.value = error;
        }
      })
      .finally(() => {
        if (generation === requestGeneration) {
          inFlightPages.delete(pageIndex);
        }
      });

    inFlightPages.set(pageIndex, request);
    return request;
  };

  const ensureWindow = async ({
    paths,
    start,
    end,
    viewportHeight,
    rowHeight,
    scrollVelocityPxPerSecond = 0,
    memoryBudgetBytes,
  }: EnsureSongWindowOptions) => {
    const policy = resolveSongPageCachePolicy({
      librarySize: paths.length,
      viewportHeight,
      rowHeight,
      scrollVelocityPxPerSecond,
      memoryBudgetBytes,
    });

    if (activePaths !== paths || activePageSize !== policy.pageSize) {
      reset(paths, policy.pageSize);
    }
    const ensureId = ++ensureSequence;
    if (paths.length === 0 || policy.pageSize === 0) {
      return;
    }

    const requestGeneration = generation;
    const firstVisiblePage = Math.floor(Math.max(0, start) / policy.pageSize);
    const lastVisiblePage = Math.floor(Math.max(start, end - 1) / policy.pageSize);
    const lastLibraryPage = Math.max(0, Math.ceil(paths.length / policy.pageSize) - 1);
    const firstRequestedPage = Math.max(0, firstVisiblePage - policy.prefetchPages);
    const lastRequestedPage = Math.min(lastLibraryPage, lastVisiblePage + policy.prefetchPages);
    const protectedPages = new Set<number>();
    const requests: Promise<void>[] = [];

    for (let pageIndex = firstRequestedPage; pageIndex <= lastRequestedPage; pageIndex += 1) {
      protectedPages.add(pageIndex);
      requests.push(loadPage(pageIndex, paths, requestGeneration));
    }

    await Promise.all(requests);
    if (generation === requestGeneration && ensureId === ensureSequence) {
      prunePages(policy.maxCachedPages, protectedPages);
    }
  };

  return {
    ensureWindow,
    getSongAt: (index: number) => songsByIndex.value.get(index),
    clearSongWindowCache: () => reset(),
    cachedSongCount: computed(() => songsByIndex.value.size),
    loadedPageCount: computed(() => loadedPageCount.value),
    lastError: computed(() => lastError.value),
  };
}
