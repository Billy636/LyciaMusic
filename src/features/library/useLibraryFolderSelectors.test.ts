import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';

import type { Song } from '../../types';
import { useLibraryFolderSelectors } from './useLibraryFolderSelectors';

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: 'C:\\Music\\Rock\\demo.flac',
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

describe('useLibraryFolderSelectors', () => {
  it('does not throw when some songs in folder are missing from songLookup during title sorting', () => {
    const watchedFolders = ref(['C:/Music/Rock']);
    const sourceSongPaths = ref([
      'C:/Music/Rock/loaded.mp3',
      'C:/Music/Rock/unloaded.mp3',
    ]);
    const loadedSong = makeSong({
      path: 'C:/Music/Rock/loaded.mp3',
      title: 'Loaded Title',
      name: 'loaded.mp3',
    });
    // songLookup has size > 0, but is missing 'C:/Music/Rock/unloaded.mp3'
    const songMap = new Map<string, Song>([
      [loadedSong.path, loadedSong],
    ]);
    const songLookup = computed(() => songMap);
    const currentFolderFilter = ref('C:/Music/Rock');
    const folderSortMode = ref<'title' | 'name' | 'artist' | 'added_at' | 'track_number' | 'custom'>('title');
    const folderCustomOrder = ref({});

    const { currentFolderSongPaths } = useLibraryFolderSelectors({
      watchedFolders,
      sourceSongPaths,
      songLookup,
      currentFolderFilter,
      folderSortMode,
      folderCustomOrder,
    });

    expect(() => currentFolderSongPaths.value).not.toThrow();
    expect(currentFolderSongPaths.value).toHaveLength(2);
  });

  it('matches songs across Windows backslashes and case differences', () => {
    const watchedFolders = ref(['c:/music/rock']);
    const sourceSongPaths = ref([
      'c:/music/rock/song1.mp3',
    ]);
    const loadedSong = makeSong({
      path: 'C:\\Music\\Rock\\song1.mp3',
      title: 'Song 1 Title',
      name: 'song1.mp3',
    });
    const songMap = new Map<string, Song>([
      [loadedSong.path, loadedSong],
    ]);
    const songLookup = computed(() => songMap);
    const currentFolderFilter = ref('C:/Music/Rock');
    const folderSortMode = ref<'title'>('title');
    const folderCustomOrder = ref({});

    const { currentFolderSongPaths } = useLibraryFolderSelectors({
      watchedFolders,
      sourceSongPaths,
      songLookup,
      currentFolderFilter,
      folderSortMode,
      folderCustomOrder,
    });

    expect(currentFolderSongPaths.value).toEqual(['c:/music/rock/song1.mp3']);
  });
});
