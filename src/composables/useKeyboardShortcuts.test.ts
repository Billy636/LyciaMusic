import { describe, expect, it, vi } from 'vitest';

import { createDefaultShortcutSettings } from '../features/settings/shortcuts';
import { createGlobalShortcutSyncKey } from './useKeyboardShortcuts';

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: vi.fn(),
  unregister: vi.fn(),
  unregisterAll: vi.fn(),
}));

vi.mock('../features/collections/useLibraryCollections', () => ({
  useLibraryCollections: vi.fn(),
}));

vi.mock('../features/playback/usePlaybackController', () => ({
  usePlaybackController: vi.fn(),
}));

vi.mock('../features/settings/useSettings', () => ({
  useSettings: vi.fn(),
}));

vi.mock('./lyrics', () => ({
  useLyrics: vi.fn(),
}));

vi.mock('../shared/stores/ui', () => ({
  useUiStore: vi.fn(),
}));

vi.mock('./toast', () => ({
  useToast: vi.fn(),
}));

describe('keyboard shortcut helpers', () => {
  it('keeps the global shortcut sync key stable when settings objects are replaced without shortcut changes', () => {
    const settings = createDefaultShortcutSettings();
    settings.globalEnabled = true;

    const clonedSettings = JSON.parse(JSON.stringify(settings));

    expect(createGlobalShortcutSyncKey(clonedSettings)).toBe(createGlobalShortcutSyncKey(settings));
  });

  it('changes the global shortcut sync key only when global shortcut behavior changes', () => {
    const settings = createDefaultShortcutSettings();
    const enabledSettings = {
      ...settings,
      globalEnabled: true,
    };
    const changedBindingSettings = {
      ...enabledSettings,
      global: {
        ...enabledSettings.global,
        toggleFavorite: {
          code: 'KeyF',
          ctrl: true,
          alt: true,
          shift: false,
          meta: false,
        },
      },
    };

    expect(createGlobalShortcutSyncKey(enabledSettings)).not.toBe(createGlobalShortcutSyncKey(settings));
    expect(createGlobalShortcutSyncKey(changedBindingSettings)).not.toBe(createGlobalShortcutSyncKey(enabledSettings));
  });
});
