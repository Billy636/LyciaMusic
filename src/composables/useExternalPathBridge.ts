import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, ref } from 'vue';
import { appApi } from '../services/tauri/appApi';

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
  await hooks.beforeShow?.();
  await appWindow.show();
  await appWindow.setFocus();
  await hooks.afterShow?.();
}

export function useExternalPathBridge({
  handleExternalPaths,
  beforeWindowShow,
  afterWindowShow,
}: UseExternalPathBridgeOptions) {
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

  const consumePendingOpenPaths = async () => {
    const paths = await appApi.consumePendingOpenPaths();
    if (paths.length > 0) {
      await enqueueExternalPaths(paths, 'open');
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

    await consumePendingOpenPaths();

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
