/**
 * Tests for restorePersistedAppSettings with equalizer / currentPresetId.
 *
 * Verifies that the restore path correctly merges persisted equalizer settings
 * including the currentPresetId field.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { createDefaultAppSettings, useSettingsStore } from './store';
import { restorePersistedAppSettings } from './restore';
import type { AppSettings } from '../../types';

describe('settings restore: equalizer currentPresetId round-trip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('restores persisted equalizer currentPresetId', () => {
    const settingsStore = useSettingsStore();

    const persisted: Partial<AppSettings> = {
      ...createDefaultAppSettings(),
      audio: {
        ...createDefaultAppSettings().audio,
        equalizer: {
          enabled: true,
          preamp: -3.5,
          gains: [5.5, 4.5, 3, 1.5, 0, 0, 0, 0, 0, 0],
          currentPresetId: 'restored_preset_id',
        },
      },
    };

    restorePersistedAppSettings(
      settingsStore.settings,
      settingsStore.replaceSettings,
      () => persisted as AppSettings,
    );

    expect(settingsStore.settings.audio.equalizer.currentPresetId).toBe('restored_preset_id');
    expect(settingsStore.settings.audio.equalizer.enabled).toBe(true);
    expect(settingsStore.settings.audio.equalizer.preamp).toBe(-3.5);
    expect(settingsStore.settings.audio.equalizer.gains).toEqual([5.5, 4.5, 3, 1.5, 0, 0, 0, 0, 0, 0]);
  });

  it('restores persisted settings without equalizer currentPresetId (backward compat)', () => {
    const settingsStore = useSettingsStore();

    const persisted: Partial<AppSettings> = {
      ...createDefaultAppSettings(),
      audio: {
        ...createDefaultAppSettings().audio,
        equalizer: {
          enabled: false,
          preamp: 0,
          gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          // currentPresetId intentionally omitted (legacy data)
        },
      },
    };

    restorePersistedAppSettings(
      settingsStore.settings,
      settingsStore.replaceSettings,
      () => persisted as AppSettings,
    );

    // currentPresetId should be null or undefined — no crash
    expect(settingsStore.settings.audio.equalizer.currentPresetId ?? null).toBeNull();
  });

  it('restore with null readSettings does nothing', () => {
    const settingsStore = useSettingsStore();
    const before = { ...settingsStore.settings.audio.equalizer };

    restorePersistedAppSettings(
      settingsStore.settings,
      settingsStore.replaceSettings,
      () => null,
    );

    expect(settingsStore.settings.audio.equalizer).toEqual(before);
  });

  it('restoring preserves other audio settings alongside equalizer', () => {
    const settingsStore = useSettingsStore();

    const persisted: Partial<AppSettings> = {
      ...createDefaultAppSettings(),
      audio: {
        outputMode: 'wasapiExclusive',
        volumeBalance: { enabled: true, gainOffsetDb: 5, preventClipping: false },
        equalizer: {
          enabled: true,
          preamp: -1.0,
          gains: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          currentPresetId: 'eq_preset',
        },
        showEqualizerInFooter: false,
      },
    };

    restorePersistedAppSettings(
      settingsStore.settings,
      settingsStore.replaceSettings,
      () => persisted as AppSettings,
    );

    expect(settingsStore.settings.audio.outputMode).toBe('wasapiExclusive');
    expect(settingsStore.settings.audio.volumeBalance.enabled).toBe(true);
    expect(settingsStore.settings.audio.equalizer.currentPresetId).toBe('eq_preset');
    expect(settingsStore.settings.audio.showEqualizerInFooter).toBe(false);
  });
});
