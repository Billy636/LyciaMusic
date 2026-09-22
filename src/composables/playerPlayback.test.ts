import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const loadCoverMock = vi.fn().mockResolvedValue('');
const loadCoverPathMock = vi.fn().mockResolvedValue('');
const loadFullCoverMock = vi.fn().mockResolvedValue('');
const loadFullCoverPathMock = vi.fn().mockResolvedValue('');
const peekCoverUrlMock = vi.fn().mockReturnValue('');
const peekCoverPathMock = vi.fn().mockReturnValue('');
const getFullCoverUrlMock = vi.fn().mockReturnValue('');
const preloadFullCoversMock = vi.fn();
const preloadPriorityCoversMock = vi.fn();
const retainFullCoverPathsMock = vi.fn();
const primeCoverPathMock = vi.fn().mockReturnValue('');

vi.mock('../services/tauri/playbackApi', () => ({
  playbackApi: {
    playAudio: vi.fn().mockResolvedValue(undefined),
    updatePlaybackMetadata: vi.fn().mockResolvedValue(undefined),
    getPlaybackProgress: vi.fn().mockResolvedValue(0),
    pauseAudio: vi.fn().mockResolvedValue(undefined),
    resumeAudio: vi.fn().mockResolvedValue(undefined),
    seekAudio: vi.fn().mockResolvedValue(undefined),
    recordPlay: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./useCoverCache', () => ({
  useCoverCache: () => ({
    loadCover: loadCoverMock,
    loadCoverPath: loadCoverPathMock,
    loadFullCoverPath: loadFullCoverPathMock,
    loadFullCover: loadFullCoverMock,
    peekCoverUrl: peekCoverUrlMock,
    peekCoverPath: peekCoverPathMock,
    getFullCoverUrl: getFullCoverUrlMock,
    preloadFullCovers: preloadFullCoversMock,
    preloadPriorityCovers: preloadPriorityCoversMock,
    retainFullCoverPaths: retainFullCoverPathsMock,
    primeCoverPath: primeCoverPathMock,
  }),
}));

import type { Song } from '../types';
import { usePlaybackStore } from '../features/playback/store';
import { playbackApi } from '../services/tauri/playbackApi';
import { createPlayerPlayback } from './playerPlayback';
import { useUiStore } from '../shared/stores/ui';
import { setMainWindowRenderingSnapshot } from './renderingPower';

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

describe('player playback domain', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(playbackApi.playAudio).mockResolvedValue(1);
    vi.mocked(playbackApi.getPlaybackProgress).mockResolvedValue(0);
    loadCoverMock.mockResolvedValue('');
    loadCoverPathMock.mockResolvedValue('');
    loadFullCoverPathMock.mockResolvedValue('');
    loadFullCoverMock.mockResolvedValue('');
    peekCoverUrlMock.mockReturnValue('');
    peekCoverPathMock.mockReturnValue('');
    getFullCoverUrlMock.mockReturnValue('');
    preloadFullCoversMock.mockReset();
    preloadPriorityCoversMock.mockReset();
    retainFullCoverPathsMock.mockReset();
    primeCoverPathMock.mockReturnValue('');
    setMainWindowRenderingSnapshot({
      documentHidden: false,
      windowFocused: true,
      windowVisible: true,
      windowMinimized: false,
      miniMode: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stops a failed playback attempt and ignores an in-flight progress response', async () => {
    vi.useFakeTimers();
    const playbackStore = usePlaybackStore();
    const onPlaybackError = vi.fn();
    const handleAutoNext = vi.fn();
    let resolveProgress!: (time: number) => void;
    vi.mocked(playbackApi.playAudio).mockResolvedValueOnce(42);
    vi.mocked(playbackApi.getPlaybackProgress).mockReturnValueOnce(new Promise(resolve => {
      resolveProgress = resolve;
    }));
    const playerPlayback = createPlayerPlayback({
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext,
      onPlaybackError,
    });
    await playerPlayback.playSong(makeSong());
    await vi.advanceTimersByTimeAsync(1000);

    playerPlayback.handlePlaybackError({ playbackId: 41, message: 'old track' });
    expect(playbackStore.isPlaying).toBe(true);
    playerPlayback.handlePlaybackError({ playbackId: 42, message: 'invalid audio' });
    const failedAt = playbackStore.currentTime;
    expect(playbackStore.isPlaying).toBe(false);
    expect(playbackStore.isSongLoaded).toBe(false);
    expect(onPlaybackError).toHaveBeenCalledWith('播放失败：invalid audio');
    expect(vi.getTimerCount()).toBe(0);

    resolveProgress(99);
    await Promise.resolve();
    expect(playbackStore.currentTime).toBe(failedAt);
    playerPlayback.handlePlaybackError({ playbackId: 42, message: 'duplicate' });
    expect(onPlaybackError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(handleAutoNext).not.toHaveBeenCalled();
    playerPlayback.dispose();
  });

  it('retains an error received before playAudio returns its playback ID', async () => {
    vi.useFakeTimers();
    const playbackStore = usePlaybackStore();
    const onPlaybackError = vi.fn();
    const loadLyrics = vi.fn();
    let resolvePlay!: (id: number) => void;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise(resolve => {
      resolvePlay = resolve;
    }));
    const playerPlayback = createPlayerPlayback({
      addToHistory: vi.fn(), loadLyrics, handleAutoNext: vi.fn(), onPlaybackError,
    });
    const playing = playerPlayback.playSong(makeSong());
    playerPlayback.handlePlaybackError({ playbackId: 41, message: 'old track' });
    playerPlayback.handlePlaybackError({ playbackId: 42, message: 'decode failed' });
    resolvePlay(42);
    await playing;

    expect(playbackStore.currentPlaybackId).toBe(42);
    expect(playbackStore.isPlaying).toBe(false);
    expect(playbackStore.isSongLoaded).toBe(false);
    expect(loadLyrics).not.toHaveBeenCalled();
    expect(onPlaybackError).toHaveBeenCalledExactlyOnceWith('播放失败：decode failed');
    expect(vi.getTimerCount()).toBe(0);
    playerPlayback.dispose();
  });

  it('ignores a buffered error belonging to the previous playback attempt', async () => {
    const playbackStore = usePlaybackStore();
    const onPlaybackError = vi.fn();
    let resolvePlay!: (id: number) => void;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise(resolve => {
      resolvePlay = resolve;
    }));
    const playerPlayback = createPlayerPlayback({
      addToHistory: vi.fn(), loadLyrics: vi.fn(), handleAutoNext: vi.fn(), onPlaybackError,
    });
    const playing = playerPlayback.playSong(makeSong());
    playerPlayback.handlePlaybackError({ playbackId: 41, message: 'old track' });
    resolvePlay(42);
    await playing;

    expect(playbackStore.isPlaying).toBe(true);
    expect(playbackStore.isSongLoaded).toBe(true);
    expect(onPlaybackError).not.toHaveBeenCalled();
    playerPlayback.dispose();
  });

  it('does not restart a failed unloaded song after togglePlay awaits its request', async () => {
    vi.useFakeTimers();
    const playbackStore = usePlaybackStore();
    playbackStore.currentSong = makeSong();
    let resolvePlay!: (id: number) => void;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise(resolve => {
      resolvePlay = resolve;
    }));
    const playerPlayback = createPlayerPlayback({
      addToHistory: vi.fn(), loadLyrics: vi.fn(), handleAutoNext: vi.fn(),
    });
    const toggling = playerPlayback.togglePlay();
    playerPlayback.handlePlaybackError({ playbackId: 42, message: 'decode failed' });
    resolvePlay(42);
    await toggling;

    expect(playbackStore.isPlaying).toBe(false);
    expect(playbackStore.isSongLoaded).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    playerPlayback.dispose();
  });

  it('does not restart seek timers or apply stale seek completion after a playback error', async () => {
    vi.useFakeTimers();
    const playbackStore = usePlaybackStore();
    const playerPlayback = createPlayerPlayback({
      addToHistory: vi.fn(), loadLyrics: vi.fn(), handleAutoNext: vi.fn(),
    });
    vi.mocked(playbackApi.playAudio).mockResolvedValueOnce(42);
    await playerPlayback.playSong(makeSong());
    let resolveSeek!: () => void;
    vi.mocked(playbackApi.seekAudio).mockReturnValueOnce(new Promise(resolve => {
      resolveSeek = resolve;
    }));
    const seeking = playerPlayback.seekTo(50);
    const seekCalls = vi.mocked(playbackApi.seekAudio).mock.calls;
    const seekRequestId = seekCalls[seekCalls.length - 1][0].requestId;
    playerPlayback.handlePlaybackError({ playbackId: 42, message: 'seek failed' });
    resolveSeek();
    await seeking;
    playerPlayback.handleSeekCompleted({ request_id: seekRequestId, time: 99 });

    expect(playbackStore.isPlaying).toBe(false);
    expect(playbackStore.isSongLoaded).toBe(false);
    expect(playbackStore.currentTime).toBe(50);
    expect(vi.getTimerCount()).toBe(0);
    playerPlayback.dispose();
  });

  it('does not apply an old progress response after switching songs', async () => {
    vi.useFakeTimers();
    const playbackStore = usePlaybackStore();
    let resolveProgress!: (time: number) => void;
    vi.mocked(playbackApi.getPlaybackProgress).mockReturnValueOnce(new Promise(resolve => {
      resolveProgress = resolve;
    }));
    const playerPlayback = createPlayerPlayback({
      addToHistory: vi.fn(), loadLyrics: vi.fn(), handleAutoNext: vi.fn(),
    });
    await playerPlayback.playSong(makeSong({ path: '/old.flac' }));
    await vi.advanceTimersByTimeAsync(1000);
    await playerPlayback.playSong(makeSong({ path: '/new.flac' }), { startTime: 25 });
    resolveProgress(99);
    await Promise.resolve();

    expect(playbackStore.currentTime).toBe(25);
    expect(playbackStore.isPlaying).toBe(true);
    playerPlayback.dispose();
  });

  it.each(['before seek acknowledgment', 'during the delayed resume'])('does not retry playAt after an error %s', async (timing) => {
    vi.useFakeTimers();
    const playbackStore = usePlaybackStore();
    const playerPlayback = createPlayerPlayback({
      addToHistory: vi.fn(), loadLyrics: vi.fn(), handleAutoNext: vi.fn(),
    });
    vi.mocked(playbackApi.playAudio).mockResolvedValueOnce(42);
    await playerPlayback.playSong(makeSong());
    await playerPlayback.pauseSong();
    let resolveSeek!: () => void;
    vi.mocked(playbackApi.seekAudio).mockReturnValueOnce(new Promise(resolve => {
      resolveSeek = resolve;
    }));
    const playingAt = playerPlayback.playAt(50);
    if (timing === 'before seek acknowledgment') {
      playerPlayback.handlePlaybackError({ playbackId: 42, message: 'seek failed' });
    }
    resolveSeek();
    await playingAt;
    if (timing === 'during the delayed resume') {
      playerPlayback.handlePlaybackError({ playbackId: 42, message: 'seek failed' });
    }
    await vi.advanceTimersByTimeAsync(200);

    expect(playbackStore.isPlaying).toBe(false);
    expect(playbackStore.isSongLoaded).toBe(false);
    expect(playbackApi.playAudio).toHaveBeenCalledTimes(1);
    expect(playbackApi.resumeAudio).not.toHaveBeenCalled();
    playerPlayback.dispose();
  });

  it.each([
    ['a near-end decoder stall', 0.8],
    ['metadata shorter than the decoded audio', 3],
  ])('waits for backend EOF during %s', async (_label, backendProgress) => {
    vi.useFakeTimers();
    const playbackStore = usePlaybackStore();
    const handleAutoNext = vi.fn();
    vi.mocked(playbackApi.getPlaybackProgress).mockResolvedValue(backendProgress);
    const playerPlayback = createPlayerPlayback({
      addToHistory: vi.fn(), loadLyrics: vi.fn(), handleAutoNext,
    });
    await playerPlayback.playSong(makeSong({ duration: 1 }), { startTime: 0.8 });
    await vi.advanceTimersByTimeAsync(2500);

    expect(playbackStore.isPlaying).toBe(true);
    expect(handleAutoNext).not.toHaveBeenCalled();
    expect(playbackApi.getPlaybackProgress).toHaveBeenCalledTimes(2);
    playerPlayback.dispose();
  });

  it('advances only for a matching EOF while a song is playing', async () => {
    const playbackStore = usePlaybackStore();
    const handleAutoNext = vi.fn();
    vi.mocked(playbackApi.playAudio).mockResolvedValueOnce(42);
    const playerPlayback = createPlayerPlayback({
      addToHistory: vi.fn(), loadLyrics: vi.fn(), handleAutoNext,
    });
    const song = makeSong();
    await playerPlayback.playSong(song);
    playerPlayback.handlePlaybackFinished({ playbackId: 41 });
    playbackStore.isPlaying = false;
    playerPlayback.handlePlaybackFinished({ playbackId: 42 });
    playbackStore.isPlaying = true;
    playbackStore.currentSong = null;
    playerPlayback.handlePlaybackFinished({ playbackId: 42 });
    expect(handleAutoNext).not.toHaveBeenCalled();

    playbackStore.currentSong = song;
    playerPlayback.handlePlaybackFinished({ playbackId: 42 });
    playerPlayback.handlePlaybackFinished({ playbackId: 42 });
    expect(handleAutoNext).toHaveBeenCalledTimes(1);
    playerPlayback.dispose();
  });

  it.each([
    ['the current attempt', 42, 1],
    ['a stale attempt', 41, 0],
  ])('retains early EOF for %s until the playback ID is known', async (_label, eventId, expectedAdvances) => {
    const playbackStore = usePlaybackStore();
    const handleAutoNext = vi.fn();
    let resolvePlay!: (id: number) => void;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise(resolve => {
      resolvePlay = resolve;
    }));
    const playerPlayback = createPlayerPlayback({
      addToHistory: vi.fn(), loadLyrics: vi.fn(), handleAutoNext,
    });
    const playing = playerPlayback.playSong(makeSong({ duration: 0.01 }));
    playerPlayback.handlePlaybackFinished({ playbackId: eventId });
    expect(handleAutoNext).not.toHaveBeenCalled();
    resolvePlay(42);
    await playing;

    expect(playbackStore.currentPlaybackId).toBe(42);
    expect(handleAutoNext).toHaveBeenCalledTimes(expectedAdvances);
    playerPlayback.dispose();
  });

  it('accepts another real EOF after seeking and resuming the same playback ID', async () => {
    const playbackStore = usePlaybackStore();
    const handleAutoNext = vi.fn();
    vi.mocked(playbackApi.playAudio).mockResolvedValueOnce(42);
    const playerPlayback = createPlayerPlayback({
      addToHistory: vi.fn(), loadLyrics: vi.fn(), handleAutoNext,
    });
    await playerPlayback.playSong(makeSong());
    playerPlayback.handlePlaybackFinished({ playbackId: 42 });
    expect(handleAutoNext).toHaveBeenCalledTimes(1);
    await playerPlayback.pauseSong();
    await playerPlayback.seekTo(0);
    await playerPlayback.togglePlay();
    expect(playbackStore.currentPlaybackId).toBe(42);

    playerPlayback.handlePlaybackFinished({ playbackId: 42 });
    playerPlayback.handlePlaybackFinished({ playbackId: 42 });
    expect(handleAutoNext).toHaveBeenCalledTimes(2);
    playerPlayback.dispose();
  });

  it('rebuilds the queue from the display song list order when playback starts', async () => {
    const playbackStore = usePlaybackStore();
    const firstSong = makeSong({ path: '/music/first.flac', title: 'First' });
    const secondSong = makeSong({ path: '/music/second.flac', title: 'Second' });
    const displaySongList = [firstSong, secondSong];
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => displaySongList,
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(firstSong);

    expect(playbackStore.playQueuePaths).toEqual(displaySongList.map(song => song.path));
    playerPlayback.dispose();
  });

  it('preserves the restored queue when playback resumes before audio is loaded', async () => {
    const playbackStore = usePlaybackStore();
    const restoredSong = makeSong({ path: '/music/folder-a/restored.flac', title: 'Restored' });
    const queuedSong = makeSong({ path: '/music/folder-a/queued.flac', title: 'Queued' });
    const otherFolderSong = makeSong({ path: '/music/folder-b/other.flac', title: 'Other' });
    const restoredQueuePaths = [restoredSong.path, queuedSong.path];
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [restoredSong, queuedSong, otherFolderSong],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    playbackStore.currentSong = restoredSong;
    playbackStore.currentTime = 42;
    playbackStore.isSongLoaded = false;
    playbackStore.playQueuePaths = restoredQueuePaths;

    await playerPlayback.togglePlay();

    expect(playbackStore.playQueuePaths).toEqual(restoredQueuePaths);
    expect(playbackApi.playAudio).toHaveBeenCalledWith(expect.objectContaining({
      path: restoredSong.path,
      startOffsetMs: 42_000,
    }));
    playerPlayback.dispose();
  });

  it('inserts a searched song directly after the previously playing song', async () => {
    const playbackStore = usePlaybackStore();
    const songA = makeSong({ path: '/music/a.flac', title: 'A' });
    const songB = makeSong({ path: '/music/b.flac', title: 'B' });
    const songC = makeSong({ path: '/music/c.flac', title: 'C' });
    const songD = makeSong({ path: '/music/d.flac', title: 'D' });
    const searchedSong = makeSong({ path: '/music/search.flac', title: 'Search' });
    playbackStore.currentSong = songA;
    playbackStore.playQueue = [songA, songB, songC, songD];

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [searchedSong],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(searchedSong, { insertAfterCurrent: true });

    expect(playbackStore.currentSong?.path).toBe(searchedSong.path);
    expect(playbackStore.playQueuePaths).toEqual([
      songA.path,
      searchedSong.path,
      songB.path,
      songC.path,
      songD.path,
    ]);
    playerPlayback.dispose();
  });

  it('prefers tagged song title when reporting playback metadata', async () => {
    const song = makeSong({ name: 'i-dle - Allergy.flac', title: 'Allergy' });
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);

    expect(playbackApi.playAudio).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Allergy',
    }));
    playerPlayback.dispose();
  });

  it('does not auto-advance songs with unknown duration', async () => {
    const song = makeSong({ path: 'remote://source/demo.flac', duration: 0 });
    const handleAutoNext = vi.fn();
    let progressCallback: (() => void) | undefined;
    vi
      .stubGlobal('setTimeout', (callback: () => void) => {
        progressCallback = callback;
        return 1;
      });
    vi.stubGlobal('clearTimeout', () => {});
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext,
    });

    await playerPlayback.playSong(song);
    expect(progressCallback).toBeDefined();
    (progressCallback as () => void)();

    expect(handleAutoNext).not.toHaveBeenCalled();

    playerPlayback.dispose();
    vi.unstubAllGlobals();
  });

  it('updates playback progress with a low-frequency timer while main window rendering is low power', async () => {
    const song = makeSong({ duration: 180 });
    const handleAutoNext = vi.fn();
    const requestAnimationFrameMock = vi.fn();
    const setTimeoutMock = vi.fn().mockReturnValue(7);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('setTimeout', setTimeoutMock);
    vi.stubGlobal('clearTimeout', vi.fn());
    setMainWindowRenderingSnapshot({ windowVisible: false });

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext,
    });

    await playerPlayback.playSong(song);

    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
    expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 1000);

    playerPlayback.dispose();
    vi.unstubAllGlobals();
  });

  it('updates global playback progress with a low-frequency timer during normal rendering', async () => {
    const song = makeSong({ duration: 180 });
    const handleAutoNext = vi.fn();
    const requestAnimationFrameMock = vi.fn();
    const setTimeoutMock = vi.fn().mockReturnValue(7);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('setTimeout', setTimeoutMock);
    vi.stubGlobal('clearTimeout', vi.fn());

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext,
    });

    await playerPlayback.playSong(song);

    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
    expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 100);

    playerPlayback.dispose();
    vi.unstubAllGlobals();
  });

  it('keeps cue track time relative when the backend confirms an absolute seek position', async () => {
    const playbackStore = usePlaybackStore();
    const song = makeSong({
      path: '/music/album.cue::track02',
      cue_source_path: '/music/album.flac',
      cue_start_offset: 180_000,
      cue_end_offset: 300_000,
      duration: 120,
    });
    playbackStore.currentSong = song;

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.seekTo(10);

    const seekRequest = vi.mocked(playbackApi.seekAudio).mock.calls[0]?.[0];
    expect(seekRequest).toEqual(expect.objectContaining({
      time: 190,
    }));

    playerPlayback.handleSeekCompleted({
      request_id: seekRequest.requestId,
      time: seekRequest.time,
    });

    expect(playbackStore.currentTime).toBe(10);
    playerPlayback.dispose();
  });

  it('hydrates runtime metadata before starting playback', async () => {
    const playbackStore = usePlaybackStore();
    const song = makeSong({ path: '/music/album.cue::track02', duration: 120 });
    const resolveSongForPlayback = vi.fn(async (value: Song) => Object.assign(value, {
      id: 42,
      cue_source_path: '/music/album.flac',
      cue_start_offset: 180_000,
      cue_end_offset: 300_000,
    }));
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
      resolveSongForPlayback,
    });

    await playerPlayback.playSong(song);

    expect(resolveSongForPlayback).toHaveBeenCalledWith(song);
    expect(playbackStore.currentSong).toMatchObject({
      path: song.path,
      id: 42,
      cue_source_path: '/music/album.flac',
      cue_start_offset: 180_000,
    });
    expect(playbackApi.playAudio).toHaveBeenCalledWith(expect.objectContaining({
      path: '/music/album.flac',
      songId: 42,
      cueStartOffsetMs: 180_000,
      startOffsetMs: 180_000,
    }));
    playerPlayback.dispose();
  });

  it('does not pass durationMs or cueStartOffsetMs for standalone songs to allow natural EOF', async () => {
    const song = makeSong({ path: '/music/track.mp3', duration: 240 });
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);

    expect(playbackApi.playAudio).toHaveBeenCalledWith(expect.objectContaining({
      path: '/music/track.mp3',
      duration: 240,
      durationMs: undefined,
      cueStartOffsetMs: undefined,
    }));
    playerPlayback.dispose();
  });

  it('passes durationMs and cueStartOffsetMs for CUE tracks including track 1 starting at 0ms', async () => {
    const song = makeSong({
      path: '/music/album.cue::track01',
      cue_source_path: '/music/album.flac',
      cue_start_offset: 0,
      duration: 240,
    });
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);

    expect(playbackApi.playAudio).toHaveBeenCalledWith(expect.objectContaining({
      path: '/music/album.flac',
      duration: 240,
      durationMs: 240_000,
      cueStartOffsetMs: 0,
    }));
    playerPlayback.dispose();
  });

  it('re-anchors playback clock when seeking to beginning after playing', async () => {
    const playbackStore = usePlaybackStore();
    const song = makeSong({ path: '/music/song.mp3', duration: 240 });
    playbackStore.currentSong = song;
    playbackStore.currentTime = 180;
    playbackStore.isPlaying = true;

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.seekTo(0);

    expect(playbackApi.seekAudio).toHaveBeenCalledWith(expect.objectContaining({
      time: 0,
      isPlaying: true,
    }));
    expect(playbackStore.currentTime).toBe(0);
    playerPlayback.dispose();
  });

  it('strips the file extension when title metadata is missing', async () => {
    const song = makeSong({ name: 'i-dle - Allergy.flac', title: '   ' });
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);

    expect(playbackApi.playAudio).toHaveBeenCalledWith(expect.objectContaining({
      title: 'i-dle - Allergy',
    }));
    playerPlayback.dispose();
  });

  it('updates the full-size cover state when switching songs in the player detail view', async () => {
    const playbackStore = usePlaybackStore();
    const uiStore = useUiStore();
    const song = makeSong({ path: '/music/full-cover.flac', title: 'Full Cover' });

    uiStore.showPlayerDetail = true;
    loadCoverMock.mockResolvedValue('thumb-url');
    loadFullCoverMock.mockResolvedValue('full-url');

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);
    await Promise.resolve();

    expect(loadFullCoverMock).toHaveBeenCalledWith(song.path);
    expect(playbackStore.currentCoverFull).toBe('full-url');
    playerPlayback.dispose();
  });

  it('starts loading the current thumbnail before the audio backend finishes switching songs', async () => {
    const song = makeSong({ path: '/music/current-thumbnail.flac', title: 'Current Thumbnail' });
    let resolvePlayAudio!: (val?: any) => void;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<any>((resolve) => {
      resolvePlayAudio = resolve;
    }));

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    const playPromise = playerPlayback.playSong(song);

    expect(loadCoverMock).toHaveBeenCalledWith(song.path);

    resolvePlayAudio();
    await playPromise;
    playerPlayback.dispose();
  });

  it('uses the persisted thumbnail path immediately when switching songs', async () => {
    const playbackStore = usePlaybackStore();
    const song = makeSong({
      path: '/music/persisted-thumb.flac',
      title: 'Persisted Thumb',
      cover_thumb_path: 'C:\\covers\\persisted-thumb.jpg',
    });
    let resolvePlayAudio!: (val?: any) => void;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<any>((resolve) => {
      resolvePlayAudio = resolve;
    }));
    primeCoverPathMock.mockReturnValue('asset://C:\\covers\\persisted-thumb.jpg');

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    const playPromise = playerPlayback.playSong(song);

    expect(primeCoverPathMock).toHaveBeenCalledWith(song.path, song.cover_thumb_path);
    expect(playbackStore.currentCover).toBe('asset://C:\\covers\\persisted-thumb.jpg');
    expect(loadCoverMock).toHaveBeenCalledWith(song.path);

    resolvePlayAudio();
    await playPromise;
    playerPlayback.dispose();
  });

  it('keeps the previous visible cover while the next thumbnail is loading', async () => {
    const playbackStore = usePlaybackStore();
    const oldCover = 'asset://C:\\covers\\old-thumb.jpg';
    const song = makeSong({ path: '/music/cold-hdd.flac', title: 'Cold HDD' });
    let resolvePlayAudio!: (val?: any) => void;
    playbackStore.currentCover = oldCover;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<any>((resolve) => {
      resolvePlayAudio = resolve;
    }));

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    const playPromise = playerPlayback.playSong(song);

    expect(playbackStore.currentCover).toBe(oldCover);

    resolvePlayAudio();
    await playPromise;
    playerPlayback.dispose();
  });

  it('does not carry the previous full cover into the next song detail view', async () => {
    const playbackStore = usePlaybackStore();
    const uiStore = useUiStore();
    const oldCover = 'asset://C:\\covers\\old-thumb.jpg';
    const oldFullCover = 'asset://C:\\covers\\old-full.png';
    const song = makeSong({ path: '/music/new-song.flac', title: 'New Song' });
    let resolvePlayAudio!: (val?: any) => void;
    uiStore.showPlayerDetail = true;
    playbackStore.currentCover = oldCover;
    playbackStore.currentCoverPath = '/music/old-song.flac';
    playbackStore.currentCoverFull = oldFullCover;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<any>((resolve) => {
      resolvePlayAudio = resolve;
    }));

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    const playPromise = playerPlayback.playSong(song);

    expect(playbackStore.currentCover).toBe(oldCover);
    expect(playbackStore.currentCoverPath).toBe('/music/old-song.flac');
    expect(playbackStore.currentCoverFull).toBe('');

    resolvePlayAudio();
    await playPromise;
    playerPlayback.dispose();
  });

  it('prepares likely full-size covers before switching songs in the player detail view', async () => {
    const playbackStore = usePlaybackStore();
    const uiStore = useUiStore();
    const previousSong = makeSong({ path: '/music/previous.flac', title: 'Previous' });
    const song = makeSong({ path: '/music/current.flac', title: 'Current' });
    const nextSong = makeSong({ path: '/music/next.flac', title: 'Next' });
    const tempSong = makeSong({ path: '/music/temp.flac', title: 'Temp' });

    uiStore.showPlayerDetail = true;
    playbackStore.currentSong = previousSong;
    playbackStore.playQueue = [previousSong, song, nextSong];
    playbackStore.tempQueue = [tempSong];

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [previousSong, song, nextSong],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song, { preserveQueue: true });

    expect(retainFullCoverPathsMock).toHaveBeenCalledWith([
      song.path,
      tempSong.path,
      previousSong.path,
      nextSong.path,
    ]);
    expect(preloadFullCoversMock).toHaveBeenCalledWith([
      tempSong.path,
      previousSong.path,
      nextSong.path,
    ]);
    playerPlayback.dispose();
  });
});
