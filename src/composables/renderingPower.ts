import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getCurrentWindow, type Window } from '@tauri-apps/api/window';
import { setLibrarySongPathCacheLowPower } from '../caches/librarySongPathCache';

export interface MainWindowRenderingSnapshot {
  documentHidden: boolean;
  windowFocused: boolean;
  windowVisible: boolean;
  windowMinimized: boolean;
}

const defaultSnapshot = (): MainWindowRenderingSnapshot => ({
  documentHidden: typeof document !== 'undefined' ? document.hidden : false,
  windowFocused: true,
  windowVisible: true,
  windowMinimized: false,
});

const mainWindowRenderingSnapshot = ref<MainWindowRenderingSnapshot>(defaultSnapshot());

export function resolveMainWindowLowPower(snapshot: MainWindowRenderingSnapshot) {
  return snapshot.documentHidden
    || !snapshot.windowVisible
    || snapshot.windowMinimized;
}

export function setMainWindowRenderingSnapshot(patch: Partial<MainWindowRenderingSnapshot>) {
  mainWindowRenderingSnapshot.value = {
    ...mainWindowRenderingSnapshot.value,
    ...patch,
  };
  setLibrarySongPathCacheLowPower(resolveMainWindowLowPower(mainWindowRenderingSnapshot.value));
}

export function setMainWindowFocusState(windowFocused: boolean) {
  setMainWindowRenderingSnapshot(windowFocused
    ? {
        documentHidden: false,
        windowFocused: true,
        windowVisible: true,
        windowMinimized: false,
      }
    : { windowFocused: false });
}

const isMainWindowLowPower = computed(() => resolveMainWindowLowPower(mainWindowRenderingSnapshot.value));

export function useRenderingPower() {
  return {
    mainWindowRenderingSnapshot,
    isMainWindowLowPower,
  };
}

export async function hideMainWindowToTray(appWindow: Window = getCurrentWindow()) {
  await appWindow.hide();
  setMainWindowRenderingSnapshot({
    documentHidden: true,
    windowFocused: false,
    windowVisible: false,
    windowMinimized: false,
  });
}

export function useMainWindowRenderingPower() {
  const appWindow = getCurrentWindow();
  const unlisteners: Array<() => void> = [];
  let windowStateGeneration = 0;

  const syncDocumentVisibility = () => {
    setMainWindowRenderingSnapshot({ documentHidden: document.hidden });
    if (!document.hidden) void syncWindowState();
  };

  const syncWindowState = async () => {
    const generation = ++windowStateGeneration;
    try {
      const [windowFocused, windowVisible, windowMinimized] = await Promise.all([
        appWindow.isFocused(),
        appWindow.isVisible(),
        appWindow.isMinimized(),
      ]);
      // A delayed hide/blur sample must not overwrite a newer restore sample.
      if (generation !== windowStateGeneration) return;

      setMainWindowRenderingSnapshot({
        documentHidden: windowFocused && windowVisible && !windowMinimized ? false : document.hidden,
        windowFocused,
        windowVisible,
        windowMinimized,
      });
    } catch {}
  };

  const handleWindowFocus = () => {
    setMainWindowFocusState(true);
    void syncWindowState();
  };

  onMounted(async () => {
    document.addEventListener('visibilitychange', syncDocumentVisibility);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('blur', syncWindowState);

    unlisteners.push(await appWindow.onFocusChanged(({ payload }) => {
      // A focused native window is necessarily visible. Clear the explicit
      // documentHidden flag set by close-to-tray even when WebView2 omits the
      // matching visibilitychange event during restoration.
      setMainWindowFocusState(payload);
      void syncWindowState();
    }));
    unlisteners.push(await appWindow.onResized(() => {
      void syncWindowState();
    }));
    syncDocumentVisibility();
    await syncWindowState();
  });

  onUnmounted(() => {
    windowStateGeneration++;
    document.removeEventListener('visibilitychange', syncDocumentVisibility);
    window.removeEventListener('focus', handleWindowFocus);
    window.removeEventListener('blur', syncWindowState);
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  });

  return useRenderingPower();
}
