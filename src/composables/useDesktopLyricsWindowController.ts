import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow, availableMonitors, currentMonitor, cursorPosition } from '@tauri-apps/api/window';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { computed, onMounted, onUnmounted, ref, watch, type CSSProperties, type Ref } from 'vue';

import { loadSystemLyricsFonts } from './lyrics';
import {
  DESKTOP_LYRICS_BOUNDS_EVENT,
  DESKTOP_LYRICS_PLAYBACK_EVENT,
  DESKTOP_LYRICS_READY_EVENT,
  DESKTOP_LYRICS_REVEAL_SURFACE_EVENT,
  DESKTOP_LYRICS_REQUEST_STATE_EVENT,
  DESKTOP_LYRICS_STATE_EVENT,
  DESKTOP_LYRICS_VISIBILITY_EVENT,
  type DesktopLyricsPlaybackPayload,
  type DesktopLyricsStatePayload,
  type DesktopLyricsWindowBounds,
  type DesktopLyricsWindowSettings,
} from '../features/desktopLyrics/shared';
import { windowApi } from '../services/tauri/windowApi';

const FULLSCREEN_POLL_INTERVAL_MS = 300;
const RESIZE_VISIBILITY_HOLD_MS = 1200;

export function shouldAutoHideDesktopLyrics({
  isAlwaysOnTop = false,
  autoHideWhenFullscreen,
  autoHideWhenPaused,
  isForegroundFullscreen,
  isPlaying,
  isResizeInteractionActive,
}: {
  isAlwaysOnTop?: boolean;
  autoHideWhenFullscreen: boolean;
  autoHideWhenPaused: boolean;
  isForegroundFullscreen: boolean;
  isPlaying: boolean;
  isResizeInteractionActive: boolean;
}) {
  if (isResizeInteractionActive) {
    return false;
  }

  return (!isAlwaysOnTop && autoHideWhenFullscreen && isForegroundFullscreen)
    || (autoHideWhenPaused && !isPlaying);
}

