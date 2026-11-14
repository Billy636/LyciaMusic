import { getCurrentWindow } from '@tauri-apps/api/window';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { normalizePathForScope } from './libraryRemovalCleanup';

const FOCUS_REFRESH_DELAY_MS = 350;
const MAX_TRACKED_SONGS = 16;
const RETRY_DELAYS_MS = [500, 1500];

interface TrackedSongEdit {
  path: string;
  warned: boolean;
}

interface ExternalSongEditsDeps {
  refreshSongMetadata: (path: string) => Promise<unknown>;
  onRefreshError: (error: unknown) => void;
}

export const createPlayerExternalSongEdits = ({
  refreshSongMetadata,
  onRefreshError,
}: ExternalSongEditsDeps) => {
  const trackedSongs = new Map<string, TrackedSongEdit>();
  let initialized = false;
  let disposed = false;
  let focused = false;
  let running = false;
  let refreshAgain = false;
  let focusTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let finishRetry: (() => void) | null = null;
  let unlistenFocus: UnlistenFn | null = null;

  const waitForRetry = (delay: number) => new Promise<void>(resolve => {
    finishRetry = resolve;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      finishRetry = null;
      resolve();
    }, delay);
  });

  const refreshTrackedSongs = async () => {
    if (disposed || !focused || trackedSongs.size === 0) return;
    if (running) {
      refreshAgain = true;
      return;
    }

    running = true;
    try {
      for (const edit of [...trackedSongs.values()]) {
        if (disposed || !focused) break;
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
          if (disposed || !focused) break;
          try {
            await refreshSongMetadata(edit.path);
            edit.warned = false;
            break;
          } catch (error) {
            if (disposed || !focused) break;
            if (attempt < RETRY_DELAYS_MS.length) {
              await waitForRetry(RETRY_DELAYS_MS[attempt]);
            } else if (!edit.warned) {
              edit.warned = true;
              onRefreshError(error);
            }
          }
        }
      }
    } finally {
      running = false;
      if (refreshAgain) {
        refreshAgain = false;
        scheduleRefresh();
      }
    }
  };

  const scheduleRefresh = () => {
    if (disposed || !focused || trackedSongs.size === 0) return;
    if (focusTimer !== null) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      focusTimer = null;
      void refreshTrackedSongs();
    }, FOCUS_REFRESH_DELAY_MS);
  };

  const setFocused = (nextFocused: boolean) => {
    focused = nextFocused;
    if (focused) {
      scheduleRefresh();
    } else if (focusTimer !== null) {
      clearTimeout(focusTimer);
      focusTimer = null;
    }
  };
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handleVisibility = () => setFocused(document.visibilityState === 'visible' && document.hasFocus());

  const trackExternalSongEdit = (path: string) => {
    if (!path || path.startsWith('remote://')) return;
    const key = normalizePathForScope(path);
    trackedSongs.delete(key);
    trackedSongs.set(key, { path, warned: false });
    if (trackedSongs.size > MAX_TRACKED_SONGS) {
      trackedSongs.delete(trackedSongs.keys().next().value!);
    }
    // Keep recent edits for this app session: returning before saving or
    // editing the same file again must still refresh on the next return.
  };

  const init = () => {
    if (initialized || disposed) return;
    initialized = true;
    focused = document.hasFocus();
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    void Promise.resolve().then(() => getCurrentWindow().onFocusChanged(({ payload }) => setFocused(payload)))
      .then(unlisten => {
        if (disposed) unlisten();
        else unlistenFocus = unlisten;
      })
      .catch(error => console.warn('Failed to listen for external song edit return:', error));
  };

  const dispose = () => {
    disposed = true;
    if (focusTimer !== null) clearTimeout(focusTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    finishRetry?.();
    unlistenFocus?.();
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('blur', handleBlur);
    document.removeEventListener('visibilitychange', handleVisibility);
    trackedSongs.clear();
  };

  return { trackExternalSongEdit, init, dispose };
};
