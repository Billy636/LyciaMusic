import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, effectScope, ref, shallowRef, type EffectScope } from 'vue';

import type { Song } from '../../types';
import type { AlbumDetailSortMode, LocalSortMode } from '../../services/storage/playerStorage';
import { useLibraryCurrentViewSongs } from './useLibraryCurrentViewSongs';

const mocks = vi.hoisted(() => ({ loadPaths: vi.fn(), invoke: vi.fn() }));
vi.mock('../../composables/useLibraryAllSongPathCache', () => ({
  useLibraryAllSongPathCache: () => ({ loadAllViewSongPaths: mocks.loadPaths }),
  isStaleLibraryPathRequestError: () => false,
}));
vi.mock('../../services/tauri/invoke', () => ({ tauriInvoke: mocks.invoke }));

const makeSong = (path: string, overrides: Partial<Song> = {}): Song => ({
  path,
  name: `${path}.flac`,
  title: path,
  artist: '周杰伦',
  artist_names: ['周杰伦'],
  effective_artist_names: ['周杰伦'],
  album: '八度空间',
  album_artist: '周杰伦',
  album_key: 'octave::jay',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
  ...overrides,
});

describe('artist-sorted song path authority', () => {
  const scopes: EffectScope[] = [];

  const createView = (viewMode: string, paths: string[], songs: Song[]) => {
    const metadata = shallowRef(new Map(songs.map(song => [song.path, song])));
    const scope = effectScope();
    scopes.push(scope);
    const view = scope.run(() => useLibraryCurrentViewSongs({
      canonicalSongPaths: ref(paths),
      playlists: ref([]),
      recentSongs: ref([]),
      songLookup: computed(() => metadata.value),
      favoriteSongPaths: computed(() => []),
      currentFolderSongPaths: computed(() => []),
      currentViewMode: ref(viewMode),
      searchQuery: ref(''),
      localMusicTab: ref('default'),
      currentArtistFilter: ref(''),
      currentAlbumFilter: ref(''),
      currentFolderFilter: ref(''),
      filterCondition: ref('target'),
      favTab: ref('songs'),
      favDetailFilter: ref(null),
      folderSortMode: ref('artist'),
      localSortMode: ref<LocalSortMode>('artist'),
      albumDetailSortMode: ref<AlbumDetailSortMode>('artist'),
      localCustomOrder: ref([]),
      playlistSortMode: ref('artist'),
    }))!;
    return { metadata, ...view };
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.loadPaths.mockReset();
    mocks.invoke.mockReset().mockResolvedValue([]);
  });

  afterEach(() => scopes.splice(0).forEach(scope => scope.stop()));

  it.each(['artist', 'album'])('preserves backend %s detail ordering with sparse and changing metadata', async viewMode => {
    const paths = ['/track-1', '/track-2', '/other-album'];
    mocks.loadPaths.mockResolvedValue(paths);
    const view = createView(viewMode, paths, [makeSong('/track-1')]);

    await vi.waitFor(() => expect(view.currentViewSongPaths.value).toEqual(paths));
    view.metadata.value = new Map([['/track-2', makeSong('/track-2')]]);
    expect(view.currentViewSongPaths.value).toEqual(paths);
    view.metadata.value = new Map();
    expect(view.currentViewSongPaths.value).toEqual(paths);
  });

  it('uses pinyin artist, album and track order for the first-load local fallback', () => {
    mocks.loadPaths.mockReturnValue(new Promise(() => {}));
    const songs = [
      makeSong('/jay', { artist: '周杰伦' }),
      makeSong('/eason-other', { artist: '陈奕迅', album: '专辑 B', album_key: 'b', track_number: '1' }),
      makeSong('/eason-2', { artist: '陈奕迅', album: '专辑 A', album_key: 'a', track_number: '2' }),
      makeSong('/eason-1', { artist: '陈奕迅', album: '专辑 A', album_key: 'a', track_number: '1' }),
    ];
    const view = createView('all', songs.map(song => song.path), songs);

    expect(view.currentViewSongPaths.value).toEqual(['/eason-1', '/eason-2', '/eason-other', '/jay']);
  });
});
