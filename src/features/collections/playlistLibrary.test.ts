import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import { localStore } from '../../services/storage/localStore';
import type { Playlist } from '../../types';
import {
  filterAndSortPlaylists,
  getShortcutPlaylists,
  PLAYLIST_SHORTCUT_LIMIT,
  usePlaylistLibraryStore,
  type PlaylistLibraryOptions,
} from './playlistLibrary';
import { useCollectionsStore } from './store';

const STORAGE_KEY = 'player_playlist_library';

const createPlaylist = (id: string, overrides: Partial<Playlist> = {}): Playlist => ({
  id,
  name: `歌单 ${id}`,
  songPaths: [],
  ...overrides,
});

const options = (overrides: Partial<PlaylistLibraryOptions> = {}): PlaylistLibraryOptions => ({
  query: '',
  filter: 'all',
  sortMode: 'custom',
  pinnedIds: [],
  ...overrides,
});

const ids = (playlists: Playlist[]) => playlists.map(playlist => playlist.id);

describe('playlist library selectors', () => {
  it('promotes pins while preserving custom order without mutating the collection', () => {
    const playlists = [createPlaylist('a'), createPlaylist('b'), createPlaylist('c')];
    const original = playlists.slice();

    const result = filterAndSortPlaylists(playlists, options({ pinnedIds: ['c', 'a'] }));

    expect(ids(result)).toEqual(['a', 'c', 'b']);
    expect(playlists).toEqual(original);
    expect(result).not.toBe(playlists);
    expect(result[0]).toBe(playlists[0]);
  });

  it('searches Chinese names, full pinyin, initials and normalized English', () => {
    const playlists = [
      createPlaylist('night', { name: '深夜漫游' }),
      createPlaylist('green', { name: '绿色心情 Remix' }),
      createPlaylist('road', { name: 'Road Trip' }),
    ];

    expect(ids(filterAndSortPlaylists(playlists, options({ query: '夜漫' })))).toEqual(['night']);
    expect(ids(filterAndSortPlaylists(playlists, options({ query: 'shenyemanyou' })))).toEqual(['night']);
    expect(ids(filterAndSortPlaylists(playlists, options({ query: 'symy' })))).toEqual(['night']);
    expect(ids(filterAndSortPlaylists(playlists, options({ query: 'lvse remix' })))).toEqual(['green']);
    expect(ids(filterAndSortPlaylists(playlists, options({ query: '  ＲＯＡＤ  ' })))).toEqual(['road']);
    expect(filterAndSortPlaylists(playlists, options({ query: 'missing' }))).toEqual([]);
  });

  it('combines name search with pinned and empty filters', () => {
    const playlists = [
      createPlaylist('a', { name: '旅行 A', songPaths: ['a.flac'] }),
      createPlaylist('b', { name: '旅行 B' }),
      createPlaylist('c', { name: '工作 C' }),
    ];

    expect(ids(filterAndSortPlaylists(playlists, options({
      query: '旅行', filter: 'pinned', pinnedIds: ['a', 'c', 'missing'],
    })))).toEqual(['a']);
    expect(ids(filterAndSortPlaylists(playlists, options({
      query: '旅行', filter: 'empty',
    })))).toEqual(['b']);
  });

  it('sorts newest dates first and resolves same-day ties in reverse source order', () => {
    const playlists = [
      createPlaylist('missing'),
      createPlaylist('early', { createdAt: '2025-01-01' }),
      createPlaylist('today-a', { createdAt: '2026-09-22' }),
      createPlaylist('invalid', { createdAt: 'not-a-date' }),
      createPlaylist('today-b', { createdAt: '2026-09-22' }),
    ];

    expect(ids(filterAndSortPlaylists(playlists, options({ sortMode: 'newest' })))).toEqual([
      'today-b', 'today-a', 'early', 'invalid', 'missing',
    ]);
    expect(ids(filterAndSortPlaylists(playlists, options({
      sortMode: 'newest', pinnedIds: ['early'],
    })))).toEqual(['early', 'today-b', 'today-a', 'invalid', 'missing']);
  });

  it('supports ISO timestamps while treating a shared calendar day as a tie', () => {
    const playlists = [
      createPlaylist('a', { createdAt: '2026-09-22T17:00:00.000Z' }),
      createPlaylist('b', { createdAt: '2026-09-22T01:00:00.000Z' }),
    ];

    expect(ids(filterAndSortPlaylists(playlists, options({ sortMode: 'newest' })))).toEqual(['b', 'a']);
  });

  it('sorts names naturally and keeps pins ahead of alphabetic order', () => {
    const playlists = [
      createPlaylist('10', { name: 'Mix 10' }),
      createPlaylist('2', { name: 'Mix 2' }),
      createPlaylist('1', { name: 'Mix 1' }),
    ];

    expect(ids(filterAndSortPlaylists(playlists, options({ sortMode: 'name' })))).toEqual(['1', '2', '10']);
    expect(ids(filterAndSortPlaylists(playlists, options({
      sortMode: 'name', pinnedIds: ['10'],
    })))).toEqual(['10', '1', '2']);
  });

  it('sorts counts descending and preserves source order for equal counts', () => {
    const playlists = [
      createPlaylist('a', { songPaths: ['a'] }),
      createPlaylist('b', { songPaths: ['a', 'b'] }),
      createPlaylist('c', { songPaths: ['c'] }),
      createPlaylist('d'),
    ];

    expect(ids(filterAndSortPlaylists(playlists, options({ sortMode: 'count' })))).toEqual(['b', 'a', 'c', 'd']);
  });

  it('uses six pin-first shortcuts with source ordering independent of pinning order', () => {
    const playlists = Array.from({ length: 9 }, (_, index) => createPlaylist(String(index)));

    const result = getShortcutPlaylists(playlists, ['8', '6', 'missing']);

    expect(PLAYLIST_SHORTCUT_LIMIT).toBe(6);
    expect(ids(result)).toEqual(['6', '8', '0', '1', '2', '3']);
    expect(ids(playlists)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
    expect(ids(getShortcutPlaylists(playlists, ['8'], 2))).toEqual(['8', '0']);
    expect(getShortcutPlaylists(playlists, [], 0)).toEqual([]);
    expect(getShortcutPlaylists(playlists, [], -1)).toEqual([]);
  });

  it('handles empty collections and missing pins', () => {
    expect(filterAndSortPlaylists([], options({ pinnedIds: ['missing'] }))).toEqual([]);
    expect(getShortcutPlaylists([], ['missing'])).toEqual([]);
  });
});

describe('playlist library state and persistence', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
      clear: vi.fn(() => storage.clear()),
    });
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('defaults to all playlists in a custom-order grid', () => {
    const store = usePlaylistLibraryStore();

    expect(store.$id).toBe('playlistLibrary');
    expect(store.searchQuery).toBe('');
    expect(store.filter).toBe('all');
    expect(store.viewMode).toBe('grid');
    expect(store.sortMode).toBe('custom');
    expect(store.pinnedIds).toEqual([]);
  });

  it('reflects collections and song counts without owning a second playlist copy', () => {
    const collections = useCollectionsStore();
    const store = usePlaylistLibraryStore();
    collections.setPlaylists([
      createPlaylist('a', { name: '工作', songPaths: ['a.flac'] }),
      createPlaylist('b', { name: '旅行' }),
    ]);

    expect(ids(store.visiblePlaylists)).toEqual(['a', 'b']);
    expect(store.emptyCount).toBe(1);
    collections.addToPlaylist('b', 'b.flac');
    expect(store.emptyCount).toBe(0);
    store.searchQuery = 'lvxing';
    expect(ids(store.visiblePlaylists)).toEqual(['b']);
    expect(ids(store.shortcutPlaylists)).toEqual(['a', 'b']);
  });

  it('pins only existing playlists and supports batch pinning and removal', () => {
    const collections = useCollectionsStore();
    collections.setPlaylists([createPlaylist('a'), createPlaylist('b'), createPlaylist('c')]);
    const store = usePlaylistLibraryStore();

    expect(store.togglePin('missing')).toBe(false);
    expect(store.togglePin('c')).toBe(true);
    store.setPinned(['b', 'b', 'missing'], true);
    expect(store.pinnedIds).toEqual(['c', 'b']);
    expect(store.pinnedCount).toBe(2);
    expect(ids(store.visiblePlaylists)).toEqual(['b', 'c', 'a']);
    expect(store.isPinned('c')).toBe(true);
    store.setPinned(['c'], false);
    expect(store.pinnedIds).toEqual(['b']);
    store.removePinned(['b', 'missing']);
    expect(store.pinnedIds).toEqual([]);
    expect(store.pinnedCount).toBe(0);
  });

  it('persists only view, sort and pins in a separate key', async () => {
    useCollectionsStore().setPlaylists([createPlaylist('a')]);
    localStore.setJson('player_playlists', [{ id: 'do-not-change' }]);
    const store = usePlaylistLibraryStore();
    store.searchQuery = 'private session query';
    store.filter = 'empty';
    store.viewMode = 'list';
    store.sortMode = 'name';
    store.togglePin('a');
    await nextTick();

    expect(localStore.getJson(STORAGE_KEY)).toEqual({
      viewMode: 'list', sortMode: 'name', pinnedIds: ['a'],
    });
    expect(localStore.getJson('player_playlists')).toEqual([{ id: 'do-not-change' }]);

    setActivePinia(createPinia());
    const restored = usePlaylistLibraryStore();
    expect(restored.viewMode).toBe('list');
    expect(restored.sortMode).toBe('name');
    expect(restored.pinnedIds).toEqual(['a']);
    expect(restored.searchQuery).toBe('');
    expect(restored.filter).toBe('all');
  });

  it('does not write preferences when only the session search or filter changes', async () => {
    const store = usePlaylistLibraryStore();
    store.searchQuery = 'travel';
    store.filter = 'pinned';
    await nextTick();

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it.each(['{', 'null', '[]', '42', '"invalid"'])(
    'recovers defaults from malformed or invalid preferences: %s',
    (raw) => {
      localStorage.setItem(STORAGE_KEY, raw);
      const store = usePlaylistLibraryStore();

      expect(store.viewMode).toBe('grid');
      expect(store.sortMode).toBe('custom');
      expect(store.pinnedIds).toEqual([]);
    },
  );

  it('validates persisted enums and removes invalid and duplicate pin IDs', () => {
    localStore.setJson(STORAGE_KEY, {
      viewMode: 'cards', sortMode: 'random', pinnedIds: ['a', 1, null, '', ' ', 'b', 'a'],
    });
    const store = usePlaylistLibraryStore();

    expect(store.viewMode).toBe('grid');
    expect(store.sortMode).toBe('custom');
    expect(store.pinnedIds).toEqual(['a', 'b']);
  });

  it('retains restored pins while collections hydrate and excludes stale IDs from counts', async () => {
    localStore.setJson(STORAGE_KEY, { viewMode: 'grid', sortMode: 'custom', pinnedIds: ['b', 'missing'] });
    const store = usePlaylistLibraryStore();
    await nextTick();
    expect(store.pinnedIds).toEqual(['b', 'missing']);
    expect(store.pinnedCount).toBe(0);

    useCollectionsStore().setPlaylists([createPlaylist('a'), createPlaylist('b')]);
    await nextTick();

    expect(store.pinnedIds).toEqual(['b', 'missing']);
    expect(store.pinnedCount).toBe(1);
    expect(ids(store.shortcutPlaylists)).toEqual(['b', 'a']);
  });

  it('cleans up deleted pins and persists removal, including deletion from other views', async () => {
    const collections = useCollectionsStore();
    collections.setPlaylists([createPlaylist('a'), createPlaylist('b')]);
    const store = usePlaylistLibraryStore();
    store.setPinned(['a', 'b'], true);
    await nextTick();

    collections.deletePlaylist('b');
    await nextTick();

    expect(store.pinnedIds).toEqual(['a']);
    expect(store.pinnedCount).toBe(1);
    expect(localStore.getJson(STORAGE_KEY)).toEqual({
      viewMode: 'grid', sortMode: 'custom', pinnedIds: ['a'],
    });
  });

  it('does not drop pins during a synchronous remove-and-insert reorder', async () => {
    const collections = useCollectionsStore();
    collections.setPlaylists([createPlaylist('a'), createPlaylist('b')]);
    const store = usePlaylistLibraryStore();
    store.setPinned(['b'], true);
    await nextTick();

    const [moved] = collections.playlists.splice(1, 1);
    collections.playlists.unshift(moved!);
    await nextTick();

    expect(store.pinnedIds).toEqual(['b']);
    expect(ids(store.shortcutPlaylists)).toEqual(['b', 'a']);
  });

  it('keeps library state usable when storage cannot be read or written', async () => {
    vi.spyOn(localStore, 'getJson').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(localStore, 'setJson').mockImplementation(() => { throw new Error('quota exceeded'); });

    const store = usePlaylistLibraryStore();
    store.viewMode = 'list';
    await nextTick();

    expect(store.viewMode).toBe('list');
    expect(store.visiblePlaylists).toEqual([]);
  });
});
