import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { shouldAutoHideDesktopLyrics, useDesktopLyricsWindowController } from './useDesktopLyricsWindowController';
import {
  DESKTOP_LYRICS_BOUNDS_EVENT,
  DESKTOP_LYRICS_STATE_EVENT,
  type DesktopLyricsStatePayload,
  type DesktopLyricsWindowSettings,
} from '../features/desktopLyrics/shared';

const mocks = vi.hoisted(() => ({
  mounted: [] as Array<() => unknown>,
  unmounted: [] as Array<() => unknown>,
  emitTo: vi.fn(),
  stateHandler: null as ((event: { payload: DesktopLyricsStatePayload }) => void) | null,
  movedHandler: null as ((event: { payload: { x: number; y: number } }) => Promise<void>) | null,
  resizedHandler: null as ((event: { payload: { width: number; height: number } }) => Promise<void>) | null,
  appWindow: {
    setIgnoreCursorEvents: vi.fn().mockResolvedValue(undefined),
    setFocusable: vi.fn().mockResolvedValue(undefined),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
    outerPosition: vi.fn().mockResolvedValue({ x: -1800, y: 1500 }),
    outerSize: vi.fn().mockResolvedValue({ width: 900, height: 280 }),
    listen: vi.fn(),
    onMoved: vi.fn(),
    onResized: vi.fn(),
    onCloseRequested: vi.fn().mockResolvedValue(() => {}),
  },
}));

vi.mock('vue', async importOriginal => ({
  ...await importOriginal<typeof import('vue')>(),
  onMounted: (callback: () => unknown) => { mocks.mounted.push(callback); },
  onUnmounted: (callback: () => unknown) => { mocks.unmounted.push(callback); },
}));

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: mocks.emitTo,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mocks.appWindow,
  currentMonitor: vi.fn().mockResolvedValue({ workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } } }),
  availableMonitors: vi.fn().mockResolvedValue([]),
  cursorPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
}));

vi.mock('./lyrics', () => ({
  loadSystemLyricsFonts: vi.fn(),
}));

vi.mock('../services/tauri/windowApi', () => ({
  windowApi: {
    getForegroundFullscreenState: vi.fn(),
    refreshCurrentWindowTopmost: vi.fn(),
    startTopmostGuard: vi.fn(),
    stopTopmostGuard: vi.fn(),
  },
}));

describe('desktop lyrics window controller helpers', () => {
  it('auto-hides when playback is paused and pause auto-hide is enabled', () => {
    expect(shouldAutoHideDesktopLyrics({
      autoHideWhenFullscreen: false,
      autoHideWhenPaused: true,
      isForegroundFullscreen: false,
      isPlaying: false,
      isResizeInteractionActive: false,
    })).toBe(true);
  });

  it('keeps desktop lyrics visible while playing when only pause auto-hide is enabled', () => {
    expect(shouldAutoHideDesktopLyrics({
      autoHideWhenFullscreen: false,
      autoHideWhenPaused: true,
      isForegroundFullscreen: false,
      isPlaying: true,
      isResizeInteractionActive: false,
    })).toBe(false);
  });

  it('keeps desktop lyrics visible during resize interactions', () => {
    expect(shouldAutoHideDesktopLyrics({
      autoHideWhenFullscreen: true,
      autoHideWhenPaused: true,
      isForegroundFullscreen: true,
      isPlaying: false,
      isResizeInteractionActive: true,
    })).toBe(false);
  });
});

describe('desktop lyrics free window positioning', () => {
  let scope: EffectScope;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    mocks.mounted.length = 0;
    mocks.unmounted.length = 0;
    mocks.appWindow.setPosition.mockClear();
    mocks.emitTo.mockClear();
    mocks.appWindow.listen.mockImplementation(async (event, callback) => {
      if (event === DESKTOP_LYRICS_STATE_EVENT) mocks.stateHandler = callback;
      return () => {};
    });
    mocks.appWindow.onMoved.mockImplementation(async callback => {
      mocks.movedHandler = callback;
      return () => {};
    });
    mocks.appWindow.onResized.mockImplementation(async callback => {
      mocks.resizedHandler = callback;
      return () => {};
    });
    scope = effectScope();
  });

  afterEach(() => {
    mocks.unmounted.forEach(callback => callback());
    scope.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const mount = async () => {
    const settings = ref({
      isLocked: false,
      isAlwaysOnTop: false,
      autoHideWhenFullscreen: false,
      autoHideWhenPaused: false,
      centerHorizontally: false,
    } as DesktopLyricsWindowSettings);
    scope.run(() => useDesktopLyricsWindowController({
      settings,
      showDragShadow: ref(false),
      playbackTime: ref(0),
      isPlaying: ref(true),
      handlePayload: payload => { settings.value = payload.settings; },
      handlePlaybackPayload: () => {},
    }));
    for (const callback of mocks.mounted) await callback();
    return (centerHorizontally: boolean) => mocks.stateHandler?.({
      payload: { settings: { ...settings.value, centerHorizontally } } as DesktopLyricsStatePayload,
    });
  };

  it('does not treat a restored centering setting as an explicit positioning request', async () => {
    const sendState = await mount();
    sendState(true);
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.appWindow.setPosition).not.toHaveBeenCalled();
  });

  it('persists moved and resized positions without snapping or delayed centering', async () => {
    const sendState = await mount();
    sendState(true);
    await mocks.movedHandler?.({ payload: { x: -1800, y: 1500 } });
    await mocks.resizedHandler?.({ payload: { width: 1100, height: 400 } });
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.appWindow.setPosition).not.toHaveBeenCalled();
    expect(mocks.emitTo).toHaveBeenCalledWith('main', DESKTOP_LYRICS_BOUNDS_EVENT, {
      x: -1800, y: 1500, width: 900, height: 280,
    });
    expect(mocks.emitTo).toHaveBeenCalledWith('main', DESKTOP_LYRICS_BOUNDS_EVENT, {
      x: -1800, y: 1500, width: 1100, height: 400,
    });
  });

  it('centers once on an explicit enable while preserving off-screen vertical position', async () => {
    const sendState = await mount();
    sendState(false);
    sendState(true);
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.appWindow.setPosition).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ x: 510, y: 1500 }));
    sendState(true);
    await mocks.movedHandler?.({ payload: { x: -2500, y: 1600 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.appWindow.setPosition).toHaveBeenCalledTimes(1);
  });
});
