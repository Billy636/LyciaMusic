import { emitTo, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getWebviewDataDirectory } from '../services/storage/dataStorage';
import { availableMonitors, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { onMounted, onUnmounted, ref, toRaw, watch } from 'vue';

import { useCoverCache } from './useCoverCache';
import { useLibrarySongResolver } from './useLibrarySongResolver';
import { usePlayer } from './player';
import { useLyrics } from './lyrics';
import { useThemeSettings } from './useThemeSettings';
import { toggleMainWindowVisibility } from './mainWindowVisibility';
import { useSettings } from '../features/settings/useSettings';
import { createTaskbarPlaybackClockTracker } from '../features/taskbarPlayer/lyrics';
import { commitSongSwitch } from '../features/songNotification/manualSwitch';
import {
  clampTaskbarLeftOffset,
  resolveTaskbarHorizontalPosition,
  resolveTaskbarPositionScaleFactor,
  resolveExpandedWindowTop,
  type TaskbarHorizontalPosition,
  type TaskbarWorkAreaBounds,
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
  normalizeTaskbarFreePosition,
  TASKBAR_PLAYER_WINDOW_HEIGHT,
  TASKBAR_PLAYER_PANEL_HEIGHT,
  TASKBAR_PLAYER_WINDOW_MAX_HEIGHT,
  TASKBAR_PLAYER_PANEL_EVENT,
  TASKBAR_PLAYER_PANEL_REQUEST_EVENT,
  TASKBAR_PLAYER_QUEUE_EVENT,
  readSavedTaskbarPositionX,
  TASKBAR_PLAYER_POSITION_X_KEY,
  type TaskbarTrayGeometry,
  type TaskbarPlayerStatePayload,
  type TaskbarPlayerPlaybackPayload,
  type TaskbarPlayerAction,
  type TaskbarPlayerDragPayload,
  type TaskbarFreePosition,
  type TaskbarPlayerPanelPayload,
  type TaskbarPlayerQueuePayload,
} from '../features/taskbarPlayer/shared';

let taskbarPlayerWindowPromise: Promise<WebviewWindow> | null = null;
let isTaskbarPlayerReady = false;
let taskbarPlayerReadyPromise: Promise<void> | null = null;
let resolveTaskbarPlayerReady: (() => void) | null = null;
let resolveTaskbarPlayerStateApplied: (() => void) | null = null;
let unlistenScaleChange: (() => void) | null = null;

// 一次性迁移：旧版本默认“未锁定”，偏移量还是“距托盘”的语义，且曾把绝对 X
// 写进 localStorage。升级后统一成「锁定 + 贴底栏最左」，之后完全尊重用户设置。
const DOCK_DEFAULTS_FLAG = 'taskbar_dock_defaults_v2';
const hasMigratedDockDefaults = () => {
  try {
    return typeof localStorage === 'undefined'
      || localStorage.getItem(DOCK_DEFAULTS_FLAG) === '1';
  } catch {
    return true;
  }
};
const markDockDefaultsMigrated = () => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DOCK_DEFAULTS_FLAG, '1');
  } catch {
    // 忽略隐私模式下的写入失败，下次启动会再尝试一次。
  }
};

const TASKBAR_FULLSCREEN_CHECK_INTERVAL_MS = 1_000;
const TASKBAR_GEOMETRY_FALLBACK_INTERVAL_MS = 10_000;
const TASKBAR_PLAYBACK_SYNC_INTERVAL_MS = 250;

