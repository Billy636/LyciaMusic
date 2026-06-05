import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const loadCoverMock = vi.fn().mockResolvedValue('');
const loadCoverPathMock = vi.fn().mockResolvedValue('');
const loadFullCoverMock = vi.fn().mockResolvedValue('');
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
    loadCoverMock.mockResolvedValue('');
    loadCoverPathMock.mockResolvedValue('');
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

    expect(playbackStore.playQueue.map(song => song.path)).toEqual(displaySongList.map(song => song.path));
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
    expect(playbackStore.playQueue.map(song => song.path)).toEqual([
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
    let frameCallback: FrameRequestCallback | undefined;
    vi
      .stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frameCallback = callback;
        return 1;
      });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext,
    });

    await playerPlayback.playSong(song);
    expect(frameCallback).toBeDefined();
    (frameCallback as FrameRequestCallback)(performance.now() + 16);

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
    let resolvePlayAudio!: () => void;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<void>((resolve) => {
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
    primeCoverPathMock.mockReturnValue('asset://C:\\covers\\persisted-thumb.jpg');

    const playerPlayback = createPlayerPlayback({
      getDisplaySongList: () => [song],
      addToHistory: vi.fn(),
      loadLyrics: vi.fn(),
      handleAutoNext: vi.fn(),
    });

    await playerPlayback.playSong(song);

    expect(primeCoverPathMock).toHaveBeenCalledWith(song.path, song.cover_thumb_path);
    expect(playbackStore.currentCover).toBe('asset://C:\\covers\\persisted-thumb.jpg');
    expect(loadCoverMock).toHaveBeenCalledWith(song.path);
    playerPlayback.dispose();
  });

  it('keeps the previous visible cover while the next thumbnail is loading', async () => {
    const playbackStore = usePlaybackStore();
    const oldCover = 'asset://C:\\covers\\old-thumb.jpg';
    const song = makeSong({ path: '/music/cold-hdd.flac', title: 'Cold HDD' });
    let resolvePlayAudio!: () => void;
    playbackStore.currentCover = oldCover;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<void>((resolve) => {
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
    let resolvePlayAudio!: () => void;
    uiStore.showPlayerDetail = true;
    playbackStore.currentCover = oldCover;
    playbackStore.currentCoverPath = '/music/old-song.flac';
    playbackStore.currentCoverFull = oldFullCover;
    vi.mocked(playbackApi.playAudio).mockReturnValueOnce(new Promise<void>((resolve) => {
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
