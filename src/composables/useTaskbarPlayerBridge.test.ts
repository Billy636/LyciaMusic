import { effectScope, isProxy, nextTick, type EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Song } from '../types';
import type { LyricLine, LyricsStatus } from './lyrics/types';
import {
  TASKBAR_PLAYER_PLAYBACK_EVENT,
  TASKBAR_PLAYER_READY_EVENT,
  TASKBAR_PLAYER_STATE_APPLIED_EVENT,
  TASKBAR_PLAYER_STATE_EVENT,
  TASKBAR_PLAYER_WINDOW_LABEL,
  type TaskbarPlayerPlaybackPayload,
  type TaskbarPlayerStatePayload,
} from '../features/taskbarPlayer/shared';
import { useTaskbarPlayerBridge } from './useTaskbarPlayerBridge';

declare const require: <T = unknown>(id: string) => T;

const mocks = vi.hoisted(() => {
  const { ref } = require('vue') as typeof import('vue');
  return {
    mounted: [] as Array<() => void | Promise<void>>,
    unmounted: [] as Array<() => void>,
    watchStops: [] as Array<() => void>,
    handlers: new Map<string, (event: { payload: unknown }) => void>(),
    settings: ref({ showTaskbarPlayer: false, closeToTray: true }),
    audioDelay: ref(0),
    currentSong: ref<Song | null>(null),
    currentTime: ref(0),
    isPlaying: ref(false),
    isDarkTheme: ref(true),
    parsedLyrics: ref<LyricLine[]>([]),
    lyricsStatus: ref<LyricsStatus>('idle'),
    fullscreen: false,
    loadCover: vi.fn<(path: string) => Promise<string>>(),
    emitTo: vi.fn<(label: string, event: string, payload: unknown) => Promise<void>>(),
    unlisten: vi.fn(),
    scaleUnlisten: vi.fn(),
    targetWindow: {
      setSize: vi.fn().mockResolvedValue(undefined),
      setPosition: vi.fn().mockResolvedValue(undefined),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      onScaleChanged: vi.fn(),
    },
  };
});

vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>();
  return {
    ...vue,
    onMounted: (hook: () => void | Promise<void>) => mocks.mounted.push(hook),
    onUnmounted: (hook: () => void) => mocks.unmounted.push(hook),
    // Mounted hooks register watchers after awaits; track those too so each test
    // has the same disposal boundary as a real component instance.
    watch: (...args: Parameters<typeof vue.watch>) => {
      const stop = vue.watch(...args);
      mocks.watchStops.push(stop);
      return stop;
    },
  };
});

vi.mock('@tauri-apps/api/dpi', () => ({
  LogicalPosition: class {
    constructor(public x: number, public y: number) {}
  },
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: mocks.emitTo,
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.handlers.set(event, handler);
    if (event === 'taskbar-player:ready') handler({ payload: undefined });
    return mocks.unlisten;
  }),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn(async () => mocks.targetWindow) },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    onCloseRequested: vi.fn(async () => mocks.unlisten),
  })),
  primaryMonitor: vi.fn().mockResolvedValue(null),
  availableMonitors: vi.fn().mockResolvedValue([]),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === 'get_foreground_fullscreen_state') return { isFullscreen: mocks.fullscreen };
    return null;
  }),
}));

vi.mock('./useCoverCache', () => ({ useCoverCache: () => ({ loadCover: mocks.loadCover }) }));
vi.mock('./player', () => ({
  usePlayer: () => ({
    currentSong: mocks.currentSong,
    currentTime: mocks.currentTime,
    isPlaying: mocks.isPlaying,
    togglePlay: vi.fn(),
    prevSong: vi.fn(),
    nextSong: vi.fn(),
  }),
}));
vi.mock('./lyrics', () => ({
  useLyrics: () => ({ parsedLyrics: mocks.parsedLyrics, lyricsStatus: mocks.lyricsStatus }),
}));
vi.mock('./useThemeSettings', () => ({ useThemeSettings: () => ({ isDarkTheme: mocks.isDarkTheme }) }));
vi.mock('./mainWindowVisibility', () => ({ toggleMainWindowVisibility: vi.fn() }));
vi.mock('../features/settings/useSettings', () => ({
  useSettings: () => ({ settings: mocks.settings, audioDelay: mocks.audioDelay }),
}));

