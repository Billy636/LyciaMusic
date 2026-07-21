import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useSettingsStore } from '../features/settings/store';
import { useThemeSettings } from './useThemeSettings';

describe('useThemeSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('toggles between light and dark theme modes', () => {
    const { theme, setThemeMode, toggleThemeMode } = useThemeSettings();

    expect(theme.value.mode).toBe('system');

    setThemeMode('light');

    toggleThemeMode();
    expect(theme.value.mode).toBe('dark');

    toggleThemeMode();
    expect(theme.value.mode).toBe('light');
  });

  it('resolves the system theme and leaves follow mode when manually toggled', () => {
    const {
      theme,
      isDarkTheme,
      setResolvedSystemTheme,
      toggleThemeMode,
    } = useThemeSettings();

    setResolvedSystemTheme('dark');

    expect(theme.value.mode).toBe('system');
    expect(isDarkTheme.value).toBe(true);

    toggleThemeMode();

    expect(theme.value.mode).toBe('light');
    expect(isDarkTheme.value).toBe(false);
  });

  it('toggles only the foreground style while preserving a custom background', () => {
    const settingsStore = useSettingsStore();
    const { theme, isDarkTheme, toggleThemeMode } = useThemeSettings();

    settingsStore.patchTheme({
      mode: 'custom',
      customBackground: {
        imagePath: '/covers/custom.jpg',
        blur: 28,
        foregroundStyle: 'light',
      },
    });

    expect(isDarkTheme.value).toBe(true);

    toggleThemeMode();

    expect(theme.value.mode).toBe('custom');
    expect(theme.value.customBackground.foregroundStyle).toBe('dark');
    expect(theme.value.customBackground.imagePath).toBe('/covers/custom.jpg');
    expect(theme.value.customBackground.blur).toBe(28);
    expect(isDarkTheme.value).toBe(false);

    toggleThemeMode();

    expect(theme.value.mode).toBe('custom');
    expect(theme.value.customBackground.foregroundStyle).toBe('light');
    expect(isDarkTheme.value).toBe(true);
  });
});
