import { LogicalPosition } from '@tauri-apps/api/dpi';
import { emitTo, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue';

import { useCoverCache } from './useCoverCache';
import { useLyrics } from './lyrics';
import { usePlayer } from './player';
import { useThemeSettings } from './useThemeSettings';
import { useSettings } from '../features/settings/useSettings';
import {
  MINI_PLAYER_ACTION_EVENT,
  MINI_PLAYER_BOUNDS_EVENT,
  MINI_PLAYER_BOUNDS_KEY,
  MINI_PLAYER_READY_EVENT,
  MINI_PLAYER_REQUEST_STATE_EVENT,
  MINI_PLAYER_STATE_APPLIED_EVENT,
  MINI_PLAYER_STATE_EVENT,
  MINI_PLAYER_VISIBILITY_EVENT,
  MINI_PLAYER_WINDOW_BASE_HEIGHT,
  MINI_PLAYER_WINDOW_EXPANDED_HEIGHT,
  MINI_PLAYER_WINDOW_LABEL,
  MINI_PLAYER_WINDOW_WIDTH,
  APP_SHOW_MAIN_EVENT,
  type MiniPlayerAction,
  type MiniPlayerStatePayload,
  type MiniPlayerWindowBounds,
} from '../features/miniPlayer/shared';

let miniPlayerWindowPromise: Promise<WebviewWindow> | null = null;
let isMiniPlayerReady = false;
let miniPlayerReadyPromise: Promise<void> | null = null;
let resolveMiniPlayerReady: (() => void) | null = null;
let resolveMiniPlayerStateApplied: (() => void) | null = null;

const MINI_PLAYER_PREWARM_DELAY_MS = 3_200;
let miniPlayerPrewarmTimer: ReturnType<typeof window.setTimeout> | null = null;

function clearMiniPlayerPrewarmTimer() {
  if (miniPlayerPrewarmTimer !== null) {
    window.clearTimeout(miniPlayerPrewarmTimer);
    miniPlayerPrewarmTimer = null;
  }
}

function readMiniPlayerBounds(): MiniPlayerWindowBounds | null {
  if (typeof localStorage === 'undefined') return null;

  const stored = localStorage.getItem(MINI_PLAYER_BOUNDS_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<MiniPlayerWindowBounds>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }

    return {
      x: Math.round(parsed.x as number),
      y: Math.round(parsed.y as number),
    };
  } catch {
    return null;
  }
}

function writeMiniPlayerBounds(bounds: MiniPlayerWindowBounds) {
  if (typeof localStorage === 'undefined') return;

  localStorage.setItem(MINI_PLAYER_BOUNDS_KEY, JSON.stringify({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
  }));
}

async function normalizeMiniPlayerBounds(bounds: MiniPlayerWindowBounds | null) {
  if (!bounds) return null;

  try {
    const workAreas = (await availableMonitors()).map((monitor) => {
      const scaleFactor = monitor.scaleFactor || 1;
      const position = monitor.workArea.position.toLogical(scaleFactor);
      const size = monitor.workArea.size.toLogical(scaleFactor);

      return {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      };
    });

    if (workAreas.length === 0) return bounds;

    const width = MINI_PLAYER_WINDOW_WIDTH;
    const height = MINI_PLAYER_WINDOW_EXPANDED_HEIGHT;
    const boundsCenterX = bounds.x + width / 2;
    const boundsCenterY = bounds.y + MINI_PLAYER_WINDOW_BASE_HEIGHT / 2;
    const workArea = workAreas.reduce((best, candidate) => {
      const bestCenterX = best.x + best.width / 2;
      const bestCenterY = best.y + best.height / 2;
      const candidateCenterX = candidate.x + candidate.width / 2;
      const candidateCenterY = candidate.y + candidate.height / 2;
      const bestDistance = (bestCenterX - boundsCenterX) ** 2 + (bestCenterY - boundsCenterY) ** 2;
      const candidateDistance = (candidateCenterX - boundsCenterX) ** 2 + (candidateCenterY - boundsCenterY) ** 2;
      return candidateDistance < bestDistance ? candidate : best;
    }, workAreas[0]);

    const maxX = workArea.x + Math.max(0, workArea.width - width);
    const maxY = workArea.y + Math.max(0, workArea.height - height);

    return {
      x: Math.round(Math.min(maxX, Math.max(workArea.x, bounds.x))),
      y: Math.round(Math.min(maxY, Math.max(workArea.y, bounds.y))),
    };
  } catch {
    return bounds;
  }
}

