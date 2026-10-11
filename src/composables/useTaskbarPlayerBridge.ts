import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { emitTo, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { onMounted, onUnmounted, ref, toRaw, watch } from 'vue';

import { useCoverCache } from './useCoverCache';
import { usePlayer } from './player';
import { useLyrics } from './lyrics';
import { useThemeSettings } from './useThemeSettings';
import { toggleMainWindowVisibility } from './mainWindowVisibility';
import { useSettings } from '../features/settings/useSettings';
import { createTaskbarPlaybackClockTracker } from '../features/taskbarPlayer/lyrics';
import {
  clampTaskbarLeftOffset,
  resolveTaskbarHorizontalPosition,
  resolveTaskbarPositionScaleFactor,
  type TaskbarHorizontalPosition,
} from '../features/taskbarPlayer/position';
import {
  TASKBAR_PLAYER_WINDOW_LABEL,
  TASKBAR_PLAYER_STATE_EVENT,
  TASKBAR_PLAYER_PLAYBACK_EVENT,
  TASKBAR_PLAYER_STATE_APPLIED_EVENT,
  TASKBAR_PLAYER_ACTION_EVENT,
  TASKBAR_PLAYER_REQUEST_STATE_EVENT,
  TASKBAR_PLAYER_READY_EVENT,
  TASKBAR_PLAYER_VISIBILITY_EVENT,
  TASKBAR_PLAYER_DRAG_EVENT,
  TASKBAR_PLAYER_WINDOW_WIDTH,
  TASKBAR_PLAYER_MIN_WIDTH,
  TASKBAR_PLAYER_MAX_WIDTH,
  normalizeTaskbarWidth,
  normalizeTaskbarLeftOffset,
  TASKBAR_PLAYER_WINDOW_HEIGHT,
  readSavedTaskbarPositionX,
  TASKBAR_PLAYER_POSITION_X_KEY,
  type TaskbarTrayGeometry,
  type TaskbarPlayerStatePayload,
  type TaskbarPlayerPlaybackPayload,
  type TaskbarPlayerAction,
  type TaskbarPlayerDragPayload,
} from '../features/taskbarPlayer/shared';

let taskbarPlayerWindowPromise: Promise<WebviewWindow> | null = null;
let isTaskbarPlayerReady = false;
let taskbarPlayerReadyPromise: Promise<void> | null = null;
let resolveTaskbarPlayerReady: (() => void) | null = null;
let resolveTaskbarPlayerStateApplied: (() => void) | null = null;
let unlistenScaleChange: (() => void) | null = null;

const TASKBAR_FULLSCREEN_CHECK_INTERVAL_MS = 1_000;
const TASKBAR_GEOMETRY_FALLBACK_INTERVAL_MS = 10_000;
const TASKBAR_PLAYBACK_SYNC_INTERVAL_MS = 250;

// 高可用定位并发控制锁
let isPositioning = false;
let pendingPositionUpdate = false;
let isTaskbarPlayerDragging = false;
let configuredWindowWidth = TASKBAR_PLAYER_WINDOW_WIDTH;
let configuredLeftOffset: number | null = null;
let currentPositionBounds: TaskbarHorizontalPosition | null = null;
let persistTaskbarLeftOffset: ((offset: number) => void) | null = null;

interface TaskbarWindowPosition extends TaskbarHorizontalPosition {
  scaleFactor: number;
}

async function ensureTaskbarWindowSize(targetWindow: WebviewWindow) {
  await targetWindow.setSize(new LogicalSize(
    configuredWindowWidth,
    TASKBAR_PLAYER_WINDOW_HEIGHT,
  )).catch((err) => {
    console.warn('Failed to normalize taskbar player size:', err);
  });
}

async function refreshTaskbarWindowTopmost() {
  await invoke<boolean>('refresh_taskbar_window_topmost').then((refreshed) => {
    if (!refreshed) console.warn('Taskbar player topmost refresh could not find its window.');
  }).catch((err) => {
    console.warn('Failed to refresh taskbar player topmost state:', err);
  });
}

async function stabilizeTaskbarWindowGeometry(targetWindow: WebviewWindow) {
  if (isTaskbarPlayerDragging) return;
  await ensureTaskbarWindowSize(targetWindow);
  await updatePosition();
  await refreshTaskbarWindowTopmost();
}

function scheduleTaskbarWindowGeometryStabilization(targetWindow: WebviewWindow) {
  void stabilizeTaskbarWindowGeometry(targetWindow);

  for (const delay of [120, 350, 900, 1600]) {
    window.setTimeout(() => {
      void stabilizeTaskbarWindowGeometry(targetWindow);
    }, delay);
  }
}

async function getTaskbarPositionBounds(): Promise<TaskbarWindowPosition | null> {
  let primary = await primaryMonitor().catch(() => null);
  if (!primary) {
    const monitors = await availableMonitors().catch(() => []);
    primary = monitors.find(monitor => monitor.position.x === 0 && monitor.position.y === 0)
      ?? monitors[0] ?? null;
  }
  const geometry = await invoke<TaskbarTrayGeometry>('get_taskbar_tray_geometry').catch((err) => {
    console.warn('Failed to invoke get_taskbar_tray_geometry:', err);
    return null;
  });
  if (!geometry) return null;

  const scaleFactor = resolveTaskbarPositionScaleFactor(geometry, primary?.scaleFactor);
  const horizontal = resolveTaskbarHorizontalPosition(geometry, configuredWindowWidth, scaleFactor);
  if (horizontal) return { ...horizontal, scaleFactor };

  // Keep the established work-area fallback for a vertical taskbar. Invalid
  // native geometry is retried later instead of being used to migrate a position.
  const rect = geometry.taskbar_rect_physical;
  if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
    || rect.right <= rect.left || rect.bottom <= rect.top || !primary) return null;

  const workArea = primary.workArea.position.toLogical(scaleFactor);
  const workAreaSize = primary.workArea.size.toLogical(scaleFactor);
  const minX = Math.ceil(workArea.x);
  const maxX = Math.max(minX, Math.floor(workArea.x + workAreaSize.width - configuredWindowWidth));
  const baseX = Math.max(minX, Math.min(maxX, Math.round(workArea.x + (workAreaSize.width - configuredWindowWidth) / 2)));
  return {
    minX,
    maxX: baseX,
    baseX,
    y: Math.round(workArea.y + workAreaSize.height - TASKBAR_PLAYER_WINDOW_HEIGHT - 8),
    scaleFactor,
  };
}

