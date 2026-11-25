import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getWebviewDataDirectory } from '../services/storage/dataStorage';
import { currentMonitor, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import { storeToRefs } from 'pinia';
import { onUnmounted, watch } from 'vue';

import { usePlaybackStore } from '../features/playback/store';
import { useSettings } from '../features/settings/useSettings';
import { useCoverCache } from './useCoverCache';
import {
  SONG_NOTIFICATION_AUTO_RAMP_SECONDS,
  SONG_NOTIFICATION_DISMISSED_EVENT,
  SONG_NOTIFICATION_HOLD_MS,
  SONG_NOTIFICATION_PRESENTED_EVENT,
  SONG_NOTIFICATION_READY_EVENT,
  SONG_NOTIFICATION_STATE_EVENT,
  SONG_NOTIFICATION_SWITCH_EVENT,
  SONG_NOTIFICATION_WINDOW_HEIGHT,
  SONG_NOTIFICATION_WINDOW_LABEL,
  SONG_NOTIFICATION_WINDOW_WIDTH,
  normalizeSongNotificationBackgroundColor,
  normalizeSongNotificationBackgroundMode,
  normalizeSongNotificationFrameShape,
  type SongNotificationIdPayload,
  type SongNotificationRevealMode,
  type SongNotificationStatePayload,
  type SongNotificationSwitchPayload,
} from '../features/songNotification/shared';
import {
  isManualSongSwitchPending,
  isSongNotificationModuleEnabled,
  consumeManualSongSwitch,
  getSongSwitchHoverGeneration,
  markManualSongSwitch,
  setSongNotificationModules,
  setSongSwitchHovered,
  songSwitchDirection,
  songSwitchHovered,
} from '../features/songNotification/manualSwitch';
import { peekUpcomingSong, peekUpcomingSongPath, type SongSwitchDirection } from '../features/songNotification/upcoming';
import { useLibrarySongResolver } from './useLibrarySongResolver';
import { useThemeSettings } from './useThemeSettings';
import { AuxWindowLease } from '../utils/auxWindowLease';
import { resolveSongNotificationBounds } from '../features/songNotification/positioning';
import type { Song } from '../types';

const PREVIEW_DURATION_MS = 8000;
const AUTO_PREVIEW_DURATION_MS = SONG_NOTIFICATION_AUTO_RAMP_SECONDS * 1000 + 1200;

export function useSongNotificationBridge() {
  const { settings } = useSettings();
  const { isDarkTheme } = useThemeSettings();
  const playback = usePlaybackStore();
  const { loadCover } = useCoverCache();
  const { loadSong } = useLibrarySongResolver();
  const { currentSong, currentCover, currentCoverPath, isPlaying, isSongLoaded, songChangeRevision, currentTime, playMode } =
    storeToRefs(playback);
  let notificationWindow: WebviewWindow | null = null;
  let windowPromise: Promise<WebviewWindow> | null = null;
  let resolveReady: (() => void) | null = null;
  let active: SongNotificationStatePayload | null = null;
  let activePath = '';
  let preRolledPath = '';
  let nextId = 0;
  let disposed = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let operations: Promise<void> = Promise.resolve();
  let geometryKey = '';
  let unlistenScaleChanged: UnlistenFn | null = null;
  let upcomingRequestId = 0;
  const lease = new AuxWindowLease(60_000);

  // Serialize native operations so an old hide cannot overtake a newer show.
  const enqueue = (operation: () => Promise<void>) => {
    operations = operations.then(operation).catch(error => {
      console.warn('Failed to update song notification:', error);
    });
    return operations;
  };

  const clearFallbackTimer = () => {
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    fallbackTimer = null;
  };

  const isActive = (id: number) => !disposed && settings.value.showSongNotification
    && active?.id === id;

  const styleFields = () => ({
    isDarkTheme: isDarkTheme.value,
    frameShape: normalizeSongNotificationFrameShape(settings.value.songNotificationFrameShape),
    backgroundMode: normalizeSongNotificationBackgroundMode(settings.value.songNotificationBackgroundMode),
    backgroundColor: normalizeSongNotificationBackgroundColor(settings.value.songNotificationBackgroundColor),
  });

  const titleOf = (song: Song) => song.title?.trim() || song.name.replace(/\.[^/.]+$/, '') || '未知歌曲';
  const artistOf = (song: Song) => song.artist?.trim() || '未知歌手';

  /** 队列已缓存则同步取；未缓存则按真实路径加载，绝不回退成当前歌曲。 */
  const resolveUpcoming = async (direction: SongSwitchDirection): Promise<Song | null> => {
    const cached = peekUpcomingSong(direction);
    if (cached) return cached;
    const path = peekUpcomingSongPath(direction);
    if (!path || path === currentSong.value?.path) return null;
    return loadSong(path).catch(() => null);
  };

  const destroyWindow = async () => {
    unlistenScaleChanged?.();
    unlistenScaleChanged = null;
    await notificationWindow?.destroy();
    notificationWindow = null;
    geometryKey = '';
  };

  const applyGeometry = async (target: WebviewWindow, id: number) => {
    const monitor = await currentMonitor().catch(() => null) ?? await primaryMonitor().catch(() => null);
    if (!isActive(id)) return false;
    const bounds = monitor ? resolveSongNotificationBounds(monitor) : null;
    if (!bounds) { dismiss(); return false; }
    const key = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}:${bounds.scale}`;
    if (geometryKey !== key) {
      await target.setPosition(new PhysicalPosition(bounds.x, bounds.y));
      if (!isActive(id)) return false;
      await target.setSize(new PhysicalSize(bounds.width, bounds.height));
      geometryKey = key;
    }
    return isActive(id);
  };

  const refreshGeometry = () => {
    if (!active || active.expiresAt <= Date.now()) return;
    const id = active.id;
    void enqueue(async () => {
      if (isActive(id) && notificationWindow) await applyGeometry(notificationWindow, id);
    });
  };

  const dismiss = () => {
    active = null;
    activePath = '';
    clearFallbackTimer();
    void enqueue(async () => {
      // A song may have changed while this hide waited for a window operation.
      if (active) return;
      await notificationWindow?.hide();
      if (disposed || active) return;
      lease.schedule(() => {
        void enqueue(async () => {
          if (active) return;
          await destroyWindow();
        });
      });
    });
  };

  const registrations: Promise<UnlistenFn>[] = [
    listen(SONG_NOTIFICATION_READY_EVENT, () => resolveReady?.()),
    // 铃动窗 / 桌面歌词 / 托盘菜单的悬停预览意图（独立 webview 无法共享模块级状态）。
    listen<SongNotificationSwitchPayload>(SONG_NOTIFICATION_SWITCH_EVENT, event => {
      const { module, phase, direction } = event.payload;
      if (phase === 'hover' || phase === 'leave') {
        setSongSwitchHovered(phase === 'hover', direction, module);
      } else {
        markManualSongSwitch(direction, module);
      }
    }),
    listen<SongNotificationIdPayload>(SONG_NOTIFICATION_PRESENTED_EVENT, event => {
      void enqueue(async () => {
        const id = event.payload.id;
        if (!isActive(id) || !active || active.expiresAt <= Date.now()) return;
        await notificationWindow?.show();
        if (!isActive(id)) await notificationWindow?.hide();
      });
    }),
    listen<SongNotificationIdPayload>(SONG_NOTIFICATION_DISMISSED_EVENT, event => {
      if (active?.id === event.payload.id) dismiss();
    }),
    getCurrentWindow().onScaleChanged(refreshGeometry),
  ];
  const listenersReady = Promise.all(registrations);
  void listenersReady.catch(error => console.warn('Failed to initialize song notification bridge:', error));

  const ensureWindow = () => {
    if (notificationWindow) return Promise.resolve(notificationWindow);
    if (windowPromise) return windowPromise;
    windowPromise = (async () => {
      await listenersReady;
      // Recreate any orphan left by a main-webview reload with a fresh handshake.
      const orphan = await WebviewWindow.getByLabel(SONG_NOTIFICATION_WINDOW_LABEL);
      if (orphan) await orphan.destroy();
      const ready = new Promise<void>(resolve => { resolveReady = resolve; });
      const target = new WebviewWindow(SONG_NOTIFICATION_WINDOW_LABEL, {
        dataDirectory: getWebviewDataDirectory(),
        url: '/',
        title: 'Lycia Player',
        width: SONG_NOTIFICATION_WINDOW_WIDTH,
        height: SONG_NOTIFICATION_WINDOW_HEIGHT,
        visible: false,
        decorations: false,
        transparent: true,
        shadow: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focus: false,
        focusable: false,
      });
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const creationListeners: UnlistenFn[] = [];
      try {
        const created = new Promise<void>((resolve, reject) => {
          void target.once('tauri://created', () => resolve()).then(unlisten => creationListeners.push(unlisten));
          void target.once('tauri://error', event => reject(event.payload)).then(unlisten => creationListeners.push(unlisten));
        });
        await Promise.race([
          Promise.all([created, ready]),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Song notification window timed out')), 5000);
          }),
        ]);
        unlistenScaleChanged = await target.onScaleChanged(refreshGeometry);
        notificationWindow = target;
        return target;
      } catch (error) {
        await target.destroy().catch(() => {});
        throw error;
      } finally {
        if (timeout !== null) clearTimeout(timeout);
        creationListeners.forEach(unlisten => unlisten());
        resolveReady = null;
      }
    })().finally(() => { windowPromise = null; });
    return windowPromise;
  };

  const showSong = (song: Song | null, mode: SongNotificationRevealMode, coverOverride = '') => {
    if (!song || !settings.value.showSongNotification) return;
    lease.cancel();
    clearFallbackTimer();
    const id = ++nextId;
    activePath = song.path;
    const duration = mode === 'preview' ? PREVIEW_DURATION_MS
      : mode === 'auto' ? AUTO_PREVIEW_DURATION_MS
        : SONG_NOTIFICATION_HOLD_MS + 400;
    active = {
      id,
      title: titleOf(song),
      artist: artistOf(song),
      coverUrl: coverOverride,
      ...styleFields(),
      expiresAt: Date.now() + duration,
      reveal: { mode, startedAt: Date.now() },
    };
    void enqueue(async () => {
      if (!isActive(id)) return;
      // 始终按目标歌曲的封面取图：保证虚化背景跟随「切换到的歌」。
      const cover = coverOverride || await loadCover(song.path).catch(() => '');
      if (!isActive(id) || !active) return;
      if (cover) active.coverUrl = cover;
      const target = await ensureWindow().catch(error => {
        if (isActive(id)) dismiss();
        throw error;
      });
      if (!isActive(id)) return;
      if (!await applyGeometry(target, id)) return;
      if (!isActive(id) || !active) return;
      await emitTo(SONG_NOTIFICATION_WINDOW_LABEL, SONG_NOTIFICATION_STATE_EVENT, { ...active });
      if (!isActive(id)) return;
      // The owner also expires the native window if its webview stops responding.
      fallbackTimer = setTimeout(() => {
        if (active?.id === id) dismiss();
      }, duration + 400);
    });
  };

  // 自动播完：上一首剩 1.5 秒时先以 30% 出现并逐渐加深。
  watch([
    currentTime,
    isPlaying,
    playMode,
    () => currentSong.value?.path,
    () => currentSong.value?.duration,
  ], () => {
    const song = currentSong.value;
    if (!song || !settings.value.showSongNotification) return;
    if (!isPlaying.value || !isSongLoaded.value) return;
    // 自动播放遇到单曲循环（或无下一首）时不提示。
    if (playMode.value === 1) return;
    if (songSwitchHovered.value || active?.reveal.mode === 'confirmed') return;
    const remaining = song.duration - currentTime.value;
    if (!(remaining > 0 && remaining <= SONG_NOTIFICATION_AUTO_RAMP_SECONDS)) return;
    if (preRolledPath === song.path) return;
    const requestId = ++upcomingRequestId;
    void resolveUpcoming('next').then(target => {
      if (requestId !== upcomingRequestId || !target) return;
      if (!isPlaying.value || !settings.value.showSongNotification) return;
      if (currentSong.value?.path !== song.path) return;
      if (preRolledPath === song.path) return;
      preRolledPath = song.path;
      showSong(target, 'auto');
    });
  });

  // 鼠标停在底栏上一首/下一首按钮上：以 60% 预览真正会切到的歌。
  watch([songSwitchHovered, songSwitchDirection, getSongSwitchHoverGeneration], ([hovered]) => {
    if (!settings.value.showSongNotification) return;
    if (hovered) {
      if (!currentSong.value || !isSongLoaded.value) return;
      const direction = songSwitchDirection.value;
      const requestId = ++upcomingRequestId;
      void resolveUpcoming(direction).then(target => {
        if (requestId !== upcomingRequestId || !songSwitchHovered.value) return;
        if (songSwitchDirection.value !== direction) return;
        if (!target) {
          if (active?.reveal.mode === 'preview') dismiss();
          return;
        }
        if (active?.reveal.mode === 'preview' && activePath === target.path) return;
        if (active?.reveal.mode === 'confirmed') return;
        showSong(target, 'preview');
      });
      return;
    }
    upcomingRequestId += 1;
    if (active?.reveal.mode === 'preview' && !isManualSongSwitchPending()) dismiss();
  });

  // 设置变化时同步到模块级开关（独立 webview 的信号在主窗口统一过滤）。
  watch(
    () => settings.value.songNotificationModules,
    (value) => setSongNotificationModules(value),
    { immediate: true, deep: true },
  );

  // 真正切歌：完全实体化，保持 0.5 秒后消失。
  watch(songChangeRevision, () => {
    const song = currentSong.value;
    preRolledPath = '';
    const switchModule = consumeManualSongSwitch();
    if (!settings.value.showSongNotification || !song) { dismiss(); return; }
    // 该模块的播放按钮未接入切歌提示：预览与实体化都不出现。
    if (switchModule && !isSongNotificationModuleEnabled(switchModule)) { dismiss(); return; }
    const wasShowing = !!active;
    // 启动加载第一首歌时不要弹提示；预览中或手动切歌则无论播放状态都实体化。
    if (!switchModule && !wasShowing && (!isPlaying.value || !isSongLoaded.value)) { dismiss(); return; }
    showSong(song, 'confirmed', currentCoverPath.value === song.path ? currentCover.value : '');
  });

  // 样式/主题改变时即时同步到已经显示的卡片。
  watch([
    () => settings.value.songNotificationFrameShape,
    () => settings.value.songNotificationBackgroundMode,
    () => settings.value.songNotificationBackgroundColor,
    isDarkTheme,
    currentSong,
    currentCover,
    currentCoverPath,
  ], () => {
    if (!active || active.expiresAt <= Date.now()) return;
    const id = active.id;
    let changed = false;
    const nextStyle = styleFields();
    for (const key of Object.keys(nextStyle) as Array<keyof typeof nextStyle>) {
      if (active[key] === nextStyle[key]) continue;
      (active as unknown as Record<string, unknown>)[key] = nextStyle[key];
      changed = true;
    }
    // 预告/手动预览展示的是下一首，不能被当前歌曲的封面覆盖。
    if (activePath === currentSong.value?.path && currentCoverPath.value === activePath && currentCover.value) {
      if (active.coverUrl !== currentCover.value) {
        active.coverUrl = currentCover.value;
        changed = true;
      }
    }
    if (!changed) return;
    void enqueue(async () => {
      if (isActive(id) && active) {
        await emitTo(SONG_NOTIFICATION_WINDOW_LABEL, SONG_NOTIFICATION_STATE_EVENT, { ...active });
      }
    });
  });

  watch([() => settings.value.showSongNotification, () => currentSong.value?.path, isSongLoaded], () => {
    if (active && (!settings.value.showSongNotification || !isSongLoaded.value)) dismiss();
  });

  onUnmounted(() => {
    disposed = true;
    lease.cancel();
    dismiss();
    void listenersReady.then(unlisteners => unlisteners.forEach(unlisten => unlisten())).catch(() => {});
    void enqueue(async () => {
      await destroyWindow();
    });
  });
}