// 高可用定位并发控制锁
let isPositioning = false;
let pendingPositionUpdate = false;
let isTaskbarPlayerDragging = false;
// 边缘拉伸期间只走 updatePosition 一条几何链路：避免 watcher 的「尺寸自愈 +
// 重定位」两套 IPC 并发执行，左边缘因位置也在变会表现为闪烁/顿挫。
let isResizingTaskbar = false;
let resizeGeometryTimer: number | undefined;
const markTaskbarResizing = () => {
  isResizingTaskbar = true;
  if (resizeGeometryTimer !== undefined) window.clearTimeout(resizeGeometryTimer);
  resizeGeometryTimer = window.setTimeout(() => {
    resizeGeometryTimer = undefined;
    isResizingTaskbar = false;
  }, 140);
};
let configuredWindowWidth = TASKBAR_PLAYER_WINDOW_WIDTH;
let configuredLeftOffset: number | null = null;
let configuredFreePosition: TaskbarFreePosition | null = null;
let isPositionLocked = true;
let isQueuePanelOpen = false;
// 展开态下用户亲手拖拽放下的位置：原样保留，即使已越出工作区。
// 只在「开合面板」这个动作上清空，因此展开瞬间的自适应边界定位完全不受影响。
let freePlacementFromUserDrag = false;
// 每次启动播放器后，「第一次」打开铃动窗时回到默认停靠点（底栏、距左 0px）；
// 同一次运行里之后再关再开，都沿用上次拖拽的位置。
let hasResetPlacementThisSession = false;
let isAlwaysOnTopSetting = true;
let currentPositionBounds: TaskbarHorizontalPosition | null = null;
let persistTaskbarLeftOffset: ((offset: number) => void) | null = null;
let persistTaskbarFreePosition: ((position: TaskbarFreePosition | null) => void) | null = null;

interface TaskbarWindowPosition extends TaskbarHorizontalPosition {
  scaleFactor: number;
}

const panelOffset = () => (isQueuePanelOpen ? TASKBAR_PLAYER_PANEL_HEIGHT : 0);

// 主屏工作区（不含任务栏）的纵向边界，用于边界感知的展开定位。
// 换算到逻辑像素以与窗口 setPosition/setSize 的口径一致。
async function getPrimaryWorkAreaBounds(): Promise<TaskbarWorkAreaBounds | null> {
  let primary = await primaryMonitor().catch(() => null);
  if (!primary) {
    const monitors = await availableMonitors().catch(() => []);
    primary = monitors.find(monitor => monitor.position.x === 0 && monitor.position.y === 0)
      ?? monitors[0] ?? null;
  }
  if (!primary) return null;
  const scaleFactor = Number.isFinite(primary.scaleFactor) && primary.scaleFactor > 0
    ? primary.scaleFactor : 1;
  const position = primary.workArea.position.toLogical(scaleFactor);
  const size = primary.workArea.size.toLogical(scaleFactor);
  return { top: position.y, bottom: position.y + size.height };
}

// tao 的接口：先调整 min/max，再 setSize，最后 setPosition。
async function applyTaskbarBounds(
  targetWindow: WebviewWindow,
  x: number,
  y: number,
  width: number,
  height: number,
  scaleFactor: number,
) {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return;
  const size = new LogicalSize(width, height);
  try {
    // 先移动再改尺寸：两者是独立的 IPC，先定位能让播控条始终停留在可视区域。
    await targetWindow.setPosition(new PhysicalPosition(
      Math.round(x * scaleFactor),
      Math.round(y * scaleFactor),
    ));
    const scale = await targetWindow.scaleFactor();
    const currentHeight = (await targetWindow.innerSize()).toLogical(scale).height;
    if (height >= currentHeight) {
      // 展开：先放宽上限，再抬升下限，最后同步尺寸。
      await targetWindow.setMaxSize(size);
      await targetWindow.setMinSize(size);
    } else {
      await targetWindow.setMinSize(size);
      await targetWindow.setMaxSize(size);
    }
    await targetWindow.setSize(size);
  } catch (err) {
    console.warn('Failed to apply taskbar player bounds:', err);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('lycia_taskbar_bounds_error', JSON.stringify({
          error: String(err), x, y, width, height, scaleFactor, at: Date.now(),
        }));
      }
    } catch {
      // 诊断写入失败时忽略。
    }
  }
}