async function getMiniPlayerWindow() {
  return WebviewWindow.getByLabel(MINI_PLAYER_WINDOW_LABEL);
}

async function ensureMiniPlayerWindow() {
  const existing = await getMiniPlayerWindow();
  if (existing) {
    const bounds = await normalizeMiniPlayerBounds(readMiniPlayerBounds());
    if (bounds) {
      await existing.setPosition(new LogicalPosition(bounds.x, bounds.y));
    }
    return existing;
  }

  if (!miniPlayerWindowPromise) {
    isMiniPlayerReady = false;
    miniPlayerReadyPromise = null;
    resolveMiniPlayerReady = null;

    miniPlayerWindowPromise = (async () => {
      const bounds = await normalizeMiniPlayerBounds(readMiniPlayerBounds());
      const windowInstance = new WebviewWindow(MINI_PLAYER_WINDOW_LABEL, {
        url: '/',
        title: 'Lycia Mini Player',
        width: MINI_PLAYER_WINDOW_WIDTH,
        height: MINI_PLAYER_WINDOW_BASE_HEIGHT,
        minWidth: MINI_PLAYER_WINDOW_WIDTH,
        minHeight: MINI_PLAYER_WINDOW_BASE_HEIGHT,
        maxWidth: MINI_PLAYER_WINDOW_WIDTH,
        maxHeight: MINI_PLAYER_WINDOW_BASE_HEIGHT,
        visible: false,
        decorations: false,
        transparent: true,
        shadow: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true,
        center: !bounds,
      });

      return new Promise<WebviewWindow>((resolve, reject) => {
        let settled = false;

        void windowInstance.once('tauri://created', async () => {
          if (settled) return;

          try {
            if (bounds) {
              await windowInstance.setPosition(new LogicalPosition(bounds.x, bounds.y));
            }

            settled = true;
            resolve(windowInstance);
          } catch (error) {
            settled = true;
            reject(error);
          }
        });

        void windowInstance.once('tauri://error', (event) => {
          if (settled) return;
          settled = true;
          reject(event.payload);
        });
      });
    })();

    miniPlayerWindowPromise = miniPlayerWindowPromise.finally(() => {
      miniPlayerWindowPromise = null;
    });
  }

  return miniPlayerWindowPromise;
}

function markMiniPlayerReady() {
  isMiniPlayerReady = true;
  resolveMiniPlayerReady?.();
  resolveMiniPlayerReady = null;
  miniPlayerReadyPromise = null;
}

function waitForMiniPlayerReady(timeoutMs = 1000) {
  if (isMiniPlayerReady) {
    return Promise.resolve();
  }

  if (!miniPlayerReadyPromise) {
    miniPlayerReadyPromise = new Promise<void>((resolve) => {
      resolveMiniPlayerReady = resolve;
      window.setTimeout(resolve, timeoutMs);
    });
  }

  return miniPlayerReadyPromise;
}

function waitForMiniPlayerStateApplied(timeoutMs = 500) {
  return new Promise<void>((resolve) => {
    resolveMiniPlayerStateApplied = resolve;
    window.setTimeout(resolve, timeoutMs);
  });
}

