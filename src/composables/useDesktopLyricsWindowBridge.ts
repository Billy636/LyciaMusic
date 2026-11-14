import { emitTo, listen } from '@tauri-apps/api/event';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getWebviewDataDirectory } from '../services/storage/dataStorage';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, watch, toRaw } from 'vue';
import { storeToRefs } from 'pinia';

import { useLyrics } from './lyrics';
import { usePlayer } from './player';
import { useToast } from './toast';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';
import { useUiStore } from '../shared/stores/ui';
import { nativeDesktopLyrics, usesNativeDesktopLyrics } from '../features/desktopLyrics/native';
import {
  applyDesktopLyricsVisibilityPreference,
  persistDesktopLyricsVisibilityPreference,
} from '../features/desktopLyrics/visibilityPreference';
import {
  createDesktopLyricsSongSnapshot,
  DESKTOP_LYRICS_ACTION_EVENT,
  DESKTOP_LYRICS_BOUNDS_EVENT,
  DESKTOP_LYRICS_BOUNDS_KEY,
  DESKTOP_LYRICS_ERROR_EVENT,
  DESKTOP_LYRICS_PLAYBACK_EVENT,
  DESKTOP_LYRICS_READY_EVENT,
  DESKTOP_LYRICS_RESET_BOUNDS_EVENT,
  DESKTOP_LYRICS_REVEAL_SURFACE_EVENT,
  DESKTOP_LYRICS_REQUEST_STATE_EVENT,
  DESKTOP_LYRICS_STATE_EVENT,
  DESKTOP_LYRICS_VISIBILITY_EVENT,
  DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT,
  DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH,
  DESKTOP_LYRICS_WINDOW_LABEL,
  DESKTOP_LYRICS_WINDOW_MAX_HEIGHT,
  DESKTOP_LYRICS_WINDOW_MAX_WIDTH,
  DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
  DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
  restoreDesktopLyricsBounds,
  type DesktopLyricsAction,
  type DesktopLyricsPlaybackPayload,
  type DesktopLyricsStatePayload,
  type DesktopLyricsWindowBounds,
} from '../features/desktopLyrics/shared';

let desktopLyricsWindowPromise: Promise<WebviewWindow> | null = null;
let desktopLyricsPlaybackSampleSequence = 0;
const DESKTOP_LYRICS_PLAYBACK_SYNC_INTERVAL_MS = 400;
const DESKTOP_LYRICS_READY_TIMEOUT_MS = 1200;

function logDesktopLyricsBridgeError(action: string, error: unknown) {
  console.warn(`Failed to ${action} desktop lyrics window:`, error);
}

export function formatDesktopLyricsOpenError(error: unknown): string {
  const detail = error instanceof Error ? error.message
    : typeof error === 'string' ? error
      : '未知错误';
  return `桌面歌词打开失败：${detail}`;
}