function song(path: string): Song {
  return {
    path, name: path, title: path, artist: 'Artist', artist_names: ['Artist'],
    effective_artist_names: ['Artist'], album: 'Album', album_artist: 'Artist',
    album_key: 'album', is_various_artists_album: false, collapse_artist_credits: false,
    duration: 180,
  };
}

function lyric(text: string): LyricLine {
  return { time: 10, endTime: 15, text, translation: '', romaji: '' };
}

function statePayloads() {
  return mocks.emitTo.mock.calls
    .filter(([, event]) => event === TASKBAR_PLAYER_STATE_EVENT)
    .map(([, , payload]) => payload as TaskbarPlayerStatePayload);
}

function playbackPayloads() {
  return mocks.emitTo.mock.calls
    .filter(([, event]) => event === TASKBAR_PLAYER_PLAYBACK_EVENT)
    .map(([, , payload]) => payload as TaskbarPlayerPlaybackPayload);
}

async function settle() {
  await nextTick();
  await vi.advanceTimersByTimeAsync(0);
}

let scope: EffectScope | null = null;

async function mountBridge(enabled = true) {
  mocks.settings.value.showTaskbarPlayer = enabled;
  scope = effectScope();
  scope.run(() => useTaskbarPlayerBridge());
  for (const hook of mocks.mounted) await scope.run(hook);
  await settle();
}

function unmountBridge() {
  mocks.unmounted.splice(0).forEach(hook => hook());
  scope?.stop();
  scope = null;
  mocks.watchStops.splice(0).forEach(stop => stop());
}

