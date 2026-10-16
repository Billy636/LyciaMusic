import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { currentMonitor, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import { storeToRefs } from 'pinia';
import { onUnmounted, watch } from 'vue';

import { usePlaybackStore } from '../features/playback/store';
import { useSettings } from '../features/settings/useSettings';
import {
  SONG_NOTIFICATION_DISMISSED_EVENT,
  SONG_NOTIFICATION_DURATION_MS,
  SONG_NOTIFICATION_PRESENTED_EVENT,
  SONG_NOTIFICATION_READY_EVENT,
  SONG_NOTIFICATION_STATE_EVENT,
  SONG_NOTIFICATION_WINDOW_HEIGHT,
  SONG_NOTIFICATION_WINDOW_LABEL,
  SONG_NOTIFICATION_WINDOW_WIDTH,
  type SongNotificationIdPayload,
  type SongNotificationStatePayload,
} from '../features/songNotification/shared';
import { useThemeSettings } from './useThemeSettings';
import { AuxWindowLease } from '../utils/auxWindowLease';
import { resolveSongNotificationBounds } from '../features/songNotification/positioning';

export function useSongNotificationBridge() {
  const { settings } = useSettings();
  const { isDarkTheme } = useThemeSettings();
  const { currentSong, currentCover, currentCoverPath, isPlaying, isSongLoaded, songChangeRevision } =
    storeToRefs(usePlaybackStore());
  let notificationWindow: WebviewWindow | null = null;
  let windowPromise: Promise<WebviewWindow> | null = null;
  let resolveReady: (() => void) | null = null;
  let active: SongNotificationStatePayload | null = null;
  let activePath = '';
  let nextId = 0;
  let disposed = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let operations: Promise<void> = Promise.resolve();
  let geometryKey = '';
  let unlistenScaleChanged: UnlistenFn | null = null;
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
    && active?.id === id && currentSong.value?.path === activePath;

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
    listen<SongNotificationIdPayload>(SONG_NOTIFICATION_PRESENTED_EVENT, event => {
      void enqueue(async () => {
        const id = event.payload.id;
        if (!isActive(id) || !isPlaying.value || !isSongLoaded.value
          || !active || active.expiresAt <= Date.now()) return;
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

  const updateContent = () => {
    const song = currentSong.value;
    if (!active || !song || song.path !== activePath) return false;
    const title = song.title?.trim() || song.name.replace(/\.[^/.]+$/, '') || '未知歌曲';
    const artist = song.artist?.trim() || '未知歌手';
    // Playback can retain the preceding cover while the next thumbnail loads.
    const coverUrl = currentCoverPath.value === song.path || currentCoverPath.value === song.cue_source_path
      ? currentCover.value : '';
    if (active.title === title && active.artist === artist && active.coverUrl === coverUrl
      && active.isDarkTheme === isDarkTheme.value) return false;
    Object.assign(active, { title, artist, coverUrl, isDarkTheme: isDarkTheme.value });
    return true;
  };

  watch(songChangeRevision, () => {
    const song = currentSong.value;
    if (!settings.value.showSongNotification || !song || !isPlaying.value || !isSongLoaded.value) return;
    lease.cancel();
    clearFallbackTimer();
    const id = ++nextId;
    activePath = song.path;
    active = { id, title: '', artist: '', coverUrl: '', isDarkTheme: isDarkTheme.value, expiresAt: 0 };
    updateContent();
    void enqueue(async () => {
      const target = await ensureWindow().catch(error => {
        if (isActive(id)) dismiss();
        throw error;
      });
      if (!isActive(id)) return;
      if (!await applyGeometry(target, id)) return;
      if (!isActive(id) || !isPlaying.value || !isSongLoaded.value || !active) return;
      updateContent();
      active.expiresAt = Date.now() + SONG_NOTIFICATION_DURATION_MS;
      await emitTo(SONG_NOTIFICATION_WINDOW_LABEL, SONG_NOTIFICATION_STATE_EVENT, { ...active });
      if (!isActive(id)) return;
      // The owner also expires the native window if its webview stops responding.
      fallbackTimer = setTimeout(() => {
        if (active?.id === id) dismiss();
      }, SONG_NOTIFICATION_DURATION_MS + 500);
    });
  });

  watch([currentSong, currentCover, currentCoverPath, isDarkTheme], () => {
    if (!active || active.expiresAt <= Date.now()) return;
    if (!updateContent()) return;
    const id = active.id;
    void enqueue(async () => {
      if (isActive(id) && active) {
        await emitTo(SONG_NOTIFICATION_WINDOW_LABEL, SONG_NOTIFICATION_STATE_EVENT, { ...active });
      }
    });
  });

  watch([() => settings.value.showSongNotification, () => currentSong.value?.path, isSongLoaded], () => {
    if (active && (!settings.value.showSongNotification || !isSongLoaded.value || currentSong.value?.path !== activePath)) {
      dismiss();
    }
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
