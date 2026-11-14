import { effectScope, nextTick, ref, type Ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FolderNode, Song } from '../types';
import { usePlaybackStore } from '../features/playback/store';
import { useSongTableAlphabetIndex } from './useSongTableAlphabetIndex';
import { INDEX_KEYS } from '../utils/alphabetIndex';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  titleLabel: vi.fn(),
  unmountCallbacks: [] as Array<() => void>,
}));

vi.mock('../services/tauri/invoke', () => ({ tauriInvoke: mocks.invoke }));
vi.mock('./useLibraryAllSongPathCache', () => ({ getCachedLibrarySongTitleLabel: mocks.titleLabel }));

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>();
  return {
    ...actual,
    onUnmounted: (callback: () => void) => { mocks.unmountCallbacks.push(callback); },
  };
});

const makeSong = (path: string): Song => ({
  path,
  name: path.split('/').pop() || 'demo.flac',
  title: 'Demo',
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
});

const scopes: ReturnType<typeof effectScope>[] = [];
const windowListeners = new Map<string, (event: PointerEvent) => void>();
const flushIndex = async () => {
  await nextTick();
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
};

const mountAlphabetIndex = (
  currentViewMode: Ref<string>,
  overrides: Partial<Parameters<typeof useSongTableAlphabetIndex>[0]> = {},
) => {
  const songs = ref([makeSong('/music/demo.flac'), makeSong('/music/next.flac')]);
  const scrollTo = vi.fn();
  const scope = effectScope();
  scopes.push(scope);
  const options = {
    songs,
    scrollTop: ref(144),
    containerHeight: ref(600),
    containerRef: ref({ scrollTo } as unknown as HTMLElement),
    rootRef: ref(null),
    routePath: ref('/'),
    currentViewMode,
    localSortMode: ref('title'),
    folderSortMode: ref('title'),
    activeRootPath: ref(null),
    currentFolderFilter: ref(''),
    folderTree: ref<FolderNode[]>([]),
    refreshFolder: async () => undefined,
    expandFolderPath: async () => undefined,
    ...overrides,
  };
  const result = scope.run(() => useSongTableAlphabetIndex(options))!;

  return {
    result,
    options,
    scrollTo,
    unmount: () => scope.stop(),
  };
};

