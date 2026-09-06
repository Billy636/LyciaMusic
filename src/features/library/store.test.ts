import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Song } from '../../types';
import { useLibraryStore } from './store';

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

describe('library store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('increments data version when canonical songs are changed through the legacy setter', () => {
    const libraryStore = useLibraryStore();
    const initialVersion = libraryStore.libraryDataVersion;

    libraryStore.librarySongs = [makeSong()];

    expect(libraryStore.libraryDataVersion).toBeGreaterThan(initialVersion);
  });

  it('keeps quality badges but excludes runtime metadata from the long-lived song pool', () => {
    const libraryStore = useLibraryStore();
    libraryStore.setLibrarySongs([makeSong({
      id: 7,
      bitrate: 1411,
      sample_rate: 96000,
      bit_depth: 24,
      format: 'flac',
      cue_source_path: '/music/album.flac',
      cue_start_offset: 12000,
      comment: 'Comment',
    })]);

    expect(libraryStore.canonicalSongs[0]).toMatchObject({
      path: '/music/demo.flac',
      title: 'Demo',
      artist: 'Artist',
      album: 'Album',
      bitrate: 1411,
      sample_rate: 96000,
      bit_depth: 24,
      format: 'flac',
    });
    expect(libraryStore.canonicalSongs[0]).not.toHaveProperty('id');
    expect(libraryStore.canonicalSongs[0]).not.toHaveProperty('cue_source_path');
    expect(libraryStore.canonicalSongs[0]).not.toHaveProperty('comment');
  });

  it('invalidates derived caches when one song record changes', () => {
    const libraryStore = useLibraryStore();
    libraryStore.setLibrarySongs([makeSong()]);
    const initialVersion = libraryStore.libraryDataVersion;

    libraryStore.setSongRecord(makeSong({ title: 'Updated' }));

    expect(libraryStore.libraryDataVersion).toBeGreaterThan(initialVersion);
  });
});
