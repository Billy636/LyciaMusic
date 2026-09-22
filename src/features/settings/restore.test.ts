import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { createDefaultAppSettings, useSettingsStore } from './store';
import { restorePersistedAppSettings } from './restore';
import type { AppSettings } from '../../types';

describe('settings restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('enables startup update checks for older saved settings without the preference', () => {
    const store = useSettingsStore();
    restorePersistedAppSettings(store.settings, store.replaceSettings, () => ({ closeToTray: false }) as AppSettings);
    expect(store.settings.autoCheckUpdatesOnStartup).toBe(true);
  });

  it('preserves a disabled startup update preference when restoring settings', () => {
    const store = useSettingsStore();
    restorePersistedAppSettings(store.settings, store.replaceSettings, () => ({ autoCheckUpdatesOnStartup: false }) as AppSettings);
    expect(store.settings.autoCheckUpdatesOnStartup).toBe(false);
  });

  it('restores persisted theme before the startup theme sync reads settings', () => {
    const settingsStore = useSettingsStore();
    const persisted: Partial<AppSettings> = {
      theme: {
        ...createDefaultAppSettings().theme,
        mode: 'dark',
        windowMaterial: 'acrylic',
        dynamicBgType: 'flow',
      },
    };
    const replaceSettings = vi.fn(settingsStore.replaceSettings);

    restorePersistedAppSettings(
      settingsStore.settings,
      replaceSettings,
      () => persisted as AppSettings,
    );

    expect(replaceSettings).toHaveBeenCalledOnce();
    expect(settingsStore.settings.theme.mode).toBe('dark');
    expect(settingsStore.settings.theme.windowMaterial).toBe('acrylic');
    expect(settingsStore.settings.theme.dynamicBgType).toBe('none');
  });
});