describe('taskbar player lyrics bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval });
    mocks.mounted.length = 0;
    mocks.unmounted.length = 0;
    mocks.handlers.clear();
    mocks.settings.value = { showTaskbarPlayer: false, closeToTray: true };
    mocks.audioDelay.value = 0.25;
    mocks.currentSong.value = song('first.mp3');
    mocks.currentTime.value = 12;
    mocks.isPlaying.value = true;
    mocks.isDarkTheme.value = true;
    mocks.parsedLyrics.value = [lyric('First lyric')];
    mocks.lyricsStatus.value = 'ready';
    mocks.fullscreen = false;
    mocks.loadCover.mockReset().mockImplementation(async path => `cover:${path}`);
    mocks.targetWindow.show.mockReset().mockResolvedValue(undefined);
    mocks.targetWindow.onScaleChanged.mockResolvedValue(mocks.scaleUnlisten);
    mocks.emitTo.mockReset().mockImplementation(async (_label, event) => {
      if (event === TASKBAR_PLAYER_STATE_EVENT) {
        mocks.handlers.get(TASKBAR_PLAYER_STATE_APPLIED_EVENT)?.({ payload: undefined });
      }
    });
  });

  afterEach(async () => {
    // Reset the module's window readiness before disposing its watchers.
    mocks.settings.value.showTaskbarPlayer = false;
    await settle();
    unmountBridge();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends a complete initial snapshot with serializable lyrics, sample clock and offset', async () => {
    await mountBridge();

    expect(statePayloads().length).toBeGreaterThan(0);
    expect(statePayloads()[0]).toMatchObject({
      currentSong: { path: 'first.mp3' }, songPath: 'first.mp3', coverUrl: 'cover:first.mp3',
      isDarkTheme: true, parsedLyrics: [lyric('First lyric')], lyricsStatus: 'ready',
      playbackTime: 12, syncedAt: 1_000_000, isPlaying: true, audioDelay: 0.25,
    });
    expect(isProxy(statePayloads()[0].parsedLyrics)).toBe(false);
    expect(mocks.emitTo).toHaveBeenCalledWith(
      TASKBAR_PLAYER_WINDOW_LABEL, TASKBAR_PLAYER_STATE_EVENT, statePayloads()[0],
    );
    expect(mocks.targetWindow.show).toHaveBeenCalledOnce();
  });

  it('coalesces progress into clock-only events without reloading covers or lyric documents', async () => {
    await mountBridge();
    mocks.emitTo.mockClear();
    mocks.loadCover.mockClear();

    mocks.currentTime.value = 12.1;
    await nextTick();
    await vi.advanceTimersByTimeAsync(100);
    mocks.currentTime.value = 12.2;
    await nextTick();
    await vi.advanceTimersByTimeAsync(150);

    expect(mocks.emitTo).toHaveBeenCalledExactlyOnceWith(
      TASKBAR_PLAYER_WINDOW_LABEL, TASKBAR_PLAYER_PLAYBACK_EVENT, {
        songPath: 'first.mp3', playbackTime: 12.2, syncedAt: 1_000_100,
        isPlaying: true, audioDelay: 0.25,
      },
    );
    mocks.audioDelay.value = -0.5;
    await nextTick();
    expect(playbackPayloads()[1]).toMatchObject({ audioDelay: -0.5, syncedAt: 1_000_100 });
    expect(statePayloads()).toEqual([]);
    expect(mocks.loadCover).not.toHaveBeenCalled();
  });

  it('rebases the clock on pause and resume even when currentTime does not change', async () => {
    await mountBridge();
    mocks.emitTo.mockClear();

    await vi.advanceTimersByTimeAsync(100);
    mocks.isPlaying.value = false;
    await nextTick();
    expect(playbackPayloads()[0]).toMatchObject({
      playbackTime: 12, syncedAt: 1_000_100, isPlaying: false,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    mocks.isPlaying.value = true;
    await nextTick();
    expect(playbackPayloads()[1]).toMatchObject({
      playbackTime: 12, syncedAt: 1_005_100, isPlaying: true,
    });
    expect(statePayloads()).toEqual([]);
  });

  it('publishes lyrics that arrive or are replaced while clearing stale lyrics during loading', async () => {
    mocks.lyricsStatus.value = 'loading';
    await mountBridge();
    expect(statePayloads()[0]).toMatchObject({ lyricsStatus: 'loading', parsedLyrics: [] });
    mocks.emitTo.mockClear();

    mocks.parsedLyrics.value = [lyric('Loaded lyric')];
    mocks.lyricsStatus.value = 'ready';
    await settle();
    expect(statePayloads()[0]).toMatchObject({
      lyricsStatus: 'ready', parsedLyrics: [lyric('Loaded lyric')],
    });

    mocks.parsedLyrics.value = [lyric('Replacement lyric')];
    await settle();
    expect(statePayloads()[1].parsedLyrics).toEqual([lyric('Replacement lyric')]);
    mocks.lyricsStatus.value = 'empty';
    await settle();
    expect(statePayloads()[2]).toMatchObject({ lyricsStatus: 'empty', parsedLyrics: [] });
  });

  it('omits the previous song lyrics before the next song has started reloading lyrics', async () => {
    await mountBridge();
    mocks.emitTo.mockClear();

    // playAudio can still be awaiting while the lyrics store reports A as ready.
    mocks.currentSong.value = song('second.mp3');
    await settle();

    expect(mocks.lyricsStatus.value).toBe('ready');
    expect(mocks.parsedLyrics.value).toEqual([lyric('First lyric')]);
    expect(statePayloads()).toHaveLength(1);
    expect(statePayloads()[0]).toMatchObject({
      currentSong: { path: 'second.mp3' }, songPath: 'second.mp3',
      lyricsStatus: 'ready', parsedLyrics: [],
    });

    mocks.parsedLyrics.value = [lyric('Second lyric')];
    await settle();
    expect(statePayloads()).toHaveLength(2);
    expect(statePayloads()[1]).toMatchObject({
      currentSong: { path: 'second.mp3' }, songPath: 'second.mp3',
      lyricsStatus: 'ready', parsedLyrics: [lyric('Second lyric')],
    });
  });

  it('refreshes lyrics that become ready while the initial window show is pending', async () => {
    mocks.lyricsStatus.value = 'loading';
    let finishShow!: () => void;
    mocks.targetWindow.show.mockImplementationOnce(() => new Promise<void>(resolve => { finishShow = resolve; }));
    await mountBridge();
    expect(mocks.targetWindow.show).toHaveBeenCalledOnce();
    expect(statePayloads()).toHaveLength(1);
    expect(statePayloads()[0]).toMatchObject({ lyricsStatus: 'loading', parsedLyrics: [] });

    mocks.parsedLyrics.value = [lyric('Loaded during show')];
    mocks.lyricsStatus.value = 'ready';
    await settle();
    expect(statePayloads()).toHaveLength(1);

    finishShow();
    await settle();
    expect(statePayloads()).toHaveLength(2);
    expect(statePayloads()[1]).toMatchObject({
      lyricsStatus: 'ready', parsedLyrics: [lyric('Loaded during show')],
    });
  });

  it('discards a slow old-song cover result after switching songs and receiving new lyrics', async () => {
    await mountBridge();
    mocks.emitTo.mockClear();
    let finishOldCover!: (cover: string) => void;
    mocks.loadCover.mockImplementationOnce(() => new Promise(resolve => { finishOldCover = resolve; }));
    mocks.parsedLyrics.value = [lyric('Old pending lyric')];
    await settle();

    mocks.currentSong.value = song('second.mp3');
    mocks.lyricsStatus.value = 'loading';
    await settle();
    expect(statePayloads()).toHaveLength(1);
    expect(statePayloads()[0]).toMatchObject({
      currentSong: { path: 'second.mp3' }, songPath: 'second.mp3',
      coverUrl: 'cover:second.mp3', parsedLyrics: [], lyricsStatus: 'loading',
    });

    mocks.parsedLyrics.value = [lyric('Second lyric')];
    mocks.lyricsStatus.value = 'ready';
    await settle();
    finishOldCover('cover:first-stale.mp3');
    await settle();

    expect(statePayloads()).toHaveLength(2);
    expect(statePayloads()[1]).toMatchObject({
      currentSong: { path: 'second.mp3' }, coverUrl: 'cover:second.mp3',
      parsedLyrics: [lyric('Second lyric')], lyricsStatus: 'ready',
    });
  });

  it('suppresses playback while disabled or fullscreen-hidden and cancels pending work on unmount', async () => {
    await mountBridge(false);
    mocks.currentTime.value = 13;
    mocks.isPlaying.value = false;
    await settle();
    await vi.advanceTimersByTimeAsync(300);
    expect(playbackPayloads()).toEqual([]);
    expect(statePayloads()).toEqual([]);
    expect(mocks.loadCover).not.toHaveBeenCalled();

    mocks.settings.value.showTaskbarPlayer = true;
    await nextTick();
    mocks.handlers.get(TASKBAR_PLAYER_READY_EVENT)?.({ payload: undefined });
    await settle();
    expect(mocks.targetWindow.show).toHaveBeenCalledOnce();
    mocks.emitTo.mockClear();
    mocks.loadCover.mockClear();

    // Queue a progress update just before fullscreen detection hides the window.
    await vi.advanceTimersByTimeAsync(900);
    mocks.currentTime.value = 14;
    await nextTick();
    mocks.fullscreen = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.targetWindow.hide).toHaveBeenCalledOnce();
    mocks.currentTime.value = 15;
    mocks.isPlaying.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    expect(playbackPayloads()).toEqual([]);
    expect(statePayloads()).toEqual([]);
    expect(mocks.loadCover).not.toHaveBeenCalled();

    mocks.fullscreen = false;
    await vi.advanceTimersByTimeAsync(700);
    expect(mocks.targetWindow.show).toHaveBeenCalledTimes(2);
    mocks.emitTo.mockClear();
    mocks.currentTime.value = 16;
    await nextTick();
    unmountBridge();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(playbackPayloads()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.unlisten).toHaveBeenCalledTimes(mocks.handlers.size + 1);
    expect(mocks.scaleUnlisten).toHaveBeenCalledOnce();
  });
});