export function createDesktopLyricsPlaybackClockTracker(now = () => Date.now()) {
  let sampledPlaybackTime: number | null = null;
  let sampledAt = now();
  let anchorPlaybackTime = 0;
  let playing: boolean | null = null;
  let lastSeekRevision = 0;
  let lastSongPath: string | null = null;
  let lastPlaybackId = 0;

  const markPlaybackTimeSample = (playbackTime: number) => {
    if (!Number.isFinite(playbackTime)) return;

    sampledPlaybackTime = Math.max(0, playbackTime);
    anchorPlaybackTime = sampledPlaybackTime;
    sampledAt = now();
  };

  const resolveSyncedAt = (playbackTime: number) => {
    if (
      sampledPlaybackTime === null
      || !Number.isFinite(playbackTime)
      || Math.abs(playbackTime - sampledPlaybackTime) > 0.000_001
    ) {
      markPlaybackTimeSample(playbackTime);
    }

    return sampledAt;
  };

  const resolvePlaybackSample = (
    playbackTime: number,
    isPlaying: boolean,
    seekRevision = 0,
    songPath: string | null = null,
    playbackId = 0,
  ) => {
    const sampledTime = Number.isFinite(playbackTime) ? Math.max(0, playbackTime) : 0;
    const timestamp = now();
    const timelineChanged = playing === null
      || seekRevision !== lastSeekRevision
      || songPath !== lastSongPath
      || playbackId !== lastPlaybackId;
    const timeChanged = sampledPlaybackTime === null
      || Math.abs(sampledTime - sampledPlaybackTime) > 0.000_001;
    if (timelineChanged) {
      markPlaybackTimeSample(sampledTime);
    } else if (playing !== isPlaying) {
      if (playing) {
        // Freeze the interpolated frame, including the part after the last 100ms
        // (or low-power 1s) progress sample. Resume starts from this frozen anchor.
        anchorPlaybackTime = Math.max(
          sampledTime,
          anchorPlaybackTime + Math.max(0, timestamp - sampledAt) / 1000,
        );
      } else if (timeChanged) {
        anchorPlaybackTime = sampledTime;
      }
      sampledPlaybackTime = sampledTime;
      sampledAt = timestamp;
    } else if (timeChanged) {
      if (isPlaying) markPlaybackTimeSample(sampledTime);
      else sampledPlaybackTime = sampledTime;
    }
    playing = isPlaying;
    lastSeekRevision = seekRevision;
    lastSongPath = songPath;
    lastPlaybackId = playbackId;
    return { playbackTime: anchorPlaybackTime, syncedAt: sampledAt };
  };

  return {
    markPlaybackTimeSample,
    resolveSyncedAt,
    resolvePlaybackSample,
  };
}

export function createDesktopLyricsReadyGate(timeoutMs = DESKTOP_LYRICS_READY_TIMEOUT_MS) {
  let isReady = false;
  let readyPromise: Promise<void> | null = null;
  let resolveReady: (() => void) | null = null;
  let readyTimeout: ReturnType<typeof setTimeout> | null = null;

  const resolve = () => {
    resolveReady?.();
    resolveReady = null;
    readyPromise = null;
    if (readyTimeout) {
      clearTimeout(readyTimeout);
      readyTimeout = null;
    }
  };

  return {
    markReady() {
      isReady = true;
      resolve();
    },
    reset() {
      isReady = false;
      resolveReady = null;
      readyPromise = null;
      if (readyTimeout) {
        clearTimeout(readyTimeout);
        readyTimeout = null;
      }
    },
    wait() {
      if (isReady) {
        return Promise.resolve();
      }

      if (!readyPromise) {
        readyPromise = new Promise<void>((resolvePromise) => {
          resolveReady = resolvePromise;
          readyTimeout = setTimeout(resolve, timeoutMs);
        });
      }

      return readyPromise;
    },
  };
}

const desktopLyricsReadyGate = createDesktopLyricsReadyGate();

function readDesktopLyricsBounds(): DesktopLyricsWindowBounds | null {
  if (typeof localStorage === 'undefined') return null;

  const stored = localStorage.getItem(DESKTOP_LYRICS_BOUNDS_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<DesktopLyricsWindowBounds>;
    return restoreDesktopLyricsBounds(parsed);
  } catch {
    return null;
  }
}

function writeDesktopLyricsBounds(bounds: DesktopLyricsWindowBounds) {
  if (typeof localStorage === 'undefined') return;

  localStorage.setItem(DESKTOP_LYRICS_BOUNDS_KEY, JSON.stringify({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  }));
}

export function clearDesktopLyricsStoredBounds() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(DESKTOP_LYRICS_BOUNDS_KEY);
}

async function getDesktopLyricsWindow() {
  return WebviewWindow.getByLabel(DESKTOP_LYRICS_WINDOW_LABEL);
}

export function createDesktopLyricsWindowOptions({
  alwaysOnTop,
  hasStoredBounds,
}: {
  alwaysOnTop: boolean;
  hasStoredBounds: boolean;
}) {
  return {
    url: '/',
    title: 'Lycia Desktop Lyrics',
    width: DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH,
    height: DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT,
    minWidth: DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
    minHeight: DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
    maxWidth: DESKTOP_LYRICS_WINDOW_MAX_WIDTH,
    maxHeight: DESKTOP_LYRICS_WINDOW_MAX_HEIGHT,
    visible: false,
    decorations: false,
    transparent: true,
    shadow: false,
    skipTaskbar: true,
    alwaysOnTop,
    focus: false,
    focusable: true,
    center: !hasStoredBounds,
  };
}

