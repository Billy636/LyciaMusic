import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { AppSettings, LyricsSettings } from '../../types';
import {
  LEGACY_LYRICS_SETTINGS_KEY,
  createDefaultLyricsSettings,
  defaultLyricsSettings,
  mergeLyricsSettings,
  normalizeLyricsSettingsPatch,
} from '../../composables/lyrics/constants';
import {
  DEFAULT_LYRICS_READING_ORDER,
  createLyricsReadingOrderOverridePatch,
  resolveLyricsReadingOrder,
} from '../../composables/lyrics/readingOrder';
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import { restorePersistedAppSettings } from './restore';
import { createDefaultAppSettings, useSettingsStore } from './store';

beforeEach(() => {
  setActivePinia(createPinia());
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('lyrics reading-order settings migration and persistence', () => {
  it('does not share override maps between defaults, app instances, or normalized settings', () => {
    const first = createDefaultLyricsSettings();
    const second = createDefaultLyricsSettings();
    first.readingOrderOverrides.song = 'roman-main-translation';
    expect(second.readingOrderOverrides).toEqual({});
    expect(defaultLyricsSettings.readingOrderOverrides).toEqual({});
    const normalized = normalizeLyricsSettingsPatch(first);
    expect(normalized.readingOrderOverrides).toEqual(first.readingOrderOverrides);
    expect(normalized.readingOrderOverrides).not.toBe(first.readingOrderOverrides);
    const app = createDefaultAppSettings();
    app.lyrics.readingOrderOverrides.song = 'translation-main-roman';
    expect(createDefaultAppSettings().lyrics.readingOrderOverrides).toEqual({});
  });

  it('keeps existing overrides on unrelated patches but replaces an explicitly supplied map', () => {
    const initial = normalizeLyricsSettingsPatch({
      showRomaji: true,
      readingOrder: 'roman-main-translation',
      readingOrderOverrides: { first: 'translation-main-roman', second: 'main-roman-translation' },
    });
    const changed = mergeLyricsSettings(initial, { playerFontScale: 1.8 });
    expect(changed.showRomaji).toBe(true);
    expect(changed.readingOrder).toBe('roman-main-translation');
    expect(changed.readingOrderOverrides).toEqual(initial.readingOrderOverrides);
    expect(changed.readingOrderOverrides).not.toBe(initial.readingOrderOverrides);
    const cleared = mergeLyricsSettings(changed, createLyricsReadingOrderOverridePatch(changed, 'first', null));
    expect(cleared.readingOrderOverrides).toEqual({ second: 'main-roman-translation' });
    expect(cleared.playerFontScale).toBe(1.8);
    expect(mergeLyricsSettings(changed, { readingOrderOverrides: {} }).readingOrderOverrides).toEqual({});
  });

  it('restores older settings with the new defaults without resetting existing user preferences', () => {
    const saved = createDefaultAppSettings();
    saved.theme.mode = 'dark';
    saved.lyricsSyncOffset = 0.35;
    saved.lyrics.showTranslation = false;
    saved.lyrics.showRomaji = true;
    saved.lyrics.playerRenderMode = 'light';
    saved.lyrics.playerFontScale = 1.8;
    saved.lyrics.playerFontPreset = 'Maple Mono';
    const oldLyrics = saved.lyrics as Partial<LyricsSettings>;
    delete oldLyrics.readingOrder;
    delete oldLyrics.readingOrderOverrides;
    playerStorage.writeSettings(saved);

    const store = useSettingsStore();
    restorePersistedAppSettings(store.settings, store.replaceSettings);

    expect(store.settings.theme.mode).toBe('dark');
    expect(store.settings.lyricsSyncOffset).toBe(0.35);
    expect(store.settings.lyrics).toMatchObject({
      readingOrder: DEFAULT_LYRICS_READING_ORDER,
      readingOrderOverrides: {},
      showTranslation: false,
      showRomaji: true,
      playerRenderMode: 'light',
      playerFontScale: 1.8,
      playerFontPreset: 'Maple Mono',
    });
  });

  it('migrates the old standalone lyrics preference through the existing restore route', () => {
    playerStorage.writeSettings({ closeToTray: false } as AppSettings);
    localStorage.setItem(LEGACY_LYRICS_SETTINGS_KEY, JSON.stringify({ showRomaji: true, playerOffsetX: 12 }));
    const store = useSettingsStore();
    restorePersistedAppSettings(store.settings, store.replaceSettings);
    expect(store.settings.closeToTray).toBe(false);
    expect(store.settings.lyrics).toMatchObject({
      showRomaji: true,
      playerOffsetX: 12,
      readingOrder: DEFAULT_LYRICS_READING_ORDER,
      readingOrderOverrides: {},
    });
  });

  it('persists global and exact song-path overrides through the existing settings storage', () => {
    const store = useSettingsStore();
    store.patchSettings({ lyrics: {
      readingOrder: 'translation-roman-main',
      readingOrderOverrides: {
        'D:/Music/One.flac': 'roman-main-translation',
        'remote://source/Two.flac': 'main-roman-translation',
      },
    } });
    playerStorage.writeSettings(store.settings);
    expect(localStorage.getItem(playerStorageKeys.settings)).toContain('readingOrderOverrides');
    store.resetSettings();
    restorePersistedAppSettings(store.settings, store.replaceSettings);
    expect(resolveLyricsReadingOrder(store.settings.lyrics, 'D:/Music/One.flac')).toBe('roman-main-translation');
    expect(resolveLyricsReadingOrder(store.settings.lyrics, 'unknown')).toBe('translation-roman-main');
    store.patchSettings({ lyrics: createLyricsReadingOrderOverridePatch(store.settings.lyrics, 'D:/Music/One.flac', null) });
    playerStorage.writeSettings(store.settings);
    store.resetSettings();
    restorePersistedAppSettings(store.settings, store.replaceSettings);
    expect(resolveLyricsReadingOrder(store.settings.lyrics, 'D:/Music/One.flac')).toBe('translation-roman-main');
    expect(resolveLyricsReadingOrder(store.settings.lyrics, 'remote://source/Two.flac')).toBe('main-roman-translation');
  });

  it('drops corrupt reading-order values without discarding valid lyrics preferences', () => {
    const saved = createDefaultAppSettings();
    localStorage.setItem(playerStorageKeys.settings, JSON.stringify({
      ...saved,
      lyrics: {
        ...saved.lyrics,
        showRomaji: true,
        playerLineGap: 1.75,
        readingOrder: 'auto-language',
        readingOrderOverrides: { '': 'main-roman-translation', broken: 'auto', good: 'translation-main-roman' },
      },
    }));
    const store = useSettingsStore();
    restorePersistedAppSettings(store.settings, store.replaceSettings);
    expect(store.settings.lyrics.readingOrder).toBe(DEFAULT_LYRICS_READING_ORDER);
    expect(store.settings.lyrics.readingOrderOverrides).toEqual({ good: 'translation-main-roman' });
    expect(store.settings.lyrics.showRomaji).toBe(true);
    expect(store.settings.lyrics.playerLineGap).toBe(1.75);
  });
});
