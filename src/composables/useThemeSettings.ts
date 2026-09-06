import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';

import {
  normalizeForegroundStyle,
  useSettingsStore,
  type ThemeSettingsPatch,
} from '../features/settings/store';
import type { ThemeSettings } from '../types';
import type { WindowMaterialMode } from './windowMaterial';

export type ResolvedSystemTheme = 'light' | 'dark';

const getSystemThemeFallback = (): ResolvedSystemTheme => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
};

const systemTheme = ref<ResolvedSystemTheme>(getSystemThemeFallback());

const resolveThemeDarkMode = (theme: ThemeSettings) => {
  if (theme.mode === 'system') {
    return systemTheme.value === 'dark';
  }

  if (theme.mode !== 'custom') {
    return theme.mode === 'dark';
  }

  const foregroundStyle = normalizeForegroundStyle(theme.customBackground.foregroundStyle);
  if (foregroundStyle === 'light') {
    return true;
  }
  return false;
};

export function useThemeSettings() {
  const settingsStore = useSettingsStore();
  const { settings, theme } = storeToRefs(settingsStore);

  const isCustomTheme = computed(() => theme.value.mode === 'custom');
  const resolvedSystemTheme = computed(() => systemTheme.value);
  const isDarkTheme = computed(() => resolveThemeDarkMode(theme.value));

  const setResolvedSystemTheme = (nextTheme: ResolvedSystemTheme | null | undefined) => {
    if (nextTheme === 'dark' || nextTheme === 'light') {
      systemTheme.value = nextTheme;
      return;
    }
    systemTheme.value = getSystemThemeFallback();
  };

  const replaceTheme = (nextTheme: ThemeSettings) => {
    settingsStore.replaceTheme(nextTheme);
  };

  const patchTheme = (partialTheme: ThemeSettingsPatch) => {
    settingsStore.patchTheme(partialTheme);
  };

  const setThemeMode = (mode: ThemeSettings['mode']) => {
    if (mode === 'custom') {
      patchTheme({
        mode,
        dynamicBgType: 'none',
        windowMaterial: 'none',
      });
      return;
    }

    patchTheme({ mode });
  };

  const toggleThemeMode = () => {
    if (theme.value.mode === 'custom') {
      const foregroundStyle = normalizeForegroundStyle(
        theme.value.customBackground.foregroundStyle,
      );
      updateCustomBackground({
        foregroundStyle: foregroundStyle === 'light' ? 'dark' : 'light',
      });
      return;
    }

    setThemeMode(isDarkTheme.value ? 'light' : 'dark');
  };

  const setDynamicBackgroundType = (dynamicBgType: ThemeSettings['dynamicBgType']) => {
    patchTheme({ dynamicBgType });
  };

  const setWindowMaterial = (windowMaterial: WindowMaterialMode) => {
    patchTheme({
      windowMaterial,
      ...(windowMaterial !== 'none' ? { dynamicBgType: 'none' as const } : {}),
    });
  };

  const updateCustomBackground = (customBackground: ThemeSettingsPatch['customBackground']) => {
    patchTheme({ customBackground });
  };

  return {
    settings,
    theme,
    isCustomTheme,
    resolvedSystemTheme,
    isDarkTheme,
    setResolvedSystemTheme,
    replaceTheme,
    patchTheme,
    setThemeMode,
    toggleThemeMode,
    setDynamicBackgroundType,
    setWindowMaterial,
    updateCustomBackground,
  };
}