export async function restoreMainWindowFromMiniMode(options: {
  isMiniMode: Ref<boolean>;
  hideMiniPlayerWindow: () => Promise<void>;
  keepMiniPlayerVisible?: boolean;
  mainWindow: {
    unminimize: () => Promise<void>;
    show: () => Promise<void>;
    setFocus: () => Promise<void>;
  };
}) {
  options.isMiniMode.value = false;
  if (!options.keepMiniPlayerVisible) {
    await options.hideMiniPlayerWindow();
  }
  await options.mainWindow.unminimize();
  await options.mainWindow.show();
  await options.mainWindow.setFocus();
}

export function useMiniPlayerWindowBridge() {
  const mainWindow = getCurrentWindow();
  const { settings } = useSettings();
  const {
    currentSong,
    isPlaying,
    volume,
    playQueue,
    songList,
    togglePlay,
    prevSong,
    nextSong,
    handleVolume,
    toggleMute,
    playSong,
    isMiniMode,
  } = usePlayer();
  const { currentLyricLine } = useLyrics();
  const { loadCover } = useCoverCache();
  const { isDarkTheme } = useThemeSettings();

  let isMainWindowClosing = false;
  let keepMiniPlayerVisibleOnMiniModeExit = false;
  const isMiniPlayerWindowVisible = ref(false);
  const unlisteners: Array<() => void> = [];

  const createStatePayload = async (): Promise<MiniPlayerStatePayload> => {
    const song = currentSong.value;
    const coverUrl = song?.path ? await loadCover(song.path).catch(() => '') : '';

    return {
      currentSong: song,
      coverUrl: coverUrl || '',
      isPlaying: isPlaying.value,
      isDarkTheme: isDarkTheme.value,
      volume: volume.value,
      queue: playQueue.value.length > 0 ? playQueue.value : songList.value,
      lyricText: currentLyricLine.value?.text ?? '',
    };
  };

  const emitStateToMiniPlayer = async () => {
    const targetWindow = await getMiniPlayerWindow();
    if (!targetWindow) return;

    const appliedPromise = waitForMiniPlayerStateApplied();
    await emitTo<MiniPlayerStatePayload>(
      MINI_PLAYER_WINDOW_LABEL,
      MINI_PLAYER_STATE_EVENT,
      await createStatePayload(),
    );
    await appliedPromise;
  };

  const emitMiniPlayerVisibility = async (visible: boolean) => {
    const targetWindow = await getMiniPlayerWindow();
    if (!targetWindow) return;

    await emitTo(MINI_PLAYER_WINDOW_LABEL, MINI_PLAYER_VISIBILITY_EVENT, { visible });
  };

  const openMiniPlayerWindow = async () => {
    clearMiniPlayerPrewarmTimer();

    const targetWindow = await ensureMiniPlayerWindow();
    await waitForMiniPlayerReady();
    await targetWindow.setAlwaysOnTop(true);
    await emitStateToMiniPlayer();
    await emitMiniPlayerVisibility(true);
    await targetWindow.show();
    isMiniPlayerWindowVisible.value = true;
    await mainWindow.hide();
  };

  const prewarmMiniPlayerWindow = async () => {
    const existing = await getMiniPlayerWindow();
    if (existing) return;
    if (miniPlayerWindowPromise) return;

    try {
      const targetWindow = await ensureMiniPlayerWindow();
      await waitForMiniPlayerReady();
      await emitStateToMiniPlayer();
      await emitMiniPlayerVisibility(false);
      await targetWindow.hide();
      isMiniPlayerWindowVisible.value = false;
    } catch (error) {
      console.warn('Failed to prewarm mini player window:', error);
    }
  };

  const hideMiniPlayerWindow = async () => {
    const targetWindow = await getMiniPlayerWindow();
    if (!targetWindow) {
      isMiniPlayerWindowVisible.value = false;
      return;
    }

    await emitMiniPlayerVisibility(false);
    await targetWindow.hide();
    isMiniPlayerWindowVisible.value = false;
  };

  const destroyMiniPlayerWindow = async () => {
    const targetWindow = await getMiniPlayerWindow();
    if (!targetWindow) {
      isMiniPlayerWindowVisible.value = false;
      return;
    }

    try {
      await targetWindow.destroy();
    } catch (error) {
      console.warn('Failed to destroy mini player window:', error);
    } finally {
      miniPlayerWindowPromise = null;
      isMiniPlayerWindowVisible.value = false;
    }
  };

  const revealMainWindowFromTray = async () => {
    const keepMiniPlayerVisible = isMiniPlayerWindowVisible.value;
    keepMiniPlayerVisibleOnMiniModeExit = keepMiniPlayerVisible && isMiniMode.value;

    await restoreMainWindowFromMiniMode({
      isMiniMode,
      hideMiniPlayerWindow,
      keepMiniPlayerVisible,
      mainWindow,
    });
  };

  const handleAction = async (action: MiniPlayerAction) => {
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
      case 'set-volume':
        await handleVolume({ target: { value: String(action.volume) } } as unknown as Event);
        break;
      case 'toggle-mute':
        await toggleMute();
        break;
      case 'play-song':
        await playSong(action.song);
        break;
      case 'restore-main':
        await restoreMainWindowFromMiniMode({
          isMiniMode,
          hideMiniPlayerWindow,
          mainWindow,
        });
        break;
      case 'close':
        isMiniMode.value = false;
        await hideMiniPlayerWindow();
        break;
      default:
        break;
    }
  };

  onMounted(async () => {
    unlisteners.push(await mainWindow.onCloseRequested(async (event) => {
      if (settings.value.closeToTray) return;
      if (isMainWindowClosing) return;

      isMainWindowClosing = true;
      event.preventDefault();
      await destroyMiniPlayerWindow();
      await mainWindow.close();
    }));

    unlisteners.push(await listen(MINI_PLAYER_REQUEST_STATE_EVENT, () => {
      void emitStateToMiniPlayer();
    }));

    unlisteners.push(await listen(APP_SHOW_MAIN_EVENT, () => {
      void revealMainWindowFromTray();
    }));

    unlisteners.push(await listen(MINI_PLAYER_READY_EVENT, () => {
      markMiniPlayerReady();
    }));

    unlisteners.push(await listen(MINI_PLAYER_STATE_APPLIED_EVENT, () => {
      resolveMiniPlayerStateApplied?.();
      resolveMiniPlayerStateApplied = null;
    }));

    unlisteners.push(await listen<MiniPlayerAction>(MINI_PLAYER_ACTION_EVENT, (event) => {
      void handleAction(event.payload);
    }));

    unlisteners.push(await listen<MiniPlayerWindowBounds>(MINI_PLAYER_BOUNDS_EVENT, (event) => {
      writeMiniPlayerBounds(event.payload);
    }));

    if (miniPlayerPrewarmTimer === null) {
      miniPlayerPrewarmTimer = window.setTimeout(() => {
        miniPlayerPrewarmTimer = null;
        void prewarmMiniPlayerWindow();
      }, MINI_PLAYER_PREWARM_DELAY_MS);
    }
  });

  onUnmounted(() => {
    clearMiniPlayerPrewarmTimer();
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  });

  watch(isMiniMode, async (visible) => {
    if (visible) {
      await openMiniPlayerWindow();
      return;
    }

    if (keepMiniPlayerVisibleOnMiniModeExit) {
      keepMiniPlayerVisibleOnMiniModeExit = false;
      return;
    }

    await hideMiniPlayerWindow();
  });

  watch(
    [
      currentSong,
      isPlaying,
      volume,
      playQueue,
      songList,
      isDarkTheme,
      () => currentLyricLine.value?.text,
    ],
    () => {
      if (!isMiniPlayerWindowVisible.value) return;
      void emitStateToMiniPlayer();
    },
    { deep: true },
  );
}