async function ensureDesktopLyricsWindow(alwaysOnTop: boolean) {
  const existing = await getDesktopLyricsWindow();
  if (existing) return existing;

  if (!desktopLyricsWindowPromise) {
    desktopLyricsReadyGate.reset();
    const bounds = readDesktopLyricsBounds();
    const windowInstance = new WebviewWindow(DESKTOP_LYRICS_WINDOW_LABEL, {
      dataDirectory: getWebviewDataDirectory(),
      ...createDesktopLyricsWindowOptions({
        alwaysOnTop,
        hasStoredBounds: !!bounds,
      }),
    });

    desktopLyricsWindowPromise = new Promise<WebviewWindow>((resolve, reject) => {
      let settled = false;

      void windowInstance.once('tauri://created', async () => {
        if (settled) return;

        try {
          if (bounds) {
            await windowInstance.setSize(new PhysicalSize(bounds.width, bounds.height));
            await windowInstance.setPosition(new PhysicalPosition(bounds.x, bounds.y));
          }

          settled = true;
          desktopLyricsWindowPromise = null;
          resolve(windowInstance);
        } catch (error) {
          settled = true;
          desktopLyricsWindowPromise = null;
          reject(error);
        }
      });

      void windowInstance.once('tauri://error', (event) => {
        if (settled) return;
        settled = true;
        desktopLyricsWindowPromise = null;
        reject(event.payload);
      });
    });
  }

  return desktopLyricsWindowPromise;
}