async function ensureTaskbarWindowSize(targetWindow: WebviewWindow) {
  try {
    const [physical, scaleFactor] = await Promise.all([
      targetWindow.outerPosition(),
      targetWindow.scaleFactor(),
    ]);
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return;
    const nextHeight = TASKBAR_PLAYER_WINDOW_HEIGHT + panelOffset();
    // 只做尺寸自愈，顶边保持不变；精确的边界感知定位由紧随其后的
    // updatePosition 负责。此处不再无条件把窗口上顶一个面板高度，
    // 否则展开瞬间会把播控条顶飞、面板沉出屏幕底边。
    await applyTaskbarBounds(
      targetWindow,
      physical.x / scaleFactor,
      physical.y / scaleFactor,
      configuredWindowWidth,
      nextHeight,
      scaleFactor,
    );
  } catch (error) {
    console.warn('Failed to normalize taskbar player size:', error);
  }
}

async function refreshTaskbarWindowTopmost() {
  await invoke<boolean>('refresh_taskbar_window_topmost').then((refreshed) => {
    if (!refreshed) console.warn('Taskbar player topmost refresh could not find its window.');
  }).catch((err) => {
    console.warn('Failed to refresh taskbar player topmost state:', err);
  });
}

async function stabilizeTaskbarWindowGeometry(targetWindow: WebviewWindow) {
  if (isTaskbarPlayerDragging || isResizingTaskbar) return;
  await ensureTaskbarWindowSize(targetWindow);
  await updatePosition();
  if (isAlwaysOnTopSetting) await refreshTaskbarWindowTopmost();
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
  return {
    minX,
    maxX,
    baseX: minX,
    y: Math.round(workArea.y + workAreaSize.height - TASKBAR_PLAYER_WINDOW_HEIGHT - 8),
    scaleFactor,
  };
}

// 解锁后的自由位置以逻辑坐标保存，并按窗口所在显示器的缩放换算回物理像素。
async function applyFreePosition(targetWindow: WebviewWindow, position: TaskbarFreePosition) {
  const scaleFactor = await targetWindow.scaleFactor();
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return;
  const height = TASKBAR_PLAYER_WINDOW_HEIGHT + panelOffset();
  // 边界感知：先以用户放置的播控条锚点为顶边展开面板，底部越过工作区下界时
  // 才整体上移，顶部也不越过工作区上界。这样铃动窗在屏幕上/中/下任意位置
  // 展开都能完整呈现；收起时 panelOffset 为 0，锚点即原位置，仍可藏边。
  // 展开瞬间（面板开合）才做边界感知；用户亲手拖拽后原样落位，允许拖出桌面边界。
  const workArea = panelOffset() > 0 && !freePlacementFromUserDrag
    ? await getPrimaryWorkAreaBounds() : null;
  const y = resolveExpandedWindowTop(position.y, height, workArea);
  await applyTaskbarBounds(
    targetWindow,
    position.x,
    y,
    configuredWindowWidth,
    height,
    scaleFactor,
  );
}

