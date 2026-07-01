import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Song } from '../types';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { createPlayerLibraryBatch } from './playerLibraryBatch';

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
  ...overrides,
});

describe('player library batch', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('drops deleted songs from source lists, queues, and current playback references', () => {
    const libraryStore = useLibraryStore();
    const playbackStore = usePlaybackStore();
    const keptSong = makeSong({ path: '/music/keep.flac', title: 'Keep' });
    const removedSong = makeSong({ path: '/music/remove.flac', title: 'Remove' });

    libraryStore.librarySongs = [keptSong];
    libraryStore.songList = [keptSong, removedSong];
    playbackStore.playQueue = [keptSong, removedSong];
    playbackStore.tempQueue = [removedSong];
    playbackStore.currentSong = removedSong;

    const playerLibraryBatch = createPlayerLibraryBatch({
      createSongLookup: (fallbackSongs: Song[] = []) => {
        const lookup = new Map<string, Song>();
        fallbackSongs.forEach((song) => {
          if (song?.path) {
            lookup.set(song.path, song);
          }
        });
        libraryStore.canonicalSongs.forEach((song) => {
          lookup.set(song.path, song);
        });
        return lookup;
      },
    });

    playerLibraryBatch.applyLibraryScanBatch({
      songs: [],
      deleted_paths: [removedSong.path],
    });
    playerLibraryBatch.flushBufferedLibraryScanBatch();

    expect(libraryStore.sourceSongPaths).toEqual([keptSong.path]);
    expect(playbackStore.playQueuePaths).toEqual([keptSong.path]);
    expect(playbackStore.tempQueuePaths).toEqual([]);
    expect(playbackStore.currentSong).toBeNull();
  });
});
