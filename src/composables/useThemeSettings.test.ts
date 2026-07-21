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

  it('toggles custom themes from the current resolved display mode', () => {
    const settingsStore = useSettingsStore();
    const { theme, toggleThemeMode } = useThemeSettings();

    settingsStore.patchTheme({
      mode: 'custom',
      customBackground: {
        foregroundStyle: 'light',
      },
    });

    toggleThemeMode();

    expect(theme.value.mode).toBe('light');
  });
});
