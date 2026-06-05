import { getCurrentWindow } from '@tauri-apps/api/window';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { useWindowMaterial } from './windowMaterial';
import { useThemeSettings } from './useThemeSettings';

export function useAppThemeSync() {
  const {
    activeWindowMaterial,
    applyWindowMaterial,
    rebuildWindowMaterialForCompositor,
    loadWindowMaterialCapabilities,
  } = useWindowMaterial();
  const { theme, isDarkTheme } = useThemeSettings();
  const appWindow = getCurrentWindow();

  const hasWindowMaterial = computed(() => activeWindowMaterial.value !== 'none');
  const isMicaWindowMaterial = computed(() => activeWindowMaterial.value === 'mica');
  let restoreSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let unlistenFocusChanged: UnlistenFn | null = null;
  let syncGeneration = 0;
  let skipNextFocusRestore = false;
  let resolveInitialThemeSync: (() => void) | null = null;
  const initialThemeSync = new Promise<void>((resolve) => {
    resolveInitialThemeSync = resolve;
  });

  const markInitialThemeSynced = () => {
    resolveInitialThemeSync?.();
    resolveInitialThemeSync = null;
  };

  const applyTheme = async () => {
    if (isDarkTheme.value) {
      document.documentElement.classList.add('dark');
      try {
        await appWindow.setTheme('dark');
      } catch (error) {
        console.warn('Failed to set window theme:', error);
      }
      return;
    }

    document.documentElement.classList.remove('dark');
    try {
      await appWindow.setTheme('light');
    } catch (error) {
      console.warn('Failed to set window theme:', error);
    }
  };

  const syncWindowMaterial = async () => {
    await nextTick();
    await applyWindowMaterial(
      theme.value.windowMaterial,
      document.documentElement.classList.contains('dark'),
      theme.value.windowBlurTint,
    );
  };

  const syncThemeAndMaterial = async () => {
    const gen = ++syncGeneration;
    try {
      await applyTheme();
      if (gen !== syncGeneration) return;
      await syncWindowMaterial();
    } finally {
      if (gen === syncGeneration) {
        markInitialThemeSynced();
      }
    }
  };

  const scheduleRestoreMaterialSync = () => {
    if (skipNextFocusRestore) {
      skipNextFocusRestore = false;
      return;
    }

    if (restoreSyncTimer) {
      clearTimeout(restoreSyncTimer);
      restoreSyncTimer = null;
    }

    void syncThemeAndMaterial();

    // DWM can finish restoring a blurred transparent window after the focus event.
    restoreSyncTimer = setTimeout(() => {
      restoreSyncTimer = null;
      void syncThemeAndMaterial();
    }, 120);
  };

  const rebuildMaterialComposition = async () => {
    const gen = ++syncGeneration;
    try {
      await applyTheme();
      if (gen !== syncGeneration) return;
      await nextTick();
      await rebuildWindowMaterialForCompositor(
        theme.value.windowMaterial,
        document.documentElement.classList.contains('dark'),
        theme.value.windowBlurTint,
      );
    } finally {
      if (gen === syncGeneration) {
        markInitialThemeSynced();
      }
    }
  };

  const scheduleStartupMaterialRebuild = () => {
    if (theme.value.windowMaterial === 'none') {
      return;
    }

    if (restoreSyncTimer) {
      clearTimeout(restoreSyncTimer);
      restoreSyncTimer = null;
    }

    restoreSyncTimer = setTimeout(() => {
      restoreSyncTimer = null;
      void rebuildMaterialComposition();
    }, 180);
  };

  const rebuildStartupMaterialBeforeShow = async () => {
    if (theme.value.windowMaterial === 'none') {
      return;
    }

    if (restoreSyncTimer) {
      clearTimeout(restoreSyncTimer);
      restoreSyncTimer = null;
    }

    await rebuildMaterialComposition();
    skipNextFocusRestore = true;
  };

  void loadWindowMaterialCapabilities();

  watch(
    [
      () => theme.value.mode,
      () => theme.value.windowMaterial,
      () => theme.value.windowBlurTint,
      () => theme.value.customBackground.foregroundStyle,
    ],
    () => {
      void syncThemeAndMaterial();
    },
    { immediate: true },
  );

  onMounted(() => {
    void appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        scheduleRestoreMaterialSync();
      }
    }).then((unlisten) => {
      unlistenFocusChanged = unlisten;
    });
  });

  onBeforeUnmount(() => {
    if (restoreSyncTimer) {
      clearTimeout(restoreSyncTimer);
      restoreSyncTimer = null;
    }

    if (unlistenFocusChanged) {
      unlistenFocusChanged();
      unlistenFocusChanged = null;
    }
  });

  return {
    activeWindowMaterial,
    hasWindowMaterial,
    isMicaWindowMaterial,
    syncWindowMaterial,
    whenInitialThemeSynced: () => initialThemeSync,
    restoreMaterialAfterShow: scheduleStartupMaterialRebuild,
    rebuildStartupMaterialBeforeShow,
  };
}
