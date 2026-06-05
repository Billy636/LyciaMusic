import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { emitTo, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { onMounted, onUnmounted, ref, watch } from 'vue';

import { useCoverCache } from './useCoverCache';
import { usePlayer } from './player';
import { useThemeSettings } from './useThemeSettings';
import { useSettings } from '../features/settings/useSettings';
import {
  TASKBAR_PLAYER_WINDOW_LABEL,
  TASKBAR_PLAYER_STATE_EVENT,
  TASKBAR_PLAYER_STATE_APPLIED_EVENT,
  TASKBAR_PLAYER_ACTION_EVENT,
  TASKBAR_PLAYER_REQUEST_STATE_EVENT,
  TASKBAR_PLAYER_READY_EVENT,
  TASKBAR_PLAYER_VISIBILITY_EVENT,
  TASKBAR_PLAYER_DRAG_EVENT,
  TASKBAR_PLAYER_POSITION_X_KEY,
  TASKBAR_PLAYER_WINDOW_WIDTH,
  TASKBAR_PLAYER_WINDOW_HEIGHT,
  type TaskbarPlayerStatePayload,
  type TaskbarPlayerAction,
} from '../features/taskbarPlayer/shared';

export type OwnerBindingState = 'bound' | 'failed' | 'unsupported' | 'already_bound';
export type GeometrySource = 'tray' | 'taskbar_fallback';

export interface RectPhysical {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TaskbarTrayGeometry {
  taskbar_rect_physical: RectPhysical;
  tray_rect_physical: RectPhysical | null;
  taskbar_hwnd_changed: boolean;
  owner_binding: OwnerBindingState;
  source: GeometrySource;
  scale_factor: number;
}

let taskbarPlayerWindowPromise: Promise<WebviewWindow> | null = null;
let isTaskbarPlayerReady = false;
let taskbarPlayerReadyPromise: Promise<void> | null = null;
let resolveTaskbarPlayerReady: (() => void) | null = null;
let resolveTaskbarPlayerStateApplied: (() => void) | null = null;
let unlistenScaleChange: (() => void) | null = null;

// 高可用定位并发控制锁
let isPositioning = false;
let pendingPositionUpdate = false;
let isTaskbarPlayerDragging = false;

async function ensureTaskbarWindowSize(targetWindow: WebviewWindow) {
  await targetWindow.setSize(new LogicalSize(
    TASKBAR_PLAYER_WINDOW_WIDTH,
    TASKBAR_PLAYER_WINDOW_HEIGHT,
  )).catch((err) => {
    console.warn('Failed to normalize taskbar player size:', err);
  });
}

async function refreshTaskbarWindowTopmost(targetWindow: WebviewWindow) {
  await targetWindow.setAlwaysOnTop(true);
  await invoke('refresh_taskbar_window_topmost').catch((err) => {
    console.warn('Failed to refresh taskbar player topmost state:', err);
  });
}

async function stabilizeTaskbarWindowGeometry(targetWindow: WebviewWindow) {
  await ensureTaskbarWindowSize(targetWindow);
  await updatePosition();
  await refreshTaskbarWindowTopmost(targetWindow);
}

function scheduleTaskbarWindowGeometryStabilization(targetWindow: WebviewWindow) {
  void stabilizeTaskbarWindowGeometry(targetWindow);

  for (const delay of [120, 350, 900, 1600]) {
    window.setTimeout(() => {
      void stabilizeTaskbarWindowGeometry(targetWindow);
    }, delay);
  }
}

// 读取保存的 x 坐标
function readSavedPositionX(): number | null {
  if (typeof localStorage === 'undefined') return null;
  const stored = localStorage.getItem(TASKBAR_PLAYER_POSITION_X_KEY);
  if (!stored) return null;
  const parsed = parseInt(stored, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// 写入保存的 x 坐标
export function writeSavedPositionX(x: number) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(TASKBAR_PLAYER_POSITION_X_KEY, String(Math.round(x)));
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

      // 1. 安全的主显示器获取机制：优先 primaryMonitor()，失败时回退 availableMonitors()[0]
      let primary = await primaryMonitor().catch(() => null);
      if (!primary) {
        const monitors = await availableMonitors().catch(() => []);
        if (monitors.length > 0) {
          primary = monitors[0];
        }
      }
      const scaleFactor = primary?.scaleFactor ?? 1;

      // 2. 调用 Rust 底层，返回 Win32 API 在当前进程 DPI awareness 下的原始物理屏幕坐标
      const geometry = await invoke<TaskbarTrayGeometry>('get_taskbar_tray_geometry').catch((err) => {
        console.warn('Failed to invoke get_taskbar_tray_geometry:', err);
        return null;
      });

      if (!geometry) {
        break;
      }

      // 3. DPI 跨屏单次换算契约：物理坐标除以 scaleFactor，在前端转换为标准逻辑像素
      const toLogicalVal = (val: number) => val / scaleFactor;

      const taskbarRect = {
        left: toLogicalVal(geometry.taskbar_rect_physical.left),
        top: toLogicalVal(geometry.taskbar_rect_physical.top),
        right: toLogicalVal(geometry.taskbar_rect_physical.right),
        bottom: toLogicalVal(geometry.taskbar_rect_physical.bottom),
      };
      const taskbarWidth = taskbarRect.right - taskbarRect.left;
      const taskbarHeight = taskbarRect.bottom - taskbarRect.top;

      let trayRect = null;
      if (geometry.tray_rect_physical) {
        trayRect = {
          left: toLogicalVal(geometry.tray_rect_physical.left),
          top: toLogicalVal(geometry.tray_rect_physical.top),
          right: toLogicalVal(geometry.tray_rect_physical.right),
          bottom: toLogicalVal(geometry.tray_rect_physical.bottom),
        };
      }

      // 获取主屏幕工作区大小与定位边界
      const workArea = primary
        ? primary.workArea.position.toLogical(scaleFactor)
        : { x: 0, y: 0 };
      const workAreaSize = primary
        ? primary.workArea.size.toLogical(scaleFactor)
        : { width: 1920, height: 1040 };

      const winWidth = TASKBAR_PLAYER_WINDOW_WIDTH;
      const winHeight = TASKBAR_PLAYER_WINDOW_HEIGHT;

      // 四边任务栏朝向识别
      const isBottom = taskbarRect.top > workArea.y && taskbarWidth > taskbarHeight;
      const isTop = taskbarRect.top === 0 && taskbarWidth > taskbarHeight;

      let x = 0;
      let y = 0;

      const savedX = readSavedPositionX();

      // 多边定位公式单独定义与精细避让
      if (isBottom) {
        // 底部任务栏：在任务栏矩形内精致居中
        y = taskbarRect.top + (taskbarHeight - winHeight) / 2;
        if (trayRect && geometry.source === 'tray') {
          // 精密避让：托盘左边界 - 窗口宽度 - 12px 呼吸间隙
          x = trayRect.left - winWidth - 12;
        } else {
          // Fallback：安全边界兜底
          x = taskbarRect.right - 16 - winWidth;
        }
        if (savedX !== null) {
          x = savedX;
        }
      } else if (isTop) {
        // 顶部任务栏
        y = taskbarRect.top + (taskbarHeight - winHeight) / 2;
        if (trayRect && geometry.source === 'tray') {
          x = trayRect.left - winWidth - 12;
        } else {
          x = taskbarRect.right - 16 - winWidth;
        }
        if (savedX !== null) {
          x = savedX;
        }
      } else {
        // 侧边（左/右）任务栏或异常布局下，采取在主屏底部工作区边缘悬浮的兜底策略，不飞屏
        x = workArea.x + (workAreaSize.width - winWidth) / 2;
        y = workArea.y + workAreaSize.height - winHeight - 8;
        if (savedX !== null) {
          x = savedX;
        }
      }

      // 三级防护边界裁剪（防止溢出工作区）
      x = Math.max(workArea.x, Math.min(workArea.x + workAreaSize.width - winWidth, x));

      // 执行最终的 setPosition
      await targetWindow.setPosition(new LogicalPosition(Math.round(x), Math.round(y))).catch((err) => {
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
        width: TASKBAR_PLAYER_WINDOW_WIDTH,
        height: TASKBAR_PLAYER_WINDOW_HEIGHT,
        minWidth: TASKBAR_PLAYER_WINDOW_WIDTH,
        minHeight: TASKBAR_PLAYER_WINDOW_HEIGHT,
        maxWidth: TASKBAR_PLAYER_WINDOW_WIDTH,
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
  const { settings } = useSettings();
  const {
    currentSong,
    isPlaying,
    togglePlay,
    prevSong,
    nextSong,
  } = usePlayer();
  const { loadCover } = useCoverCache();
  const { isDarkTheme } = useThemeSettings();

  const isTaskbarPlayerVisible = ref(false);
  const unlisteners: Array<() => void> = [];
  let checkTimer: number | null = null;
  let isMainWindowClosing = false;

  const createStatePayload = async (): Promise<TaskbarPlayerStatePayload> => {
    const song = currentSong.value;
    const coverUrl = song?.path ? await loadCover(song.path).catch(() => '') : '';

    return {
      currentSong: song,
      coverUrl: coverUrl || '',
      isPlaying: isPlaying.value,
      isDarkTheme: isDarkTheme.value,
    };
  };

  const emitStateToTaskbarPlayer = async () => {
    const targetWindow = await getTaskbarPlayerWindow();
    if (!targetWindow) return;

    const appliedPromise = waitForTaskbarPlayerStateApplied();
    await emitTo<TaskbarPlayerStatePayload>(
      TASKBAR_PLAYER_WINDOW_LABEL,
      TASKBAR_PLAYER_STATE_EVENT,
      await createStatePayload(),
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
    await stabilizeTaskbarWindowGeometry(targetWindow);
    isTaskbarPlayerVisible.value = true;

    // 安装 Z-order 守护，防止点击任务栏时播控窗口被遮盖
    void invoke('install_taskbar_zorder_guard').catch((err) => {
      console.warn('Failed to install taskbar zorder guard:', err);
    });
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

  const hideTaskbarPlayerWindow = async () => {
    const targetWindow = await getTaskbarPlayerWindow();
    if (!targetWindow) {
      isTaskbarPlayerVisible.value = false;
      return;
    }

    stopCheckLoop();
    if (unlistenScaleChange) {
      unlistenScaleChange();
      unlistenScaleChange = null;
    }
    // 卸载 Z-order 守护
    void invoke('uninstall_taskbar_zorder_guard').catch(() => {});
    await emitTo(TASKBAR_PLAYER_WINDOW_LABEL, TASKBAR_PLAYER_VISIBILITY_EVENT, { visible: false });
    await targetWindow.hide();
    isTaskbarPlayerVisible.value = false;
  };

  const destroyTaskbarPlayerWindow = async () => {
    const targetWindow = await getTaskbarPlayerWindow();
    if (!targetWindow) {
      isTaskbarPlayerVisible.value = false;
      return;
    }

    stopCheckLoop();
    if (unlistenScaleChange) {
      unlistenScaleChange();
      unlistenScaleChange = null;
    }
    // 在 destroy 前卸载守护，防止回调访问已失效的 HWND
    void invoke('uninstall_taskbar_zorder_guard').catch(() => {});
    try {
      await targetWindow.destroy();
    } catch (error) {
      console.warn('Failed to destroy taskbar player window:', error);
    } finally {
      taskbarPlayerWindowPromise = null;
      isTaskbarPlayerVisible.value = false;
    }
  };

  // 全屏屏蔽防盖以及秒级自愈对齐复合轮询机制
  const startCheckLoop = () => {
    if (checkTimer) return;

    checkTimer = window.setInterval(async () => {
      const targetWindow = await getTaskbarPlayerWindow();
      if (!targetWindow || !settings.value.showTaskbarPlayer) return;

      try {
        const state = await invoke<{ isFullscreen: boolean }>('get_foreground_fullscreen_state');
        if (state.isFullscreen) {
          if (isTaskbarPlayerVisible.value) {
            await targetWindow.hide();
            isTaskbarPlayerVisible.value = false;
          }
        } else {
          if (!isTaskbarPlayerVisible.value) {
            // 对齐一次坐标并显示
            await stabilizeTaskbarWindowGeometry(targetWindow);
            await targetWindow.show();
            await stabilizeTaskbarWindowGeometry(targetWindow);
            isTaskbarPlayerVisible.value = true;
          } else if (!isTaskbarPlayerDragging) {
            // 正常显示状态下，每 1 秒进行位置的静默校验和动态纠偏（应对托盘变化或 Explorer 重建）
            void stabilizeTaskbarWindowGeometry(targetWindow);
          }
        }
      } catch (error) {
        console.warn('Failed in check loop:', error);
      }
    }, 1000);
  };

  const stopCheckLoop = () => {
    if (checkTimer) {
      window.clearInterval(checkTimer);
      checkTimer = null;
    }
  };

  const handleAction = async (action: TaskbarPlayerAction) => {
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
      case 'close':
        settings.value.showTaskbarPlayer = false;
        break;
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
      await listen<{ dragging: boolean }>(TASKBAR_PLAYER_DRAG_EVENT, (event) => {
        isTaskbarPlayerDragging = event.payload.dragging;
      })
    );

    // 观察用户配置的开启/关闭
    watch(
      () => settings.value.showTaskbarPlayer,
      async (enabled) => {
        if (enabled) {
          await openTaskbarPlayerWindow();
        } else {
          await hideTaskbarPlayerWindow();
        }
      },
      { immediate: true }
    );

    // 观察播放器核心状态改变，向子窗口推送
    watch(
      [
        currentSong,
        isPlaying,
        isDarkTheme,
      ],
      () => {
        if (!isTaskbarPlayerVisible.value) return;
        void emitStateToTaskbarPlayer();
      },
      { deep: true }
    );
  });

  onUnmounted(() => {
    stopCheckLoop();
    if (unlistenScaleChange) {
      unlistenScaleChange();
      unlistenScaleChange = null;
    }
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  });
}