describe('useSongTableAlphabetIndex', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.titleLabel.mockReturnValue(undefined);
    mocks.invoke.mockResolvedValue([]);
    windowListeners.clear();
    vi.stubGlobal('window', {
      addEventListener: vi.fn((name: string, callback: (event: PointerEvent) => void) => windowListeners.set(name, callback)),
      removeEventListener: vi.fn((name: string) => windowListeners.delete(name)),
    });
    setActivePinia(createPinia());
  });

  afterEach(() => {
    mocks.unmountCallbacks.splice(0).forEach(callback => callback());
    scopes.splice(0).forEach(scope => scope.stop());
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ['all', '/', 'localSortMode'],
    ['artist', '/', 'localSortMode'],
    ['folder', '/', 'folderSortMode'],
    ['playlist', '/', 'playlistSortMode'],
    ['album', '/', 'albumDetailSortMode'],
    ['favorites', '/favorites', 'localSortMode'],
    ['recent', '/recent', 'localSortMode'],
  ])('shows the artist index in %s using its own sort mode', async (viewMode, route, sortOption) => {
    mocks.invoke.mockResolvedValue(['A', 'C']);
    const { result } = mountAlphabetIndex(ref(viewMode), {
      songs: ref([]),
      songPaths: ref(['/song/first.flac', '/song/second.flac']),
      routePath: ref(route),
      [sortOption]: ref('artist'),
    });
    expect(result.showAlphabetIndex.value).toBe(false);
    await flushIndex();

    expect(result.showAlphabetIndex.value).toBe(true);
    expect([...result.firstSongIndexByKey.value]).toEqual([['A', 0], ['C', 1]]);
    expect(mocks.invoke).toHaveBeenCalledWith('get_library_song_artist_index_keys', {
      paths: ['/song/first.flac', '/song/second.flac'],
    });
  });

  it.each(['playlist', 'album'])('does not mistake the global sort mode for the %s sort mode', async viewMode => {
    const { result } = mountAlphabetIndex(ref(viewMode), { localSortMode: ref('artist') });
    await flushIndex();
    expect(result.showAlphabetIndex.value).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('indexes the full authoritative path order instead of sparse metadata or file names', async () => {
    const paths = ['/song/Z-file.flac', '/song/A-file.flac', '/song/B-file.flac', '/song/C-file.flac'];
    mocks.invoke.mockResolvedValue(['A', 'T', 'T', 'Z']);
    const { result, options, scrollTo } = mountAlphabetIndex(ref('all'), {
      localSortMode: ref('artist'),
      songPaths: ref([...paths]),
      songs: ref([{ ...makeSong(paths[2]), artist: '陶喆', title: 'Different title' }]),
    });
    await flushIndex();

    expect([...result.firstSongIndexByKey.value]).toEqual([['A', 0], ['T', 1], ['Z', 3]]);
    expect(result.activeIndexKey.value).toBe('T');
    result.handleIndexPointerDown({ preventDefault: vi.fn(), pointerId: 1, currentTarget: null } as unknown as PointerEvent, 'T');
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 72, behavior: 'auto' });

    result.indexBarRef.value = { getBoundingClientRect: () => ({ top: 0, height: INDEX_KEYS.length * 10 }) } as unknown as HTMLElement;
    windowListeners.get('pointermove')?.({ clientY: INDEX_KEYS.indexOf('Z') * 10 + 5 } as PointerEvent);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 216, behavior: 'auto' });
    expect(result.activeIndexKey.value).toBe('Z');
    expect(options.songPaths?.value).toEqual(paths);

    options.scrollTop.value = 0;
    expect(result.activeIndexKey.value).toBe('A');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('does not guess artist letters before the index is ready or when loading fails', async () => {
    mocks.invoke.mockRejectedValue(new Error('unavailable'));
    const { result, scrollTo } = mountAlphabetIndex(ref('all'), {
      localSortMode: ref('artist'),
      songPaths: ref(['/song/Z-file.flac']),
    });
    result.handleIndexPointerDown({ preventDefault: vi.fn() } as unknown as PointerEvent, 'Z');
    await flushIndex();
    expect(result.showAlphabetIndex.value).toBe(false);
    expect(result.firstSongIndexByKey.value.size).toBe(0);
    expect(result.activeIndexKey.value).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('supports number/symbol groups and ignores missing database paths', async () => {
    mocks.invoke.mockResolvedValue(['0', '', 'U', '#']);
    const { result } = mountAlphabetIndex(ref('all'), {
      localSortMode: ref('artist'),
      songPaths: ref(['/number', '/missing', '/unknown', '/symbol']),
      scrollTop: ref(72),
    });
    await flushIndex();
    expect([...result.firstSongIndexByKey.value]).toEqual([['0', 0], ['U', 2], ['#', 3]]);
    expect(result.activeIndexKey.value).toBeNull();
  });

  it('keeps an explicitly empty path list empty instead of indexing stale songs', () => {
    const { result } = mountAlphabetIndex(ref('all'), { songPaths: ref([]) });
    expect(result.showAlphabetIndex.value).toBe(false);
    expect(result.firstSongIndexByKey.value.size).toBe(0);
    expect(result.activeIndexKey.value).toBeNull();
  });

  it('keeps the existing title index and resolves sparse song metadata by path', () => {
    const first = { ...makeSong('/music/1.flac'), title: '阿' };
    const second = { ...makeSong('/music/2.flac'), title: '周' };
    mocks.titleLabel.mockImplementation((path: string) => path === first.path ? first.title : undefined);
    const { result } = mountAlphabetIndex(ref('all'), {
      songPaths: ref([first.path, second.path]),
      songs: ref([second]),
      scrollTop: ref(72),
    });
    expect(result.showAlphabetIndex.value).toBe(true);
    expect([...result.firstSongIndexByKey.value]).toEqual([['A', 0], ['Z', 1]]);
    expect(result.activeIndexKey.value).toBe('Z');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('stops an active index drag when switching away from artist sorting', async () => {
    mocks.invoke.mockResolvedValue(['A', 'Z']);
    const localSortMode = ref('artist');
    const { result } = mountAlphabetIndex(ref('all'), { localSortMode });
    await flushIndex();
    result.handleIndexPointerDown({ preventDefault: vi.fn(), pointerId: 1, currentTarget: null } as unknown as PointerEvent, 'A');
    expect(result.isIndexDragging.value).toBe(true);
    localSortMode.value = 'added_at';
    await flushIndex();
    expect(result.isIndexDragging.value).toBe(false);
    expect(result.dragIndexKey.value).toBeNull();
    expect(windowListeners.size).toBe(0);
  });

  it.each(['playlist', 'artist', 'album'])(
    'shows scroll-to-top button in %s detail view after scrolling past the first row',
    (viewMode) => {
      const { result, unmount } = mountAlphabetIndex(ref(viewMode));

      expect(result.showScrollToTopButton.value).toBe(true);

      unmount();
    },
  );

  it.each(['playlist', 'artist', 'album'])(
    'keeps locate-current-song available in %s detail view when the current song is in the list',
    (viewMode) => {
      usePlaybackStore().currentSong = makeSong('/music/demo.flac');

      const { result, unmount } = mountAlphabetIndex(ref(viewMode));

      expect(result.canLocateCurrentSong.value).toBe(true);

      unmount();
    },
  );
});
