import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import type { Song } from '../../types';
import { useLibraryStore } from './store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { useLibraryAllSongPathCache } from '../../composables/useLibraryAllSongPathCache';
import { usePlayerLibraryView } from './usePlayerLibraryView';

const tauriInvokeMock = vi.fn();

vi.mock('../../services/tauri/invoke', () => ({
  tauriInvoke: (...args: unknown[]) => tauriInvokeMock(...args),
}));

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: '/music/demo.flac',
  name: 'demo.flac',
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
  added_at: 1,
  ...overrides,
});

describe('player library view first import refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useLibraryAllSongPathCache().clearLibraryAllSongPathCache();

    tauriInvokeMock.mockImplementation(async (command: string) => {
      if (command !== 'get_library_song_paths_for_all_view') {
        return [];
      }

      const libraryStore = useLibraryStore();
      return [...libraryStore.canonicalSongPaths];
    });
  });

  it('refreshes local music after songs are imported into an empty library', async () => {
    const navigationStore = useNavigationStore();
    const libraryStore = useLibraryStore();

    navigationStore.currentViewMode = 'all';
    libraryStore.localSortMode = 'title';

    const { displaySongList } = usePlayerLibraryView();
    await flushPromises();

    expect(displaySongList.value).toEqual([]);

    const importedSong = makeSong();
    useLibraryAllSongPathCache().clearLibraryAllSongPathCache();
    libraryStore.librarySongs = [importedSong];
    await vi.waitFor(() => {
      expect(displaySongList.value.map(song => song.path)).toEqual([importedSong.path]);
    });
  });

  it('does not apply stale all-view path results after the library changes', async () => {
    const navigationStore = useNavigationStore();
    const libraryStore = useLibraryStore();
    const firstSong = makeSong({ path: '/music/first.flac', title: 'First' });
    const secondSong = makeSong({ path: '/music/second.flac', title: 'Second' });
    const request = deferred<string[]>();

    navigationStore.currentViewMode = 'all';
    libraryStore.localSortMode = 'title';
    libraryStore.librarySongs = [firstSong];
    tauriInvokeMock.mockImplementationOnce(async () => request.promise);

    const { displaySongList } = usePlayerLibraryView();
    await flushPromises();

    libraryStore.patchLibrarySongs({ songs: [secondSong], deleted_paths: [] });
    request.resolve([firstSong.path]);

    await vi.waitFor(() => {
      expect(displaySongList.value.map(song => song.path)).toEqual([firstSong.path, secondSong.path]);
    });
  });

  it('filters stale fallback paths that no longer exist in the song lookup', async () => {
    const navigationStore = useNavigationStore();
    const libraryStore = useLibraryStore();
    const firstSong = makeSong({ path: '/music/first.flac', title: 'First' });
    const secondSong = makeSong({ path: '/music/second.flac', title: 'Second' });
    const request = deferred<string[]>();

    navigationStore.currentViewMode = 'all';
    libraryStore.localSortMode = 'title';
    libraryStore.librarySongs = [firstSong, secondSong];
    tauriInvokeMock.mockResolvedValueOnce([firstSong.path, secondSong.path]);

    const { displaySongList } = usePlayerLibraryView();
    await vi.waitFor(() => {
      expect(displaySongList.value.map(song => song.path)).toEqual([firstSong.path, secondSong.path]);
    });

    navigationStore.currentViewMode = 'statistics';
    await nextTick();
    tauriInvokeMock.mockImplementationOnce(async () => request.promise);
    libraryStore.patchLibrarySongs({ songs: [], deleted_paths: [secondSong.path] });
    navigationStore.currentViewMode = 'all';
    await nextTick();

    await vi.waitFor(() => {
      expect(() => displaySongList.value.map(song => song.path)).not.toThrow();
      expect(displaySongList.value.map(song => song.path)).toEqual([firstSong.path]);
    });
  });
});
