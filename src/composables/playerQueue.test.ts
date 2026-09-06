import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../services/tauri/playbackApi', () => ({
  playbackApi: {
    pauseAudio: vi.fn().mockResolvedValue(undefined),
  },
}));

import { playbackApi } from '../services/tauri/playbackApi';
import type { Song } from '../types';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { createPlayerQueue } from './playerQueue';

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

describe('player queue domain', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('plays queued temp songs before the main queue', () => {
    const playSong = vi.fn();
    const playbackStore = usePlaybackStore();
    const playerQueue = createPlayerQueue({
      playSong,
      stopPlaybackRuntime: vi.fn(),
      showToast: vi.fn(),
    });

    const currentSong = makeSong({ path: '/music/current.flac', title: 'Current' });
    const queuedSong = makeSong({ path: '/music/queued.flac', title: 'Queued' });
    const tempSong = makeSong({ path: '/music/next.flac', title: 'Next Up' });

    playbackStore.currentSong = currentSong;
    playbackStore.playQueue = [currentSong, queuedSong];
    playbackStore.tempQueue = [tempSong];

    playerQueue.nextSong();

    expect(playSong).toHaveBeenCalledWith(
      tempSong,
      expect.objectContaining({ preserveQueue: true }),
    );
    expect(playbackStore.tempQueue).toEqual([]);
  });

  it('preserves the main queue during normal next-song navigation', () => {
    const playSong = vi.fn();
    const playbackStore = usePlaybackStore();
    const playerQueue = createPlayerQueue({
      playSong,
      stopPlaybackRuntime: vi.fn(),
      showToast: vi.fn(),
    });
    const currentSong = makeSong({ path: '/music/current.flac', title: 'Current' });
    const nextSong = makeSong({ path: '/music/next.flac', title: 'Next' });
    playbackStore.currentSong = currentSong;
    playbackStore.playQueue = [currentSong, nextSong];

    playerQueue.nextSong();

    expect(playSong).toHaveBeenCalledWith(
      nextSong,
      expect.objectContaining({ preserveQueue: true }),
    );
  });

  it('clears queue state and pauses runtime when queue is reset during playback', async () => {
    const playbackStore = usePlaybackStore();
    const stopPlaybackRuntime = vi.fn();
    const playerQueue = createPlayerQueue({
      playSong: vi.fn(),
      stopPlaybackRuntime,
      showToast: vi.fn(),
    });

    playbackStore.isPlaying = true;
    playbackStore.currentSong = makeSong({ path: '/music/current.flac' });
    playbackStore.playQueue = [makeSong({ path: '/music/a.flac' })];
    playbackStore.tempQueue = [makeSong({ path: '/music/b.flac' })];

    await playerQueue.clearQueue();

    expect(playbackStore.playQueue).toEqual([]);
    expect(playbackStore.tempQueue).toEqual([]);
    expect(playbackStore.currentSong).toBeNull();
    expect(playbackStore.isPlaying).toBe(false);
    expect(playbackApi.pauseAudio).toHaveBeenCalledTimes(1);
    expect(stopPlaybackRuntime).toHaveBeenCalledTimes(1);
  });

  it('falls back to library songs for previous navigation in shuffle mode', () => {
    const played: string[] = [];
    const playbackStore = usePlaybackStore();
    const libraryStore = useLibraryStore();
    const playerQueue = createPlayerQueue({
      playSong: (song) => {
        played.push(song.path);
      },
      stopPlaybackRuntime: vi.fn(),
      showToast: vi.fn(),
    });

    const firstSong = makeSong({ path: '/music/first.flac', title: 'First' });
    const secondSong = makeSong({ path: '/music/second.flac', title: 'Second' });
    libraryStore.songList = [firstSong, secondSong];
    playbackStore.playMode = 2;
    playbackStore.currentSong = firstSong;

    playerQueue.handleBeforePlay(secondSong);
    playbackStore.currentSong = secondSong;

    playerQueue.prevSong();

    expect(played).toEqual(['/music/first.flac']);
  });

  it('caps shuffle history to the most recent 256 entries', () => {
    const played: string[] = [];
    const playbackStore = usePlaybackStore();
    const libraryStore = useLibraryStore();
    const songs = Array.from({ length: 300 }, (_, index) =>
      makeSong({
        path: `/music/${index}.flac`,
        title: `Song ${index}`,
      }),
    );
    const playerQueue = createPlayerQueue({
      playSong: (song) => {
        played.push(song.path);
        playbackStore.currentSong = song;
      },
      stopPlaybackRuntime: vi.fn(),
      showToast: vi.fn(),
    });

    libraryStore.songList = songs;
    playbackStore.playMode = 2;
    playbackStore.currentSong = songs[0];

    for (let index = 1; index < songs.length; index += 1) {
      playerQueue.handleBeforePlay(songs[index]);
      playbackStore.currentSong = songs[index];
    }

    for (let index = 0; index < 256; index += 1) {
      playerQueue.prevSong();
    }

    expect(played).toHaveLength(256);
    expect(played[0]).toBe('/music/298.flac');
    expect(played[255]).toBe('/music/43.flac');
  });
});
