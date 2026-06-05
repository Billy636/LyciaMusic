import { effectScope, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDesktopLyricsPlaybackClockTracker,
  createDesktopLyricsReadyGate,
  createDesktopLyricsWindowOptions,
  useDesktopLyricsWindowBridge,
} from './useDesktopLyricsWindowBridge';

declare const require: <T = unknown>(id: string) => T;

const mocks = vi.hoisted(() => {
  const { ref } = require('vue') as typeof import('vue');
  const showDesktopLyrics = ref(false);
  const parsedLyrics = ref([]);
  const lyricsStatus = ref('idle');
  const currentLyricLine = ref({ text: 'Instrumental / No lyrics' });
  const currentSong = ref(null);
  const currentTime = ref(0);
  const isPlaying = ref(false);
  const dominantColors = ref([]);
  const settings = {
    showDesktopLyrics: false,
    customLyricsFonts: [],
    lyricsSyncOffset: 0,
    desktopLyrics: {
      isAlwaysOnTop: true,
      alwaysShowShadowBackground: false,
      autoHideWhenFullscreen: true,
      autoHideWhenPaused: false,
      showDoubleLine: false,
      enableWordEffect: true,
      isLocked: false,
      persistLock: false,
      colorScheme: 'pink',
      customPlayedColor: '#ffffff',
      customUnplayedColor: '#ffffff',
      customRomajiPlayedColor: '#ffffff',
      customRomajiUnplayedColor: '#ffffff',
      customRomajiColor: '#ffffff',
      customTranslationColor: '#ffffff',
      textOpacity: 1,
      textShadowColor: '#000000',
      firstLineTextShadowStrength: 0,
      secondLineTextShadowStrength: 0,
      playerFontScale: 1,
      playerLineGap: 1,
      playerOffsetX: 0,
      playerOffsetY: 0,
      playerAlignment: 'center',
      playerFontPreset: 'system',
    },
  };
  const lyricsSettings = {
    showTranslation: true,
    showRomaji: true,
  };
  const desktopLyricsSettings = settings.desktopLyrics;
  const targetWindow = {
    once: vi.fn(),
    setSize: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockRejectedValue('window not found'),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  const WebviewWindow = vi.fn(() => targetWindow) as ReturnType<typeof vi.fn> & {
    getByLabel: ReturnType<typeof vi.fn>;
  };
  WebviewWindow.getByLabel = vi.fn().mockResolvedValue(null);

  return {
    showDesktopLyrics,
    parsedLyrics,
    lyricsStatus,
    currentLyricLine,
    currentSong,
    currentTime,
    isPlaying,
    dominantColors,
    settings,
    lyricsSettings,
    desktopLyricsSettings,
    targetWindow,
    WebviewWindow,
    patchSettings: vi.fn((patch) => {
      Object.assign(settings, patch);
    }),
  };
});

vi.mock('@tauri-apps/api/dpi', () => ({
  PhysicalPosition: class {
    constructor(public x: number, public y: number) {}
  },
  PhysicalSize: class {
    constructor(public width: number, public height: number) {}
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: mocks.WebviewWindow,
}));

vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: vi.fn(),
  getCurrentWindow: vi.fn(() => ({
    onCloseRequested: vi.fn().mockResolvedValue(() => {}),
  })),
}));

vi.mock('../features/playback/store', () => ({
  usePlaybackStore: vi.fn(() => ({
    currentSong: mocks.currentSong,
    currentTime: mocks.currentTime,
    isPlaying: mocks.isPlaying,
  })),
}));

vi.mock('../features/settings/store', () => ({
  useSettingsStore: vi.fn(() => ({
    settings: mocks.settings,
    audioDelay: mocks.currentTime,
    patchSettings: mocks.patchSettings,
  })),
}));

vi.mock('../shared/stores/ui', () => ({
  useUiStore: vi.fn(() => ({
    dominantColors: mocks.dominantColors,
  })),
}));

vi.mock('./lyrics', () => ({
  useLyrics: vi.fn(() => ({
    showDesktopLyrics: mocks.showDesktopLyrics,
    parsedLyrics: mocks.parsedLyrics,
    lyricsStatus: mocks.lyricsStatus,
    currentLyricLine: mocks.currentLyricLine,
    lyricsSettings: mocks.lyricsSettings,
    desktopLyricsSettings: mocks.desktopLyricsSettings,
  })),
}));

vi.mock('./player', () => ({
  usePlayer: vi.fn(() => ({
    togglePlay: vi.fn(),
    prevSong: vi.fn(),
    nextSong: vi.fn(),
  })),
}));

describe('desktop lyrics window bridge', () => {
  beforeEach(() => {
    mocks.showDesktopLyrics.value = false;
    mocks.settings.showDesktopLyrics = false;
    mocks.patchSettings.mockClear();
    mocks.targetWindow.once.mockImplementation((event: string, handler: () => void) => {
      if (event === 'tauri://created') {
        queueMicrotask(handler);
      }
      return Promise.resolve(() => {});
    });
    mocks.targetWindow.show.mockRejectedValue('window not found');
    mocks.WebviewWindow.mockClear();
    mocks.WebviewWindow.getByLabel.mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates the desktop lyrics window without stealing main window focus', () => {
    expect(createDesktopLyricsWindowOptions({
      alwaysOnTop: true,
      hasStoredBounds: false,
    })).toMatchObject({
      alwaysOnTop: true,
      center: true,
      focus: false,
      focusable: true,
      visible: false,
    });
  });

  it('timestamps playback payloads at the last currentTime sample instead of send time', () => {
    let now = 1_000;
    const tracker = createDesktopLyricsPlaybackClockTracker(() => now);

    tracker.markPlaybackTimeSample(11.35);
    now += 650;

    expect(tracker.resolveSyncedAt(11.35)).toBe(1_000);
    expect(tracker.resolveSyncedAt(12)).toBe(1_650);
  });

  it('waits until the desktop lyrics window reports ready', async () => {
    vi.useFakeTimers();
    const gate = createDesktopLyricsReadyGate(1000);
    let didResolve = false;

    const waitPromise = gate.wait().then(() => {
      didResolve = true;
    });

    await Promise.resolve();
    expect(didResolve).toBe(false);

    gate.markReady();
    await waitPromise;

    expect(didResolve).toBe(true);
  });

  it('rolls back desktop lyrics visibility when opening the window fails', async () => {
    const scope = effectScope();
    scope.run(() => useDesktopLyricsWindowBridge());

    mocks.showDesktopLyrics.value = true;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    expect(mocks.showDesktopLyrics.value).toBe(false);
    expect(mocks.patchSettings).toHaveBeenCalledWith({ showDesktopLyrics: false });

    scope.stop();
  });
});
