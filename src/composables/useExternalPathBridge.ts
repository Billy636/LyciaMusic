import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, ref } from 'vue';
import { appApi } from '../services/tauri/appApi';
import { usePlaybackStore } from '../features/playback/store';

type ExternalPathSource = 'drop' | 'open';

interface UseExternalPathBridgeOptions {
  handleExternalPaths: (paths: string[], options?: { source?: ExternalPathSource }) => Promise<void>;
  beforeWindowShow?: () => Promise<unknown>;
  afterWindowShow?: () => Promise<unknown> | void;
}

interface StartupWindow {
  show: () => Promise<unknown>;
  setFocus: () => Promise<unknown>;
}

interface StartupWindowHooks {
  beforeShow?: () => Promise<unknown>;
  afterShow?: () => Promise<unknown> | void;
}

export async function showMainWindowAfterStartup(
  appWindow: StartupWindow,
  hooks: StartupWindowHooks = {},
) {
  try {
    await hooks.beforeShow?.();
  } catch (error) {
    console.warn('Failed to prepare startup composition:', error);
  }
  try {
    await appWindow.show();
    await appWindow.setFocus();
  } finally {
    await hooks.afterShow?.();
  }
}

export function useExternalPathBridge({
  handleExternalPaths,
  beforeWindowShow,
  afterWindowShow,
}: UseExternalPathBridgeOptions) {
  const playbackStore = usePlaybackStore();
  const isExternalDragActive = ref(false);
  let externalPathTask: Promise<void> = Promise.resolve();
  let unlistenDragDrop: (() => void) | null = null;
  let unlistenDragOver: (() => void) | null = null;
  let unlistenDragLeave: (() => void) | null = null;
  let unlistenOpenPaths: (() => void) | null = null;

  const enqueueExternalPaths = (paths: string[], source: ExternalPathSource) => {
    externalPathTask = externalPathTask
      .then(() => handleExternalPaths(paths, { source }))
      .catch((error) => {
        console.error('Failed to process external paths:', error);
      });

    return externalPathTask;
  };

  const consumePendingOpenPaths = async (options: { startup?: boolean } = {}) => {
    try {
      const paths = await appApi.consumePendingOpenPaths();
      if (paths.length > 0) {
        if (options.startup) {
          playbackStore.markExternalStartupFile();
        }
        await enqueueExternalPaths(paths, 'open');
      }
    } catch (error) {
      console.error('Failed to consume pending open paths:', error);
    } finally {
      if (options.startup) {
        playbackStore.markStartupPathsResolved();
      }
    }
  };

  onMounted(async () => {
    unlistenDragDrop = await listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
      isExternalDragActive.value = false;
      await enqueueExternalPaths(event.payload?.paths ?? [], 'drop');
    });

    unlistenDragOver = await listen('tauri://drag-over', () => {
      isExternalDragActive.value = true;
    });

    unlistenDragLeave = await listen('tauri://drag-leave', () => {
      isExternalDragActive.value = false;
    });

    unlistenOpenPaths = await listen('app:open-paths', async () => {
      await consumePendingOpenPaths();
    });

    await consumePendingOpenPaths({ startup: true });

    try {
      const appWindow = getCurrentWindow();
      await showMainWindowAfterStartup(appWindow, {
        beforeShow: beforeWindowShow,
        afterShow: afterWindowShow,
      });
    } catch (error) {
      console.error('Failed to show window on startup:', error);
    }
  });

  onUnmounted(() => {
    unlistenDragDrop?.();
    unlistenDragOver?.();
    unlistenDragLeave?.();
    unlistenOpenPaths?.();
  });

  return {
    isExternalDragActive,
  };
}