async function seedFreePositionFromCurrentWindow(targetWindow: WebviewWindow): Promise<TaskbarFreePosition | null> {
  try {
    const [physical, scaleFactor] = await Promise.all([
      targetWindow.outerPosition(),
      targetWindow.scaleFactor(),
    ]);
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return null;
    // 播控条位于窗口顶部，窗口左上角即播控条锚点；面板在其下方展开。
    // 统一以播控条位置作为自由坐标锚点，展开/收起切换时播控条才不会漂移。
    const position = {
      x: Math.round(physical.x / scaleFactor),
      y: Math.round(physical.y / scaleFactor),
    };
    configuredFreePosition = position;
    persistTaskbarFreePosition?.(position);
    return position;
  } catch (error) {
    console.warn('Failed to read the current taskbar player position:', error);
    return null;
  }
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

      if (isTaskbarPlayerDragging) break;

      // 解锁状态：沿用最后一次自由拖拽的位置，不再吸附到底栏。
      if (!isPositionLocked) {
        if (!configuredFreePosition) {
          // 首次解锁（或旧版本升级后仍是可拖动状态）时以底栏位置作为起点，
          // 避免窗口创建时的临时坐标被当成用户选择的位置。
          const dock = await getTaskbarPositionBounds();
          if (dock) {
            const offset = clampTaskbarLeftOffset(configuredLeftOffset ?? 0, dock);
            configuredFreePosition = {
              x: Math.round(dock.minX + offset),
              y: Math.round(dock.y),
            };
            currentPositionBounds = dock;
            persistTaskbarFreePosition?.(configuredFreePosition);
          }
        }
        const freePosition = configuredFreePosition
          ?? await seedFreePositionFromCurrentWindow(targetWindow);
        if (freePosition) await applyFreePosition(targetWindow, freePosition);
        continue;
      }

      const position = await getTaskbarPositionBounds();
      if (!position || isTaskbarPlayerDragging) break;
      currentPositionBounds = position;

      // Migrate the legacy absolute X only after native geometry is available.
      // Future monitor, width and tray changes use the same relative offset.
      if (configuredLeftOffset === null) {
        const savedX = readSavedTaskbarPositionX();
        configuredLeftOffset = clampTaskbarLeftOffset(
          savedX === null ? 0 : savedX - position.minX,
          position,
        );
        persistTaskbarLeftOffset?.(configuredLeftOffset);
        if (typeof localStorage !== 'undefined') localStorage.removeItem(TASKBAR_PLAYER_POSITION_X_KEY);
      }

      // 允许负偏移：拖到屏幕左边缘外时可以继续把卡片藏出去。
      const offset = clampTaskbarLeftOffset(
        configuredLeftOffset,
        position,
        Math.max(0, configuredWindowWidth - 18),
      );
      // The geometry was converted with the taskbar monitor's scale. Passing a
      // physical position prevents Tao from applying the window's previous DPI.
      const height = TASKBAR_PLAYER_WINDOW_HEIGHT + panelOffset();
      // 边界感知：底栏停靠位置作为播控条锚点，向下展开面板；仅在底部越过
      // 工作区下界时整体上移，保证铃动窗在底栏区域展开也完整呈现。
      const workArea = panelOffset() > 0
        ? await getPrimaryWorkAreaBounds() : null;
      const top = resolveExpandedWindowTop(position.y, height, workArea);
      await applyTaskbarBounds(
        targetWindow,
        position.minX + offset,
        top,
        configuredWindowWidth,
        height,
        position.scaleFactor,
      );

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
        dataDirectory: getWebviewDataDirectory(),
        url: '/',
        title: 'Lycia 铃动窗',
        width: configuredWindowWidth,
        height: TASKBAR_PLAYER_WINDOW_HEIGHT,
        minWidth: TASKBAR_PLAYER_MIN_WIDTH,
        minHeight: TASKBAR_PLAYER_WINDOW_HEIGHT,
        maxWidth: TASKBAR_PLAYER_MAX_WIDTH,
        maxHeight: TASKBAR_PLAYER_WINDOW_MAX_HEIGHT,
        visible: false,
        decorations: false,
        transparent: true,
        shadow: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: isAlwaysOnTopSetting,
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
  const persistFreePosition = (position: TaskbarFreePosition | null) => {
    patchSettings({ taskbarFreePosition: position });
  };
  persistTaskbarFreePosition = persistFreePosition;
  watch(
    [
      () => settings.value.taskbarWindowWidth,
      () => settings.value.taskbarLeftOffset,
      () => settings.value.taskbarPositionLocked,
      () => settings.value.taskbarFreePosition,
    ],
    ([width, offset, positionLocked, freePosition]) => {
      configuredWindowWidth = normalizeTaskbarWidth(width, TASKBAR_PLAYER_MAX_WIDTH);
      configuredLeftOffset = offset === null ? null : normalizeTaskbarLeftOffset(offset);
      const nextLocked = positionLocked !== false;
      const relocking = !isPositionLocked && nextLocked;
      // 先更新锁定状态，再持久化偏移，避免同步 watch 再次进入时重复归零。
      isPositionLocked = nextLocked;
      if (relocking) {
        // 从「解锁」切回「锁定」：默认贴左（距左边缘 0px）。
        // 统一在 watch 处理，铃动窗锁头与设置面板开关两个入口都能生效。
        configuredLeftOffset = 0;
        patchSettings({ taskbarLeftOffset: 0 });
      }
      isAlwaysOnTopSetting = settings.value.taskbarAlwaysOnTop !== false;
      void applyAlwaysOnTop(isAlwaysOnTopSetting);
      if (!hasMigratedDockDefaults()) {
        // 旧版本默认未锁定，且偏移量可能来自旧坐标语义：统一成「锁定 + 贴左 0px」。
        configuredLeftOffset = 0;
        isPositionLocked = true;
        try {
          if (typeof localStorage !== 'undefined') localStorage.removeItem(TASKBAR_PLAYER_POSITION_X_KEY);
        } catch {
          // 忽略不可写的存储环境。
        }
        persistFreePosition(null);
        patchSettings({ taskbarLeftOffset: 0, taskbarPositionLocked: true, taskbarFreePosition: null });
        markDockDefaultsMigrated();
      }
      configuredFreePosition = normalizeTaskbarFreePosition(freePosition);
      if (!isResizingTaskbar) {
        void getTaskbarPlayerWindow().then(targetWindow => {
          if (targetWindow) return stabilizeTaskbarWindowGeometry(targetWindow);
        }).catch(error => console.warn('Failed to update taskbar window geometry:', error));
      }
    },
    { immediate: true, flush: 'sync' },
  );
  const {
    currentSong,
    currentTime,
    isPlaying,
    volume,
    playQueuePaths,
    seekTo,
    playSong,
    togglePlay,
    prevSong,
    nextSong,
    handleVolume,
    toggleMute,
  } = usePlayer();
  const { parsedLyrics, lyricsStatus } = useLyrics();
  const { loadCover } = useCoverCache();
  const { loadSong } = useLibrarySongResolver();
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
    volume: volume.value,
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

  // 音量面板需要即时反馈，不能等下一次进度心跳。
  watch(volume, () => {
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
      backgroundMode: settings.value.taskbarBackgroundMode,
      backgroundColor: settings.value.taskbarBackgroundColor,
      frameShape: settings.value.taskbarFrameShape,
      alwaysOnTop: settings.value.taskbarAlwaysOnTop !== false,
      textColor: settings.value.taskbarTextColor,
      contentMode: settings.value.taskbarContentMode,
      lyricEffect: settings.value.taskbarLyricEffect,
      lyricHighlightColor: settings.value.taskbarLyricHighlightColor,
      translationKaraoke: settings.value.taskbarTranslationKaraoke,
      coverShape: settings.value.taskbarCoverShape,
      coverRotate: settings.value.taskbarCoverRotate,
      canDrag: !settings.value.taskbarPositionLocked,
      doubleClickToPause: settings.value.doubleClickCurrentSongToPause === true,
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

  // 铃动窗每次从无到有显现时都停在默认停靠点：锁定 + 距底栏左边缘 0px。
  const dockTaskbarPlayerAtDefault = () => {
    configuredLeftOffset = 0;
    configuredFreePosition = null;
    isPositionLocked = true;
    freePlacementFromUserDrag = false;
    persistFreePosition(null);
    patchSettings({
      taskbarLeftOffset: 0,
      taskbarPositionLocked: true,
      taskbarFreePosition: null,
    });
  };

  const openTaskbarPlayerWindow = async () => {
    const targetWindow = await ensureTaskbarPlayerWindow();
    await waitForTaskbarPlayerReady();

    if (!hasResetPlacementThisSession) {
      hasResetPlacementThisSession = true;
      dockTaskbarPlayerAtDefault();
    }

    // 对齐最新几何坐标并置顶
    await stabilizeTaskbarWindowGeometry(targetWindow);

    await emitStateToTaskbarPlayer();
    await emitTo(TASKBAR_PLAYER_WINDOW_LABEL, TASKBAR_PLAYER_VISIBILITY_EVENT, { visible: true });
    await targetWindow.show();
    // Install immediately after showing so Shell interactions are guarded while
    // geometry and lyric state finish synchronizing.
    if (isAlwaysOnTopSetting) {
      await invoke<boolean>('install_taskbar_zorder_guard').then((installed) => {
        if (!installed) console.warn('Taskbar player z-order guard could not find its window.');
      }).catch((err) => {
        console.warn('Failed to install taskbar z-order guard:', err);
      });
    }
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
    isQueuePanelOpen = false;
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
            isQueuePanelOpen = false;
            await emitTo<TaskbarPlayerPanelPayload>(
              TASKBAR_PLAYER_WINDOW_LABEL, TASKBAR_PLAYER_PANEL_EVENT, { open: false },
            );
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

  const emitQueueToTaskbarPlayer = async () => {
    const targetWindow = await getTaskbarPlayerWindow();
    if (!targetWindow) return;
    await emitTo<TaskbarPlayerQueuePayload>(
      TASKBAR_PLAYER_WINDOW_LABEL,
      TASKBAR_PLAYER_QUEUE_EVENT,
      {
        paths: [...playQueuePaths.value],
        currentPath: currentSong.value?.path ?? null,
      },
    ).catch(error => console.warn('Failed to sync taskbar queue:', error));
  };

  async function applyAlwaysOnTop(enabled: boolean) {
    const targetWindow = await getTaskbarPlayerWindow();
    if (!targetWindow) return;
    await targetWindow.setAlwaysOnTop(enabled).catch((error) => {
      console.warn('Failed to update taskbar player topmost:', error);
    });
    if (enabled) {
      await invoke<boolean>('install_taskbar_zorder_guard').catch(() => false);
      return;
    }
    // 关闭置顶时需要卸掉守护，否则守护会继续把它顶到最上层。
    await invoke('uninstall_taskbar_zorder_guard').catch(() => undefined);
  }

  const setQueuePanelOpen = async (open: boolean) => {
    const changed = isQueuePanelOpen !== open;
    isQueuePanelOpen = open;
    // 开合面板是「自适应边界定位」的入口：清掉手动拖拽标记，让展开重新贴合工作区。
    if (changed) freePlacementFromUserDrag = false;
    const targetWindow = await getTaskbarPlayerWindow();
    if (changed && targetWindow) {
      // 高度与位移一次下发，播控条位置保持不变。
      await stabilizeTaskbarWindowGeometry(targetWindow);
    }
    await emitTo<TaskbarPlayerPanelPayload>(
      TASKBAR_PLAYER_WINDOW_LABEL,
      TASKBAR_PLAYER_PANEL_EVENT,
      { open },
    ).catch(error => console.warn('Failed to sync taskbar panel state:', error));
    if (open) await emitQueueToTaskbarPlayer();
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
        commitSongSwitch('previous', 'taskbar');
        prevSong();
        break;
      case 'next-song':
        commitSongSwitch('next', 'taskbar');
        nextSong();
        break;
      case 'toggle-position-lock': {
        if (!isPositionLocked) {
          // 重新上锁：回到桌面底栏，距左边缘归零由 watch 统一处理（覆盖设置面板入口）。
          patchSettings({ taskbarPositionLocked: true });
          break;
        }
        const targetWindow = await getTaskbarPlayerWindow();
        const seeded = targetWindow ? await seedFreePositionFromCurrentWindow(targetWindow) : null;
        patchSettings({
          taskbarPositionLocked: false,
          ...(seeded ? { taskbarFreePosition: seeded } : {}),
        });
        break;
      }
      case 'set-volume': {
        const next = Math.max(0, Math.min(100, Math.round(action.volume)));
        await handleVolume({ target: { value: String(next) } } as unknown as Event);
        break;
      }
      case 'toggle-mute':
        await toggleMute();
        break;
      case 'set-queue-panel':
        await setQueuePanelOpen(action.open);
        break;
      case 'close-queue':
        await setQueuePanelOpen(false);
        break;
      case 'play-queue-path': {
        const song = await loadSong(action.path);
        if (song) await playSong(song, { preserveQueue: true });
        break;
      }
      case 'seek-lyric':
        await seekTo(Math.max(0, action.time + audioDelay.value));
        break;
      case 'seek-play-lyric':
        await seekTo(Math.max(0, action.time + audioDelay.value));
        // 双击歌词直接开始播放，不需要再点一次播放按钮。
        if (!isPlaying.value) await togglePlay();
        break;
      case 'close':
        settings.value.showTaskbarPlayer = false;
        break;
      case 'set-width': {
        const nextWidth = normalizeTaskbarWidth(action.width, TASKBAR_PLAYER_MAX_WIDTH);
        if (nextWidth === configuredWindowWidth) break;
        markTaskbarResizing();
        const delta = nextWidth - configuredWindowWidth;
        if (isPositionLocked) {
          const current = configuredLeftOffset ?? 0;
          // 拖左侧：左端跟着走、右端不动；拖右侧：右端跟着走、左端不动。
          const nextOffset = action.anchor === 'left' ? current - delta : current;
          const bounds = currentPositionBounds ?? await getTaskbarPositionBounds();
          const clamped = bounds
            ? clampTaskbarLeftOffset(nextOffset, bounds, Math.max(0, nextWidth - 18))
            : nextOffset;
          configuredLeftOffset = clamped;
          patchSettings({ taskbarWindowWidth: nextWidth, taskbarLeftOffset: clamped });
        } else if (configuredFreePosition) {
          if (action.anchor === 'left') {
            configuredFreePosition = { ...configuredFreePosition, x: configuredFreePosition.x - delta };
          }
          patchSettings({
            taskbarWindowWidth: nextWidth,
            ...(configuredFreePosition ? { taskbarFreePosition: configuredFreePosition } : {}),
          });
        } else {
          patchSettings({ taskbarWindowWidth: nextWidth });
        }
        // watcher 在拉伸期间不再触发几何自愈，这里统一走带并发锁的重定位。
        void updatePosition();
        break;
      }
      case 'set-left-offset':
      case 'align-left': {
        const position = await getTaskbarPositionBounds();
        if (position) currentPositionBounds = position;
        const offset = action.type === 'align-left'
          ? 0
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
      await listen<TaskbarPlayerPanelPayload>(TASKBAR_PLAYER_PANEL_REQUEST_EVENT, (event) => {
        void setQueuePanelOpen(event.payload.open);
      })
    );

    unlisteners.push(
      await listen<TaskbarPlayerDragPayload>(TASKBAR_PLAYER_DRAG_EVENT, async (event) => {
        const sequence = ++dragEventSequence;
        if (event.payload.dragging) {
          isTaskbarPlayerDragging = true;
          return;
        }
        if (event.payload.position) {
          // 解锁状态下的自由拖拽结果：保存逻辑坐标即可，不再换算底栏偏移。
          const freePosition = normalizeTaskbarFreePosition(event.payload.position);
          if (sequence !== dragEventSequence) return;
          if (freePosition) {
            configuredFreePosition = freePosition;
            // 用户亲手放下的位置不再被工作区边界拉回，收起/展开才重新做自适应。
            freePlacementFromUserDrag = true;
            persistFreePosition(freePosition);
          }
        } else if (event.payload.leftOffset !== undefined) {
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

    watch([playQueuePaths, () => currentSong.value?.path], () => {
      if (isQueuePanelOpen) void emitQueueToTaskbarPlayer();
    });

    // 观察播放器核心状态改变，向子窗口推送
    watch(
      [
        currentSong,
        isDarkTheme,
        parsedLyrics,
        () => settings.value.taskbarBackgroundOpacity,
        () => settings.value.taskbarBackgroundMode,
        () => settings.value.taskbarBackgroundColor,
        () => settings.value.taskbarFrameShape,
        () => settings.value.taskbarTextColor,
        () => settings.value.taskbarContentMode,
        () => settings.value.taskbarLyricEffect,
        () => settings.value.taskbarLyricHighlightColor,
        () => settings.value.taskbarTranslationKaraoke,
        () => settings.value.taskbarCoverShape,
        () => settings.value.taskbarCoverRotate,
        () => settings.value.taskbarPositionLocked,
        () => settings.value.doubleClickCurrentSongToPause,
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
    if (persistTaskbarFreePosition === persistFreePosition) persistTaskbarFreePosition = null;
  });
}
