import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { storeToRefs } from 'pinia';

import { useUiStore } from '../shared/stores/ui';

export interface MainWindowRenderingSnapshot {
  documentHidden: boolean;
  windowFocused: boolean;
  windowVisible: boolean;
  windowMinimized: boolean;
  miniMode: boolean;
}

const defaultSnapshot = (): MainWindowRenderingSnapshot => ({
  documentHidden: typeof document !== 'undefined' ? document.hidden : false,
  windowFocused: true,
  windowVisible: true,
  windowMinimized: false,
  miniMode: false,
});

const mainWindowRenderingSnapshot = ref<MainWindowRenderingSnapshot>(defaultSnapshot());

export function resolveMainWindowLowPower(snapshot: MainWindowRenderingSnapshot) {
  return !snapshot.windowVisible
    || snapshot.windowMinimized
    || snapshot.miniMode;
}

export function setMainWindowRenderingSnapshot(patch: Partial<MainWindowRenderingSnapshot>) {
  mainWindowRenderingSnapshot.value = {
    ...mainWindowRenderingSnapshot.value,
    ...patch,
  };
}

const isMainWindowLowPower = computed(() => resolveMainWindowLowPower(mainWindowRenderingSnapshot.value));

export function useRenderingPower() {
  return {
    mainWindowRenderingSnapshot,
    isMainWindowLowPower,
  };
}

export function useMainWindowRenderingPower() {
  const appWindow = getCurrentWindow();
  const { isMiniMode } = storeToRefs(useUiStore());
  const unlisteners: Array<() => void> = [];

  const syncDocumentVisibility = () => {
    setMainWindowRenderingSnapshot({ documentHidden: document.hidden });
  };

  const syncWindowState = async () => {
    try {
      const [windowFocused, windowVisible, windowMinimized] = await Promise.all([
        appWindow.isFocused(),
        appWindow.isVisible(),
        appWindow.isMinimized(),
      ]);

      setMainWindowRenderingSnapshot({
        windowFocused,
        windowVisible,
        windowMinimized,
      });
    } catch {}
  };

  onMounted(async () => {
    syncDocumentVisibility();
    await syncWindowState();

    document.addEventListener('visibilitychange', syncDocumentVisibility);
    window.addEventListener('focus', syncWindowState);
    window.addEventListener('blur', syncWindowState);

    unlisteners.push(await appWindow.onFocusChanged(({ payload }) => {
      setMainWindowRenderingSnapshot({ windowFocused: payload });
      void syncWindowState();
    }));
    unlisteners.push(await appWindow.onResized(() => {
      void syncWindowState();
    }));
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', syncDocumentVisibility);
    window.removeEventListener('focus', syncWindowState);
    window.removeEventListener('blur', syncWindowState);
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  });

  watch(
    isMiniMode,
    (miniMode) => {
      setMainWindowRenderingSnapshot({ miniMode });
    },
    { immediate: true },
  );

  return useRenderingPower();
}
