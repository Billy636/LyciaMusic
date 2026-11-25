import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { usePlaybackStore } from './store';
import { useUiStore } from '../../shared/stores/ui';

const demoSong = {
  path: '/music/demo.flac',
  name: 'demo.flac',
  title: 'Demo',
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'Album::Artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 120,
};

describe('playback and ui stores', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('stores playback state directly in the playback store', () => {
    const playbackStore = usePlaybackStore();

    playbackStore.isPlaying = true;
    playbackStore.volume = 72;
    playbackStore.currentSong = demoSong;
    playbackStore.playQueue = [demoSong];

    expect(playbackStore.isPlaying).toBe(true);
    expect(playbackStore.volume).toBe(72);
    expect(playbackStore.currentSong).toEqual(demoSong);
    expect(playbackStore.playQueue).toEqual([demoSong]);
  });

  it('stores ui state directly in the ui store', () => {
    const uiStore = useUiStore();

    uiStore.showPlaylist = true;
    uiStore.dominantColors = ['#111111', '#222222', '#333333', '#444444'];

    expect(uiStore.showPlaylist).toBe(true);
    expect(uiStore.dominantColors).toEqual(['#111111', '#222222', '#333333', '#444444']);
  });

  it('keeps playback and ui state scoped to their dedicated stores', () => {
    const playbackStore = usePlaybackStore();
    const uiStore = useUiStore();

    expect(playbackStore.isPlaying).toBe(false);
    expect(playbackStore.playQueue).toEqual([]);
    expect(uiStore.showPlaylist).toBe(false);
    expect(uiStore.showPlayerDetail).toBe(false);
  });
});