// 核心自愈与几何定位控制器（带 pending 控制的并发锁机制）
async function updatePosition() {
  if (isTaskbarPlayerDragging) return;

  const targetWindow = await getTaskbarPlayerWindow();
  if (!targetWindow) return;

  if (isPositioning) {
    pendingPositionUpdate = true;
    return;
  }

  isPositioning = true;
  try {
    do {
      pendingPositionUpdate = false;

      const position = await getTaskbarPositionBounds();
      if (!position || isTaskbarPlayerDragging) break;
      currentPositionBounds = position;

      // Migrate the legacy absolute X only after native geometry is available.
      // Future monitor, width and tray changes use the same relative offset.
      if (configuredLeftOffset === null) {
        const savedX = readSavedTaskbarPositionX();
        configuredLeftOffset = clampTaskbarLeftOffset(
          savedX === null ? 0 : position.baseX - savedX,
          position,
        );
        persistTaskbarLeftOffset?.(configuredLeftOffset);
        if (typeof localStorage !== 'undefined') localStorage.removeItem(TASKBAR_PLAYER_POSITION_X_KEY);
      }

      const offset = clampTaskbarLeftOffset(configuredLeftOffset, position);
      // The geometry was converted with the taskbar monitor's scale. Passing a
      // physical position prevents Tao from applying the window's previous DPI.
      await targetWindow.setPosition(new PhysicalPosition(
        Math.round((position.baseX - offset) * position.scaleFactor),
        Math.round(position.y * position.scaleFactor),
      )).catch((err) => {
        console.warn('Failed to set window position:', err);
      });

    } while (pendingPositionUpdate);
  } finally {
    isPositioning = false;
  }
}

async function getTaskbarPlayerWindow() {
  return WebviewWindow.getByLabel(TASKBAR_PLAYER_WINDOW_LABEL);
}

