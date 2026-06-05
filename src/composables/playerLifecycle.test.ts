import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import type { Song } from '../types';

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  setVolume: vi.fn().mockResolvedValue(undefined),
  setOutputDevice: vi.fn().mockResolvedValue(undefined),
  setAudioOutputMode: vi.fn().mockResolvedValue(undefined),
  updateLoudnessSettings: vi.fn().mockResolvedValue(undefined),
  getRemoteSources: vi.fn().mockResolvedValue([]),
  syncRemoteSource: vi.fn().mockResolvedValue(undefined),
  precacheRemoteSong: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('../services/tauri/playbackApi', () => ({
  playbackApi: {
    setVolume: mocks.setVolume,
    setOutputDevice: mocks.setOutputDevice,
    setAudioOutputMode: mocks.setAudioOutputMode,
    updateLoudnessSettings: mocks.updateLoudnessSettings,
  },
}));

vi.mock('../services/tauri/remoteLibraryApi', () => ({
  remoteLibraryApi: {
    getRemoteSources: mocks.getRemoteSources,
    syncRemoteSource: mocks.syncRemoteSource,
    precacheRemoteSong: mocks.precacheRemoteSong,
  },
}));

vi.mock('./colorExtraction', () => ({
  clearPaletteCache: vi.fn(),
  extractDominantColors: vi.fn().mockResolvedValue([]),
}));

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: 'remote://source/demo.mp3',
  name: 'demo.mp3',
  title: 'Demo',
  artist: '未知歌手',
  artist_names: ['未知歌手'],
  effective_artist_names: ['未知歌手'],
  album: '未知专辑',
  album_artist: '未知歌手',
  album_key: '未知专辑::未知歌手',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 0,
  bitrate: 0,
  sample_rate: 0,
  format: 'mp3',
  source_type: 'remote',
  remote_source_id: 'source',
  ...overrides,
});

const createLifecycleDeps = (loadLyrics = vi.fn()) => ({
  bootstrapLibrary: vi.fn().mockResolvedValue(undefined),
  togglePlay: vi.fn(),
  nextSong: vi.fn(),
  prevSong: vi.fn(),
  applyLibraryScanBatch: vi.fn(),
  flushBufferedLibraryScanBatch: vi.fn(),
  handleSeekCompleted: vi.fn(),
  schedulePersistedState: vi.fn(),
  flushPersistedState: vi.fn(),
  restorePathBackedState: vi.fn().mockResolvedValue(undefined),
  restoreRecentHistory: vi.fn().mockResolvedValue(undefined),
  refreshStateSongReferences: vi.fn(),
  loadLyrics,
  disposePlayerPlayback: vi.fn(),
  disposeLibraryRuntime: vi.fn(),
  disposePlayerPersistence: vi.fn(),
  disposeLibraryBatch: vi.fn(),
  lastSongPathKey: 'last-song-path',
  legacyLastSongKey: 'last-song',
});

const loadModules = async () => {
  const [
    { useLibraryStore },
    { usePlaybackStore },
    { useSettingsStore },
    { useUiStore },
    { createPlayerLifecycle },
    colorExtraction,
  ] = await Promise.all([
    import('../features/library/store'),
    import('../features/playback/store'),
    import('../features/settings/store'),
    import('../shared/stores/ui'),
    import('./playerLifecycle'),
    import('./colorExtraction'),
  ]);

  return {
    useLibraryStore,
    usePlaybackStore,
    useSettingsStore,
    useUiStore,
    createPlayerLifecycle,
    colorExtraction,
  };
};

describe('player lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.listen.mockResolvedValue(vi.fn());
  });

  it('extracts cover colors for desktop lyrics auto scheme when flow background is disabled', async () => {
    const {
      usePlaybackStore,
      useSettingsStore,
      useUiStore,
      createPlayerLifecycle,
      colorExtraction,
    } = await loadModules();
    const playbackStore = usePlaybackStore();
    const settingsStore = useSettingsStore();
    const uiStore = useUiStore();
    const extractDominantColors = vi.mocked(colorExtraction.extractDominantColors);
    extractDominantColors.mockResolvedValueOnce(['#111111', '#222222', '#333333', '#444444']);

    settingsStore.settings.theme.dynamicBgType = 'none';
    settingsStore.settings.desktopLyrics.colorScheme = 'auto';
    createPlayerLifecycle(createLifecycleDeps()).init();
    playbackStore.currentCover = 'http://asset.localhost/cover-thumb.png';

    await nextTick();
    await Promise.resolve();

    expect(extractDominantColors).toHaveBeenCalledWith(
      'http://asset.localhost/cover-thumb.png',
      4,
      { colorBoost: 25, depth: 30 },
    );
    expect(uiStore.dominantColors).toEqual(['#111111', '#222222', '#333333', '#444444']);
  });

  it('patches current remote song metadata when the backend finishes caching it', async () => {
    const {
      useLibraryStore,
      usePlaybackStore,
      createPlayerLifecycle,
    } = await loadModules();
    const callbacks = new Map<string, (event: { payload: unknown }) => void>();
    mocks.listen.mockImplementation((eventName: string, callback: (event: { payload: unknown }) => void) => {
      callbacks.set(eventName, callback);
      return Promise.resolve(vi.fn());
    });
    const libraryStore = useLibraryStore();
    const playbackStore = usePlaybackStore();
    const staleSong = makeSong();
    const parsedSong = makeSong({
      title: '一个像夏天一个像秋天',
      artist: '范玮琪',
      artist_names: ['范玮琪'],
      effective_artist_names: ['范玮琪'],
      album: '我们的纪念日',
      album_artist: '范玮琪',
      album_key: '我们的纪念日::范玮琪',
      duration: 249,
      bitrate: 320,
      sample_rate: 44100,
    });
    libraryStore.setSourceSongs([staleSong]);
    playbackStore.currentSong = staleSong;
    const loadLyrics = vi.fn();

    createPlayerLifecycle(createLifecycleDeps(loadLyrics)).init();

    callbacks.get('remote-lyrics-cache-ready')?.({
      payload: {
        uri: parsedSong.path,
        song: parsedSong,
      },
    });

    expect(playbackStore.currentSong?.artist).toBe('范玮琪');
    expect(playbackStore.currentSong?.album).toBe('我们的纪念日');
    expect(playbackStore.currentSong?.duration).toBe(249);
    expect(loadLyrics).toHaveBeenCalledTimes(1);
  });

  it('sends current song context when loudness settings change', async () => {
    const {
      usePlaybackStore,
      useSettingsStore,
      createPlayerLifecycle,
    } = await loadModules();
    const playbackStore = usePlaybackStore();
    const settingsStore = useSettingsStore();
    playbackStore.currentSong = makeSong({
      id: 42,
      path: 'C:\\Music\\album.cue::track01',
      cue_source_path: 'C:\\Music\\album.flac',
    });

    createPlayerLifecycle(createLifecycleDeps()).init();
    settingsStore.settings.audio.volumeBalance.enabled = true;
    settingsStore.settings.audio.volumeBalance.gainOffsetDb = -2;
    settingsStore.settings.audio.volumeBalance.preventClipping = false;

    await nextTick();
    await Promise.resolve();

    expect(mocks.updateLoudnessSettings).toHaveBeenLastCalledWith({
      enabled: true,
      songId: 42,
      songPath: 'C:\\Music\\album.flac',
      gainOffsetDb: -2,
      preventClipping: false,
    });
  });
});