export function useDesktopLyricsWindowController(options: {
  showDragShadow: Ref<boolean>;
  settings: Ref<DesktopLyricsWindowSettings>;
  playbackTime: Ref<number>;
  isPlaying: Ref<boolean>;
  handlePayload: (payload: DesktopLyricsStatePayload) => void;
  handlePlaybackPayload: (payload: DesktopLyricsPlaybackPayload) => void;
}) {
  const {
    showDragShadow,
    settings,
    playbackTime,
    isPlaying,
    handlePayload,
    handlePlaybackPayload,
  } = options;

  const appWindow = getCurrentWindow();
  let isApplyingCenterPosition = false;
  let hasReceivedState = false;

  async function forceCenterHorizontally() {
    if (isApplyingCenterPosition) return;
    isApplyingCenterPosition = true;
    try {
      let monitor = await currentMonitor();
      if (!monitor) {
        const monitors = await availableMonitors();
        if (monitors.length > 0) {
          monitor = monitors[0];
        }
      }
      if (!monitor) return;

      const workArea = monitor.workArea;
      const size = await appWindow.outerSize();
      const position = await appWindow.outerPosition();
      const targetX = workArea.position.x + Math.round((workArea.size.width - size.width) / 2);

      if (Math.abs(position.x - targetX) > 1) {
        await appWindow.setPosition(new PhysicalPosition(targetX, position.y));

        await emitWindowBounds({
          x: targetX,
          y: position.y,
          width: size.width,
          height: size.height,
        });
      }
    } catch (error) {
      console.warn('Failed to force center horizontally:', error);
    } finally {
      isApplyingCenterPosition = false;
    }
  }
  const isSystemHidden = ref(false);
  const isHoverDimmed = ref(false);
  const isToolbarVisible = ref(false);
  const isResizeInteractionActive = ref(false);
  const isCursorOverLockButton = ref(false);
  let lockPollingTimer: ReturnType<typeof setInterval> | null = null;

  const isAutoHidden = computed(() => shouldAutoHideDesktopLyrics({
    isAlwaysOnTop: settings.value.isAlwaysOnTop,
    autoHideWhenFullscreen: settings.value.autoHideWhenFullscreen,
    autoHideWhenPaused: settings.value.autoHideWhenPaused,
    isForegroundFullscreen: isSystemHidden.value,
    isPlaying: isPlaying.value,
    isResizeInteractionActive: isResizeInteractionActive.value,
  }));

  let hoverDimTimer: ReturnType<typeof setTimeout> | null = null;
  let toolbarHideTimer: ReturnType<typeof setTimeout> | null = null;
  let autoHideTimer: ReturnType<typeof setInterval> | null = null;
  let resizeVisibilityTimer: ReturnType<typeof setTimeout> | null = null;
  let frameId = 0;
  let dragShadowTimer: ReturnType<typeof setTimeout> | null = null;
  let unlistenState: (() => void) | null = null;
  let unlistenPlayback: (() => void) | null = null;
  let unlistenRevealSurface: (() => void) | null = null;
  let unlistenCloseRequested: (() => void) | null = null;
  let unlistenMoved: (() => void) | null = null;
  let unlistenResized: (() => void) | null = null;

  function startPlaybackClock() {
    stopPlaybackClock();

    let lastTime = performance.now();
    const tick = (now: number) => {
      if (isPlaying.value) {
        playbackTime.value += (now - lastTime) / 1000;
      }

      lastTime = now;
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
  }

  function stopPlaybackClock() {
    if (frameId !== 0) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
  }

  function startAutoHideLoop() {
    stopAutoHideLoop();

    const pollForegroundFullscreen = async () => {
      if (isResizeInteractionActive.value) {
        isSystemHidden.value = false;
        return;
      }

      if (!settings.value.autoHideWhenFullscreen) {
        isSystemHidden.value = false;
        return;
      }

      try {
        const state = await windowApi.getForegroundFullscreenState();
        isSystemHidden.value = state.isFullscreen;
      } catch {
        isSystemHidden.value = false;
      }
    };

    autoHideTimer = setInterval(async () => {
      await pollForegroundFullscreen();
    }, FULLSCREEN_POLL_INTERVAL_MS);

    void pollForegroundFullscreen();
  }

  function stopAutoHideLoop() {
    if (autoHideTimer) {
      clearInterval(autoHideTimer);
      autoHideTimer = null;
    }
  }

  async function checkLockCursorProximity() {
    if (!settings.value.isLocked) return;
    try {
      const position = await cursorPosition(); // Global physical coordinates
      const winPos = await appWindow.outerPosition(); // Window physical coordinates
      const size = await appWindow.outerSize(); // Window physical size
      const scaleFactor = await appWindow.scaleFactor();

      const W = size.width;
      const x = position.x - winPos.x;
      const y = position.y - winPos.y;

      const toleranceY = 48 * scaleFactor;
      const toleranceX = 28 * scaleFactor;

      const centerX = W / 2;
      const isOver = y >= 0 && y <= toleranceY && x >= centerX - toleranceX && x <= centerX + toleranceX;

      if (settings.value.isLocked) {
        isToolbarVisible.value = isOver;
      }

      if (isOver !== isCursorOverLockButton.value) {
        isCursorOverLockButton.value = isOver;
        await applyTransientWindowFlags();
      }
    } catch (err) {
      console.warn('Failed to check cursor proximity:', err);
    }
  }

  function startLockPolling() {
    stopLockPolling();
    lockPollingTimer = setInterval(() => {
      void checkLockCursorProximity();
    }, 80);
  }

  function stopLockPolling() {
    if (lockPollingTimer) {
      clearInterval(lockPollingTimer);
      lockPollingTimer = null;
    }
    isCursorOverLockButton.value = false;
  }

  async function applyTransientWindowFlags() {
    const shouldIgnoreCursor = (settings.value.isLocked && !isCursorOverLockButton.value) || isAutoHidden.value;
    await appWindow.setIgnoreCursorEvents(shouldIgnoreCursor);
    await appWindow.setFocusable(!shouldIgnoreCursor);
  }

  async function applyAlwaysOnTopState(enabled: boolean) {
    await appWindow.setAlwaysOnTop(enabled);
    await windowApi.refreshCurrentWindowTopmost(enabled);

    if (enabled) {
      await windowApi.startTopmostGuard();
      return;
    }

    await windowApi.stopTopmostGuard();
  }

  function clearHoverDimTimer() {
    if (hoverDimTimer) {
      clearTimeout(hoverDimTimer);
      hoverDimTimer = null;
    }
  }

  function clearToolbarHideTimer() {
    if (toolbarHideTimer) {
      clearTimeout(toolbarHideTimer);
      toolbarHideTimer = null;
    }
  }

  function clearResizeVisibilityTimer() {
    if (resizeVisibilityTimer) {
      clearTimeout(resizeVisibilityTimer);
      resizeVisibilityTimer = null;
    }
  }

  function holdVisibleForResize() {
    clearResizeVisibilityTimer();
    clearHoverDimTimer();
    clearToolbarHideTimer();

    isResizeInteractionActive.value = true;
    isSystemHidden.value = false;
    isHoverDimmed.value = false;
    revealToolbar();
    revealDragShadow();

    resizeVisibilityTimer = setTimeout(() => {
      isResizeInteractionActive.value = false;
      resizeVisibilityTimer = null;
    }, RESIZE_VISIBILITY_HOLD_MS);
  }

  function revealToolbar() {
    clearToolbarHideTimer();

    if (settings.value.isLocked || isAutoHidden.value) {
      isToolbarVisible.value = false;
      return;
    }

    isToolbarVisible.value = true;
  }

  function hideToolbar(delay = 140) {
    clearToolbarHideTimer();

    toolbarHideTimer = setTimeout(() => {
      isToolbarVisible.value = false;
      toolbarHideTimer = null;
    }, delay);
  }

  function revealDragShadow() {
    showDragShadow.value = true;

    if (dragShadowTimer) {
      clearTimeout(dragShadowTimer);
    }

    dragShadowTimer = setTimeout(() => {
      showDragShadow.value = false;
      dragShadowTimer = null;
    }, 1500);
  }

  function queueHoverDim() {
    clearHoverDimTimer();

    if (settings.value.isLocked || isAutoHidden.value || isResizeInteractionActive.value) {
      return;
    }

    hoverDimTimer = setTimeout(() => {
      isHoverDimmed.value = true;
    }, 850);
  }

  function handlePointerEnter() {
    if (settings.value.isLocked) {
      return;
    }
    revealToolbar();
    isHoverDimmed.value = false;
    queueHoverDim();
  }

  function handlePointerMove() {
    if (settings.value.isLocked) {
      return;
    }

    revealToolbar();
    isHoverDimmed.value = false;
    queueHoverDim();
  }

  function handlePointerLeave() {
    if (settings.value.isLocked) {
      return;
    }
    clearHoverDimTimer();
    isHoverDimmed.value = false;

    if (isResizeInteractionActive.value) {
      return;
    }

    hideToolbar();
  }

  async function startWindowDrag(event: MouseEvent) {
    if (settings.value.isLocked || isAutoHidden.value) return;
    if ((event.target as HTMLElement).closest('button, .settings-menu')) return;

    revealDragShadow();
    await appWindow.startDragging();
  }

  async function emitWindowBounds(bounds: DesktopLyricsWindowBounds) {
    await emitTo<DesktopLyricsWindowBounds>('main', DESKTOP_LYRICS_BOUNDS_EVENT, bounds);
  }

  const widgetShellStyle = computed<CSSProperties>(() => ({
    opacity: isAutoHidden.value ? '0' : (isHoverDimmed.value ? '0.34' : '1'),
    transform: isAutoHidden.value ? 'scale(0.96)' : 'scale(1)',
    pointerEvents: isAutoHidden.value ? 'none' : 'auto',
  }));

  onMounted(async () => {
    startPlaybackClock();
    startAutoHideLoop();
    void loadSystemLyricsFonts();

    try {
      await appWindow.setBackgroundColor([0, 0, 0, 0]);
    } catch (error) {
      console.warn('Failed to force transparent background for desktop lyrics window:', error);
    }

    unlistenState = await appWindow.listen<DesktopLyricsStatePayload>(DESKTOP_LYRICS_STATE_EVENT, (event) => {
      handlePayload(event.payload);
      hasReceivedState = true;
    });

    unlistenPlayback = await appWindow.listen<DesktopLyricsPlaybackPayload>(DESKTOP_LYRICS_PLAYBACK_EVENT, (event) => {
      handlePlaybackPayload(event.payload);
    });

    unlistenRevealSurface = await appWindow.listen(DESKTOP_LYRICS_REVEAL_SURFACE_EVENT, () => {
      revealDragShadow();
    });

    revealDragShadow();

    unlistenCloseRequested = await appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await appWindow.hide();
      await emitTo('main', DESKTOP_LYRICS_VISIBILITY_EVENT, { visible: false });
    });

    unlistenMoved = await appWindow.onMoved(async ({ payload }) => {
      revealDragShadow();
      const size = await appWindow.outerSize();

      await emitWindowBounds({
        x: payload.x,
        y: payload.y,
        width: size.width,
        height: size.height,
      });
    });

    unlistenResized = await appWindow.onResized(async ({ payload }) => {
      holdVisibleForResize();
      const position = await appWindow.outerPosition();

      await emitWindowBounds({
        x: position.x,
        y: position.y,
        width: payload.width,
        height: payload.height,
      });
    });

    try {
      await emitTo('main', DESKTOP_LYRICS_READY_EVENT);
      await emitTo('main', DESKTOP_LYRICS_REQUEST_STATE_EVENT);
    } catch (error) {
      console.warn('Failed to notify main window that desktop lyrics is ready:', error);
    }
  });

  onUnmounted(() => {
    stopLockPolling();
    stopPlaybackClock();
    stopAutoHideLoop();
    clearHoverDimTimer();
    clearToolbarHideTimer();
    clearResizeVisibilityTimer();
    unlistenState?.();
    unlistenPlayback?.();
    unlistenRevealSurface?.();
    unlistenCloseRequested?.();
    unlistenMoved?.();
    unlistenResized?.();
    void windowApi.stopTopmostGuard();

    if (dragShadowTimer) {
      clearTimeout(dragShadowTimer);
      dragShadowTimer = null;
    }
  });

  watch(
    () => [settings.value.isLocked, isAutoHidden.value],
    () => {
      if (settings.value.isLocked) {
        clearToolbarHideTimer();
        clearHoverDimTimer();
        isHoverDimmed.value = false;
        isToolbarVisible.value = false;
        if (!isAutoHidden.value) {
          startLockPolling();
        } else {
          stopLockPolling();
        }
      } else {
        stopLockPolling();
      }
      void applyTransientWindowFlags();
    },
    { immediate: true },
  );

  watch(
    () => settings.value.autoHideWhenFullscreen,
    (enabled) => {
      if (!enabled) {
        isSystemHidden.value = false;
      }
    },
  );

  watch(
    () => settings.value.isAlwaysOnTop,
    (enabled) => {
      void applyAlwaysOnTopState(enabled);
    },
    { immediate: true },
  );

  watch(
    () => settings.value.centerHorizontally,
    (enabled, previous) => {
      // Restoring a saved setting is not a new request to reposition the window.
      // Center once when explicitly enabled; later drags and resizes stay put.
      if (hasReceivedState && enabled && previous === false) {
        void forceCenterHorizontally();
      }
    },
    { flush: 'sync' },
  );

  return {
    showDragShadow,
    isSystemHidden,
    isToolbarVisible,
    isCursorOverLockButton,
    widgetShellStyle,
    handlePointerEnter,
    handlePointerMove,
    handlePointerLeave,
    startWindowDrag,
  };
}