// 确保并初始化任务栏播控窗口
async function ensureTaskbarPlayerWindow() {
  const existing = await getTaskbarPlayerWindow();
  if (existing) {
    return existing;
  }

  if (!taskbarPlayerWindowPromise) {
    isTaskbarPlayerReady = false;
    taskbarPlayerReadyPromise = null;
    resolveTaskbarPlayerReady = null;

    taskbarPlayerWindowPromise = (async () => {
      // 预创建时的默认虚拟定位，展示时会被 updatePosition 进行秒级精准对齐纠正
      const windowInstance = new WebviewWindow(TASKBAR_PLAYER_WINDOW_LABEL, {
        url: '/',
        title: 'Lycia Taskbar Player',
        width: configuredWindowWidth,
        height: TASKBAR_PLAYER_WINDOW_HEIGHT,
        minWidth: TASKBAR_PLAYER_MIN_WIDTH,
        minHeight: TASKBAR_PLAYER_WINDOW_HEIGHT,
        maxWidth: TASKBAR_PLAYER_MAX_WIDTH,
        maxHeight: TASKBAR_PLAYER_WINDOW_HEIGHT,
        visible: false,
        decorations: false,
        transparent: true,
        shadow: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true, // 前端 Vue 需要 focusable，点击抢焦由 Rust 层 WS_EX_NOACTIVATE 扩展属性解决
        center: false,
        x: 100,
        y: 100,
      });

      return new Promise<WebviewWindow>((resolve, reject) => {
        let settled = false;

        void windowInstance.once('tauri://created', async () => {
          if (settled) return;

          try {
            // 通过 Rust 底层 Win32 接口应用 WS_EX_NOACTIVATE 扩展样式，并绑定主任务栏 Owner
            await invoke('setup_taskbar_window');

            settled = true;
            taskbarPlayerWindowPromise = null;
            resolve(windowInstance);
          } catch (error) {
            settled = true;
            taskbarPlayerWindowPromise = null;
            reject(error);
          }
        });

        void windowInstance.once('tauri://error', (event) => {
          if (settled) return;
          settled = true;
          taskbarPlayerWindowPromise = null;
          reject(event.payload);
        });
      });
    })();
  }

  return taskbarPlayerWindowPromise;
}

function markTaskbarPlayerReady() {
  isTaskbarPlayerReady = true;
  resolveTaskbarPlayerReady?.();
  resolveTaskbarPlayerReady = null;
  taskbarPlayerReadyPromise = null;
}

function waitForTaskbarPlayerReady(timeoutMs = 1500) {
  if (isTaskbarPlayerReady) {
    return Promise.resolve();
  }

  if (!taskbarPlayerReadyPromise) {
    taskbarPlayerReadyPromise = new Promise<void>((resolve) => {
      resolveTaskbarPlayerReady = resolve;
      window.setTimeout(resolve, timeoutMs);
    });
  }

  return taskbarPlayerReadyPromise;
}

function waitForTaskbarPlayerStateApplied(timeoutMs = 500) {
  return new Promise<void>((resolve) => {
    resolveTaskbarPlayerStateApplied = resolve;
    window.setTimeout(resolve, timeoutMs);
  });
}