export function useDesktopLyricsWindowBridge() {
  const useNativeRenderer = usesNativeDesktopLyrics();
  let nativeWindowOpen = false;
  let lifecycleTask = Promise.resolve();
  let disposed = false;
  const mainWindow = getCurrentWindow();
  const { showToast } = useToast();
  const {
    showDesktopLyrics,
    parsedLyrics,
    lyricsStatus,
    currentLyricLine,
    lyricsSettings,
    desktopLyricsSettings,
  } = useLyrics();
  const { togglePlay, prevSong, nextSong } = usePlayer();
  const playbackStore = usePlaybackStore();
  const uiStore = useUiStore();
  const settingsStore = useSettingsStore();
  const { currentSong, currentTime, isPlaying } = storeToRefs(playbackStore);
  const { audioDelay } = storeToRefs(settingsStore);
  const { dominantColors } = storeToRefs(uiStore);
  const playbackClockTracker = createDesktopLyricsPlaybackClockTracker();

  let isMainWindowClosing = false;
  let nativeSyncTask = Promise.resolve();
  let syncIntervalId: ReturnType<typeof setInterval> | null = null;
  const unlisteners: Array<() => void> = [];

  const createPlaybackPayload = (): DesktopLyricsPlaybackPayload => ({
    ...playbackClockTracker.resolvePlaybackSample(
      currentTime.value,
      isPlaying.value,
      playbackStore.seekRevision ?? 0,
      currentSong.value?.path ?? null,
      playbackStore.currentPlaybackId ?? 0,
    ),
    isPlaying: isPlaying.value,
    audioDelay: audioDelay.value,
    seekRevision: playbackStore.seekRevision ?? 0,
    sampleSequence: ++desktopLyricsPlaybackSampleSequence,
    songPath: currentSong.value?.path,
    playbackId: playbackStore.currentPlaybackId ?? 0,
  });

  const createStatePayload = (): DesktopLyricsStatePayload => ({
    song: createDesktopLyricsSongSnapshot(currentSong.value),
    parsedLyrics: toRaw(parsedLyrics.value) as DesktopLyricsStatePayload['parsedLyrics'],
    lyricsStatus: lyricsStatus.value,
    fallbackText: currentLyricLine.value.text,
    ...createPlaybackPayload(),
    settings: {
      showTranslation: lyricsSettings.showTranslation,
      showRomaji: lyricsSettings.showRomaji,
      isAlwaysOnTop: desktopLyricsSettings.isAlwaysOnTop,
      alwaysShowShadowBackground: desktopLyricsSettings.alwaysShowShadowBackground,
      autoHideWhenFullscreen: desktopLyricsSettings.autoHideWhenFullscreen,
      autoHideWhenPaused: desktopLyricsSettings.autoHideWhenPaused,
      showDoubleLine: desktopLyricsSettings.showDoubleLine,
      overflowMode: desktopLyricsSettings.overflowMode ?? 'scroll',
      enableWordEffect: desktopLyricsSettings.enableWordEffect,
      isLocked: desktopLyricsSettings.isLocked,
      persistLock: desktopLyricsSettings.persistLock,
      colorScheme: desktopLyricsSettings.colorScheme,
      customPlayedColor: desktopLyricsSettings.customPlayedColor,
      customUnplayedColor: desktopLyricsSettings.customUnplayedColor,
      customRomajiPlayedColor: desktopLyricsSettings.customRomajiPlayedColor,
      customRomajiUnplayedColor: desktopLyricsSettings.customRomajiUnplayedColor,
      customRomajiColor: desktopLyricsSettings.customRomajiColor,
      customTranslationColor: desktopLyricsSettings.customTranslationColor,
      textOpacity: desktopLyricsSettings.textOpacity,
      textShadowColor: desktopLyricsSettings.textShadowColor,
      firstLineTextShadowStrength: desktopLyricsSettings.firstLineTextShadowStrength,
      secondLineTextShadowStrength: desktopLyricsSettings.secondLineTextShadowStrength,
      textStrokeColor: desktopLyricsSettings.textStrokeColor,
      textStrokeDepth: desktopLyricsSettings.textStrokeDepth,
      playerFontScale: desktopLyricsSettings.playerFontScale,
      playerLineGap: desktopLyricsSettings.playerLineGap,
      playerOffsetX: desktopLyricsSettings.playerOffsetX,
      playerOffsetY: desktopLyricsSettings.playerOffsetY,
      playerAlignment: desktopLyricsSettings.playerAlignment,
      playerFontPreset: desktopLyricsSettings.playerFontPreset,
      centerHorizontally: desktopLyricsSettings.centerHorizontally,
    },
    customLyricsFonts: [...settingsStore.settings.customLyricsFonts],
    themeColors: [...dominantColors.value],
  });

  let isEmitStateThrottled = false;
  let hasPendingEmitState = false;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  const enqueueNativeSync = (send: () => Promise<void>) => {
    // State and playback share one ordered stream, so a later periodic sample
    // cannot overtake the final lyrics/settings snapshot and make it stale.
    const task = nativeSyncTask.catch(() => undefined).then(async () => {
      if (nativeWindowOpen && !disposed && !isMainWindowClosing) await send();
    });
    nativeSyncTask = task;
    return task;
  };

  const emitStateToDesktopLyrics = async (immediate = false) => {
    if (useNativeRenderer) {
      if (nativeWindowOpen) await enqueueNativeSync(() => nativeDesktopLyrics.state(createStatePayload()));
      return;
    }
    const targetWindow = await getDesktopLyricsWindow();
    if (!targetWindow) return;

    if (immediate) {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      isEmitStateThrottled = false;
      hasPendingEmitState = false;
    }

    if (isEmitStateThrottled) {
      hasPendingEmitState = true;
      return;
    }

    if (!immediate) {
      isEmitStateThrottled = true;
    }

    try {
      await emitTo<DesktopLyricsStatePayload>(
        DESKTOP_LYRICS_WINDOW_LABEL,
        DESKTOP_LYRICS_STATE_EVENT,
        createStatePayload(),
      );
    } finally {
      if (!immediate) {
        throttleTimer = setTimeout(() => {
          isEmitStateThrottled = false;
          throttleTimer = null;
          if (hasPendingEmitState) {
            hasPendingEmitState = false;
            void emitStateToDesktopLyrics(false);
          }
        }, 30);
      }
    }
  };

  const emitPlaybackToDesktopLyrics = async () => {
    if (useNativeRenderer) {
      if (nativeWindowOpen) await enqueueNativeSync(() => nativeDesktopLyrics.playback(createPlaybackPayload()));
      return;
    }
    const targetWindow = await getDesktopLyricsWindow();
    if (!targetWindow) return;

    await emitTo<DesktopLyricsPlaybackPayload>(
      DESKTOP_LYRICS_WINDOW_LABEL,
      DESKTOP_LYRICS_PLAYBACK_EVENT,
      createPlaybackPayload(),
    );
  };

  const revealDesktopLyricsSurface = async () => {
    if (useNativeRenderer) {
      if (nativeWindowOpen) await nativeDesktopLyrics.reveal();
      return;
    }
    const targetWindow = await getDesktopLyricsWindow();
    if (!targetWindow) return;

    await emitTo(DESKTOP_LYRICS_WINDOW_LABEL, DESKTOP_LYRICS_REVEAL_SURFACE_EVENT);
  };

  const syncWindowFlags = async () => {
    if (useNativeRenderer) return; // Native flags are applied atomically with the settings snapshot.
    const targetWindow = await getDesktopLyricsWindow();
    if (!targetWindow) return;

    await targetWindow.setAlwaysOnTop(desktopLyricsSettings.isAlwaysOnTop);
  };

  const openDesktopLyricsWindow = async () => {
    if (useNativeRenderer) {
      await nativeDesktopLyrics.open(createStatePayload(), readDesktopLyricsBounds());
      nativeWindowOpen = true;
      // Settings/playback may have changed during native initialization.
      await emitStateToDesktopLyrics(true);
      if (!disposed && !isMainWindowClosing && showDesktopLyrics.value) startSyncLoop();
      return;
    }
    const targetWindow = await ensureDesktopLyricsWindow(
      desktopLyricsSettings.isAlwaysOnTop,
    );
    await desktopLyricsReadyGate.wait();
    await syncWindowFlags();
    await emitStateToDesktopLyrics(true);
    await emitPlaybackToDesktopLyrics();
    await targetWindow.show();
    await revealDesktopLyricsSurface();
    startSyncLoop();
  };

  const stopSyncLoop = () => {
    if (syncIntervalId !== null) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  };

  const startSyncLoop = () => {
    stopSyncLoop();
    syncIntervalId = setInterval(() => {
      if (!showDesktopLyrics.value) return;
      void emitPlaybackToDesktopLyrics().catch((error) => {
        logDesktopLyricsBridgeError('sync playback to', error);
      });
    }, DESKTOP_LYRICS_PLAYBACK_SYNC_INTERVAL_MS);
  };

  const handleAction = async (action: DesktopLyricsAction) => {
    switch (action.type) {
      case 'toggle-play':
        await togglePlay();
        break;
      case 'prev-song':
        prevSong();
        break;
      case 'next-song':
        nextSong();
        break;
      case 'adjust-offset': {
        const currentOffset = settingsStore.settings.lyricsSyncOffset;
        const nextOffset = Math.max(-5, Math.min(5, currentOffset + action.delta));
        settingsStore.settings.lyricsSyncOffset = Number(nextOffset.toFixed(2));
        break;
      }
      case 'close':
        showDesktopLyrics.value = false;
        break;
      case 'update-settings': {
        const {
          showTranslation,
          showRomaji,
          ...desktopPatch
        } = action.patch;

        if (typeof showTranslation === 'boolean') {
          lyricsSettings.showTranslation = showTranslation;
        }

        if (typeof showRomaji === 'boolean') {
          lyricsSettings.showRomaji = showRomaji;
        }

        Object.assign(desktopLyricsSettings, desktopPatch);
        break;
      }
      default:
        break;
    }
  };

  const destroyDesktopLyricsWindow = async () => {
    if (useNativeRenderer) {
      nativeWindowOpen = false;
      await nativeSyncTask.catch(() => undefined);
      await nativeDesktopLyrics.close();
      return;
    }
    const targetWindow = await getDesktopLyricsWindow();
    if (!targetWindow) return;

    try {
      await targetWindow.destroy();
    } catch (error) {
      console.warn('Failed to destroy desktop lyrics window during shutdown:', error);
    } finally {
      desktopLyricsWindowPromise = null;
      desktopLyricsReadyGate.reset();
    }
  };

  onMounted(async () => {
    if (!desktopLyricsSettings.persistLock && desktopLyricsSettings.isLocked) {
      desktopLyricsSettings.isLocked = false;
    }

    unlisteners.push(await mainWindow.onCloseRequested(async (event) => {
      if (settingsStore.settings.closeToTray) return;
      if (isMainWindowClosing) return;

      isMainWindowClosing = true;
      event.preventDefault();
      stopSyncLoop();
      await lifecycleTask;
      await destroyDesktopLyricsWindow();
      await mainWindow.close();
    }));

    unlisteners.push(await listen(DESKTOP_LYRICS_REQUEST_STATE_EVENT, () => {
      void emitStateToDesktopLyrics(true).catch((error) => {
        logDesktopLyricsBridgeError('sync state to', error);
      });
      void emitPlaybackToDesktopLyrics().catch((error) => {
        logDesktopLyricsBridgeError('sync playback to', error);
      });
    }));

    unlisteners.push(await listen(DESKTOP_LYRICS_READY_EVENT, () => {
      desktopLyricsReadyGate.markReady();
    }));

    if (useNativeRenderer) {
      unlisteners.push(await listen<string>(DESKTOP_LYRICS_ERROR_EVENT, (event) => {
        logDesktopLyricsBridgeError('render native', event.payload);
        // Initialization failures are reported by the open() catch below; only
        // report post-open render failures here, avoiding duplicate notifications.
        if (nativeWindowOpen) showToast(`原生桌面歌词渲染失败：${event.payload}`, 'error');
      }));
    }

    unlisteners.push(await listen<DesktopLyricsAction>(DESKTOP_LYRICS_ACTION_EVENT, (event) => {
      void handleAction(event.payload).catch((error) => {
        logDesktopLyricsBridgeError('handle action from', error);
      });
    }));

    unlisteners.push(await listen<{ visible: boolean }>(DESKTOP_LYRICS_VISIBILITY_EVENT, (event) => {
      if (isMainWindowClosing) return;
      showDesktopLyrics.value = event.payload.visible;
    }));

    unlisteners.push(await listen<DesktopLyricsWindowBounds>(DESKTOP_LYRICS_BOUNDS_EVENT, (event) => {
      writeDesktopLyricsBounds(event.payload);
    }));

    unlisteners.push(await listen(DESKTOP_LYRICS_RESET_BOUNDS_EVENT, async () => {
      clearDesktopLyricsStoredBounds();

      if (!showDesktopLyrics.value) {
        return;
      }

      lifecycleTask = lifecycleTask.then(async () => {
        stopSyncLoop();
        await destroyDesktopLyricsWindow();
        if (!disposed && showDesktopLyrics.value) await openDesktopLyricsWindow();
      }).catch((error) => {
        logDesktopLyricsBridgeError('reopen', error);
        showDesktopLyrics.value = false;
      });
      await lifecycleTask;
    }));
  });

  onUnmounted(() => {
    disposed = true;
    stopSyncLoop();
    if (throttleTimer) clearTimeout(throttleTimer);
    unlisteners.splice(0).forEach((unlisten) => unlisten());
    if (useNativeRenderer) {
      void lifecycleTask.then(async () => {
        stopSyncLoop();
        await destroyDesktopLyricsWindow();
      }).catch((error) => {
        logDesktopLyricsBridgeError('dispose', error);
      });
    }
  });

  watch(showDesktopLyrics, async (visible) => {
    persistDesktopLyricsVisibilityPreference(
      settingsStore.settings,
      settingsStore.patchSettings,
      visible,
    );

    lifecycleTask = lifecycleTask.then(async () => {
      if (disposed || isMainWindowClosing) return;
      // Coalesce rapid toggles, so a late open cannot resurrect a closed window.
      if (visible !== showDesktopLyrics.value) return;
      if (visible) {
        try {
          await openDesktopLyricsWindow();
        } catch (error) {
          logDesktopLyricsBridgeError('open', error);
          showToast(formatDesktopLyricsOpenError(error), 'error');
          stopSyncLoop();
          desktopLyricsWindowPromise = null;
          desktopLyricsReadyGate.reset();
          await destroyDesktopLyricsWindow().catch(() => undefined);
          showDesktopLyrics.value = false;
        }
        return;
      }

      stopSyncLoop();
      await destroyDesktopLyricsWindow();
    }).catch((error) => logDesktopLyricsBridgeError('change visibility of', error));
    await lifecycleTask;
  });

  watch(
    [currentTime, isPlaying, () => playbackStore.seekRevision ?? 0, () => currentSong.value?.path,
      () => playbackStore.currentPlaybackId ?? 0],
    ([time, playing, seekRevision, songPath, playbackId], previous) => {
      playbackClockTracker.resolvePlaybackSample(time, playing, seekRevision, songPath ?? null, playbackId);
      if (showDesktopLyrics.value && previous
        && (playing !== previous[1] || seekRevision !== previous[2] || playbackId !== previous[4])) {
        void emitPlaybackToDesktopLyrics().catch((error) => {
          logDesktopLyricsBridgeError('sync playback to', error);
        });
      }
    },
    { immediate: true },
  );

  watch(
    () => settingsStore.settings.showDesktopLyrics,
    (preferredVisible) => {
      applyDesktopLyricsVisibilityPreference(showDesktopLyrics, preferredVisible);
    },
    { immediate: true },
  );

  watch(
    [
      parsedLyrics,
      lyricsStatus,
      () => currentSong.value?.path,
      () => currentSong.value?.title,
      () => currentSong.value?.name,
      () => currentSong.value?.artist,
      () => currentSong.value?.duration,
      isPlaying,
      audioDelay,
      () => lyricsSettings.showTranslation,
      () => lyricsSettings.showRomaji,
      () => desktopLyricsSettings.isAlwaysOnTop,
      () => desktopLyricsSettings.alwaysShowShadowBackground,
      () => desktopLyricsSettings.autoHideWhenFullscreen,
      () => desktopLyricsSettings.autoHideWhenPaused,
      () => desktopLyricsSettings.showDoubleLine,
      () => desktopLyricsSettings.overflowMode,
      () => desktopLyricsSettings.enableWordEffect,
      () => desktopLyricsSettings.isLocked,
      () => desktopLyricsSettings.persistLock,
      () => desktopLyricsSettings.centerHorizontally,
      () => desktopLyricsSettings.colorScheme,
      () => desktopLyricsSettings.customPlayedColor,
      () => desktopLyricsSettings.customUnplayedColor,
      () => desktopLyricsSettings.customRomajiPlayedColor,
      () => desktopLyricsSettings.customRomajiUnplayedColor,
      () => desktopLyricsSettings.customRomajiColor,
      () => desktopLyricsSettings.customTranslationColor,
      () => desktopLyricsSettings.textOpacity,
      () => desktopLyricsSettings.textShadowColor,
      () => desktopLyricsSettings.firstLineTextShadowStrength,
      () => desktopLyricsSettings.secondLineTextShadowStrength,
      () => desktopLyricsSettings.textStrokeColor,
      () => desktopLyricsSettings.textStrokeDepth,
      () => desktopLyricsSettings.playerFontScale,
      () => desktopLyricsSettings.playerLineGap,
      () => desktopLyricsSettings.playerOffsetX,
      () => desktopLyricsSettings.playerOffsetY,
      () => desktopLyricsSettings.playerAlignment,
      () => desktopLyricsSettings.playerFontPreset,
      () => settingsStore.settings.customLyricsFonts,
      dominantColors,
    ],
    (newValue, oldValue) => {
      if (!showDesktopLyrics.value) return;

      let isImmediateChange = false;
      if (oldValue) {
        const keyIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8];
        isImmediateChange = keyIndices.some(idx => newValue[idx] !== oldValue[idx]);
      } else {
        isImmediateChange = true;
      }

      void emitStateToDesktopLyrics(isImmediateChange).catch((error) => {
        logDesktopLyricsBridgeError('sync state to', error);
      });
      void emitPlaybackToDesktopLyrics().catch((error) => {
        logDesktopLyricsBridgeError('sync playback to', error);
      });
      void syncWindowFlags().catch((error) => {
        logDesktopLyricsBridgeError('sync flags for', error);
      });
    },
    { deep: true },
  );
}
