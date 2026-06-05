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
});