export function useTaskbarPlayerBridge() {
  const mainWindow = getCurrentWindow();
  const { settings, audioDelay, patchSettings } = useSettings();
  const persistLeftOffset = (offset: number) => patchSettings({ taskbarLeftOffset: offset });
  persistTaskbarLeftOffset = persistLeftOffset;
  watch(
    [() => settings.value.taskbarWindowWidth, () => settings.value.taskbarLeftOffset],
    ([width, offset]) => {
      configuredWindowWidth = normalizeTaskbarWidth(width);
      configuredLeftOffset = offset === null ? null : normalizeTaskbarLeftOffset(offset);
      void getTaskbarPlayerWindow().then(targetWindow => {
        if (targetWindow) return stabilizeTaskbarWindowGeometry(targetWindow);
      }).catch(error => console.warn('Failed to update taskbar window geometry:', error));
    },
    { immediate: true, flush: 'sync' },
  );
  const {
    currentSong,
    currentTime,
    isPlaying,
    togglePlay,
    prevSong,
    nextSong,
  } = usePlayer();
  const { parsedLyrics, lyricsStatus } = useLyrics();
  const { loadCover } = useCoverCache();
  const { isDarkTheme } = useThemeSettings();

  const isTaskbarPlayerVisible = ref(false);
  const unlisteners: Array<() => void> = [];
  let checkTimer: number | null = null;
  let lastGeometryFallbackAt = 0;
  let isMainWindowClosing = false;
  let updateSequence = 0;
  let playbackSyncTimer: ReturnType<typeof setTimeout> | null = null;
  const playbackClockTracker = createTaskbarPlaybackClockTracker();
  let lyricsSongPath = currentSong.value?.path ?? null;
  let dragEventSequence = 0;

  // Audio loading can change currentSong before loadLyrics clears the previous
  // document. Do not label the previous song's lyrics as belonging to the new one.
  watch(parsedLyrics, () => {
    lyricsSongPath = currentSong.value?.path ?? null;
  }, { flush: 'sync' });

  const createPlaybackPayload = (): TaskbarPlayerPlaybackPayload => ({
    songPath: currentSong.value?.path ?? null,
    playbackTime: currentTime.value,
    syncedAt: playbackClockTracker.resolveSyncedAt(currentTime.value),
    isPlaying: isPlaying.value,
    audioDelay: audioDelay.value,
  });

  // Send only the clock on progress ticks; covers and lyric documents change much less often.
  const emitPlaybackToTaskbarPlayer = () => {
    if (!isTaskbarPlayerVisible.value) return;
    void emitTo<TaskbarPlayerPlaybackPayload>(
      TASKBAR_PLAYER_WINDOW_LABEL,
      TASKBAR_PLAYER_PLAYBACK_EVENT,
      createPlaybackPayload(),
    ).catch(error => console.warn('Failed to sync taskbar player playback:', error));
  };

  const cancelPlaybackSync = () => {
    if (playbackSyncTimer !== null) {
      clearTimeout(playbackSyncTimer);
      playbackSyncTimer = null;
    }
  };

  // Preserve the timestamp of the actual sample, including while the main window
  // is in low-power mode. Resuming must not project across time spent paused.
  watch([currentTime, isPlaying, () => currentSong.value?.path], () => {
    playbackClockTracker.markPlaybackTimeSample(currentTime.value);
  }, { immediate: true, flush: 'sync' });

  watch(currentTime, () => {
    if (!isTaskbarPlayerVisible.value || playbackSyncTimer !== null) return;
    playbackSyncTimer = setTimeout(() => {
      playbackSyncTimer = null;
      emitPlaybackToTaskbarPlayer();
    }, TASKBAR_PLAYBACK_SYNC_INTERVAL_MS);
  });

  watch([isPlaying, audioDelay], () => {
    cancelPlaybackSync();
    emitPlaybackToTaskbarPlayer();
  });

  const createStatePayload = async (): Promise<TaskbarPlayerStatePayload> => {
    const song = currentSong.value;
    const coverUrl = song?.path ? await loadCover(song.path).catch(() => '') : '';

    return {
      ...createPlaybackPayload(),
      currentSong: song,
      coverUrl: coverUrl || '',
      isDarkTheme: isDarkTheme.value,
      backgroundOpacity: settings.value.taskbarBackgroundOpacity,
      textColor: settings.value.taskbarTextColor,
      contentMode: settings.value.taskbarContentMode,
      coverShape: settings.value.taskbarCoverShape,
      coverRotate: settings.value.taskbarCoverRotate,
      canDrag: !settings.value.taskbarPositionLocked,
      parsedLyrics: lyricsStatus.value === 'ready' && lyricsSongPath === song?.path
        ? toRaw(parsedLyrics.value)
        : [],
      lyricsStatus: lyricsStatus.value,
    };
  };

  const emitStateToTaskbarPlayer = async () => {
    const currentSeq = ++updateSequence;
    const targetWindow = await getTaskbarPlayerWindow();
    if (!targetWindow) return;

    const payload = await createStatePayload();
    if (currentSeq !== updateSequence || payload.currentSong?.path !== currentSong.value?.path) {
      return;
    }

    const appliedPromise = waitForTaskbarPlayerStateApplied();
    await emitTo<TaskbarPlayerStatePayload>(
      TASKBAR_PLAYER_WINDOW_LABEL,
      TASKBAR_PLAYER_STATE_EVENT,
      payload,
    );
    await appliedPromise;
  };

  const openTaskbarPlayerWindow = async () => {
    const targetWindow = await ensureTaskbarPlayerWindow();
    await waitForTaskbarPlayerReady();
    
    // 对齐最新几何坐标并置顶
    await stabilizeTaskbarWindowGeometry(targetWindow);

    await emitStateToTaskbarPlayer();
    await emitTo(TASKBAR_PLAYER_WINDOW_LABEL, TASKBAR_PLAYER_VISIBILITY_EVENT, { visible: true });
    await targetWindow.show();
    // Install immediately after showing so Shell interactions are guarded while
    // geometry and lyric state finish synchronizing.
    await invoke<boolean>('install_taskbar_zorder_guard').then((installed) => {
      if (!installed) console.warn('Taskbar player z-order guard could not find its window.');
    }).catch((err) => {
      console.warn('Failed to install taskbar z-order guard:', err);
    });
    await stabilizeTaskbarWindowGeometry(targetWindow);
    lastGeometryFallbackAt = Date.now();
    isTaskbarPlayerVisible.value = true;
    // Lyrics may have finished loading during the initial state/show handshake.
    await emitStateToTaskbarPlayer();

    // Tauri 2 官方 API 缩放更改监听绑定
    if (unlistenScaleChange) {
      unlistenScaleChange();
      unlistenScaleChange = null;
    }
    unlistenScaleChange = await targetWindow.onScaleChanged(() => {
      scheduleTaskbarWindowGeometryStabilization(targetWindow);
    }).catch((err) => {
      console.warn('Failed to listen scale change:', err);
      return null;
    });

    // 启动全屏防遮挡及秒级位置自愈轮询
    startCheckLoop();
  };

  const destroyTaskbarPlayerWindow = async () => {
    cancelPlaybackSync();
    updateSequence++;
    dragEventSequence++;
    isTaskbarPlayerDragging = false;
    currentPositionBounds = null;
    stopCheckLoop();
    if (unlistenScaleChange) {
      unlistenScaleChange();
      unlistenScaleChange = null;
    }
    // Stop the guard even if the native window has already disappeared.
    await invoke('uninstall_taskbar_zorder_guard').catch((error) => {
      console.warn('Failed to uninstall taskbar z-order guard:', error);
    });
    const targetWindow = await getTaskbarPlayerWindow();
    if (!targetWindow) {
      isTaskbarPlayerReady = false;
      taskbarPlayerReadyPromise = null;
      resolveTaskbarPlayerReady = null;
      isTaskbarPlayerVisible.value = false;
      return;
    }

    try {
      await targetWindow.destroy();
    } catch (error) {
      console.warn('Failed to destroy taskbar player window:', error);
    } finally {
      taskbarPlayerWindowPromise = null;
      isTaskbarPlayerReady = false;
      taskbarPlayerReadyPromise = null;
      resolveTaskbarPlayerReady = null;
      isTaskbarPlayerVisible.value = false;
    }
  };

  // 全屏切换保持秒级响应；较重的托盘几何查询只做低频兜底，DPI 变化仍由事件立即处理。
  const startCheckLoop = () => {
    if (checkTimer) return;

    checkTimer = window.setInterval(async () => {
      const targetWindow = await getTaskbarPlayerWindow();
      if (!targetWindow || !settings.value.showTaskbarPlayer) return;

      try {
        const state = await invoke<{ isFullscreen: boolean }>('get_foreground_fullscreen_state');
        if (state.isFullscreen) {
          if (isTaskbarPlayerVisible.value) {
            await emitTo(TASKBAR_PLAYER_WINDOW_LABEL, TASKBAR_PLAYER_VISIBILITY_EVENT, { visible: false });
            await targetWindow.hide();
            isTaskbarPlayerVisible.value = false;
            cancelPlaybackSync();
          }
        } else {
          if (!isTaskbarPlayerVisible.value) {
            // 对齐一次坐标并显示
            await stabilizeTaskbarWindowGeometry(targetWindow);
            await emitStateToTaskbarPlayer();
            await emitTo(TASKBAR_PLAYER_WINDOW_LABEL, TASKBAR_PLAYER_VISIBILITY_EVENT, { visible: true });
            await targetWindow.show();
            await stabilizeTaskbarWindowGeometry(targetWindow);
            isTaskbarPlayerVisible.value = true;
            await emitStateToTaskbarPlayer();
          } else if (
            !isTaskbarPlayerDragging
            && Date.now() - lastGeometryFallbackAt >= TASKBAR_GEOMETRY_FALLBACK_INTERVAL_MS
          ) {
            // 低频兜底应对托盘变化或 Explorer 重建，避免每秒重复 Win32 几何查询。
            lastGeometryFallbackAt = Date.now();
            void stabilizeTaskbarWindowGeometry(targetWindow);
          }
        }
      } catch (error) {
        console.warn('Failed in check loop:', error);
      }
    }, TASKBAR_FULLSCREEN_CHECK_INTERVAL_MS);
  };

  const stopCheckLoop = () => {
    if (checkTimer) {
      window.clearInterval(checkTimer);
      checkTimer = null;
    }
  };

  const handleAction = async (action: TaskbarPlayerAction) => {
    switch (action.type) {
      case 'toggle-main-window':
        await toggleMainWindowVisibility(mainWindow);
        break;
      case 'toggle-play':
        await togglePlay();
        break;
      case 'prev-song':
        prevSong();
        break;
      case 'next-song':
        nextSong();
        break;
      case 'close':
        settings.value.showTaskbarPlayer = false;
        break;
      case 'set-left-offset':
      case 'align-left': {
        const position = await getTaskbarPositionBounds();
        if (position) currentPositionBounds = position;
        const offset = action.type === 'align-left'
          ? position ? position.baseX - position.minX : null
          : normalizeTaskbarLeftOffset(action.offset);
        if (offset !== null) {
          persistLeftOffset(position ? clampTaskbarLeftOffset(offset, position) : offset);
        }
        break;
      }
      default:
        break;
    }
  };

  onMounted(async () => {
    unlisteners.push(
      await mainWindow.onCloseRequested(async (event) => {
        if (settings.value.closeToTray) return;
        if (isMainWindowClosing) return;
        isMainWindowClosing = true;
        event.preventDefault();
        await destroyTaskbarPlayerWindow();
        await mainWindow.close();
      })
    );

    unlisteners.push(
      await listen(TASKBAR_PLAYER_REQUEST_STATE_EVENT, () => {
        void emitStateToTaskbarPlayer();
      })
    );

    unlisteners.push(
      await listen(TASKBAR_PLAYER_READY_EVENT, () => {
        markTaskbarPlayerReady();
      })
    );

    unlisteners.push(
      await listen(TASKBAR_PLAYER_STATE_APPLIED_EVENT, () => {
        resolveTaskbarPlayerStateApplied?.();
        resolveTaskbarPlayerStateApplied = null;
      })
    );

    unlisteners.push(
      await listen<TaskbarPlayerAction>(TASKBAR_PLAYER_ACTION_EVENT, (event) => {
        void handleAction(event.payload);
      })
    );

    unlisteners.push(
      await listen<TaskbarPlayerDragPayload>(TASKBAR_PLAYER_DRAG_EVENT, async (event) => {
        const sequence = ++dragEventSequence;
        if (event.payload.dragging) {
          isTaskbarPlayerDragging = true;
          return;
        }
        if (event.payload.leftOffset !== undefined) {
          const position = await getTaskbarPositionBounds() ?? currentPositionBounds;
          if (sequence !== dragEventSequence) return;
          if (position) currentPositionBounds = position;
          const offset = normalizeTaskbarLeftOffset(event.payload.leftOffset);
          // Persist the released position before automatic positioning resumes.
          persistLeftOffset(position ? clampTaskbarLeftOffset(offset, position) : offset);
        }
        if (sequence !== dragEventSequence) return;
        isTaskbarPlayerDragging = false;
        void getTaskbarPlayerWindow().then(targetWindow => {
          if (targetWindow) return stabilizeTaskbarWindowGeometry(targetWindow);
        }).catch(error => console.warn('Failed to stabilize taskbar window after dragging:', error));
      })
    );

    // 观察用户配置的开启/关闭
    watch(
      () => settings.value.showTaskbarPlayer,
      async (enabled) => {
        if (enabled) {
          await openTaskbarPlayerWindow();
        } else {
          await destroyTaskbarPlayerWindow();
        }
      },
      { immediate: true }
    );

    // 观察播放器核心状态改变，向子窗口推送
    watch(
      [
        currentSong,
        isDarkTheme,
        parsedLyrics,
        () => settings.value.taskbarBackgroundOpacity,
        () => settings.value.taskbarTextColor,
        () => settings.value.taskbarContentMode,
        () => settings.value.taskbarCoverShape,
        () => settings.value.taskbarCoverRotate,
        () => settings.value.taskbarPositionLocked,
        lyricsStatus,
      ],
      () => {
        if (!isTaskbarPlayerVisible.value) return;
        void emitStateToTaskbarPlayer();
      },
      { deep: true }
    );
  });

  onUnmounted(() => {
    cancelPlaybackSync();
    updateSequence++;
    stopCheckLoop();
    if (unlistenScaleChange) {
      unlistenScaleChange();
      unlistenScaleChange = null;
    }
    unlisteners.splice(0).forEach((unlisten) => unlisten());
    dragEventSequence++;
    if (persistTaskbarLeftOffset === persistLeftOffset) persistTaskbarLeftOffset = null;
  });
}
