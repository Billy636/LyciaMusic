import { describe, expect, it } from 'vitest';

import {
  createDefaultShortcutSettings,
  getShortcutBindingFromEvent,
  isSystemReservedShortcutEvent,
  matchesShortcutEvent,
  shortcutActionLabels,
  shortcutActionOrder,
  toGlobalShortcutAccelerator,
} from './shortcuts';

describe('shortcut settings helpers', () => {
  it('keeps global shortcuts disabled by default', () => {
    expect(createDefaultShortcutSettings().globalEnabled).toBe(false);
  });

  it('offers desktop lyrics lock shortcuts instead of lyric translation shortcuts', () => {
    const defaults = createDefaultShortcutSettings();

    expect(shortcutActionOrder).toContain('toggleDesktopLyricsLock');
    expect(shortcutActionOrder).not.toContain('toggleLyricTranslation');
    expect(shortcutActionLabels.toggleDesktopLyricsLock).toBe('锁定/解锁桌面歌词');
    expect(defaults.local.toggleDesktopLyricsLock).toEqual({
      code: 'KeyD',
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    });
    expect(defaults.global.toggleDesktopLyricsLock).toBeNull();
  });

  it('converts shortcut bindings to tauri global accelerators', () => {
    expect(toGlobalShortcutAccelerator({
      code: 'KeyP',
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    })).toBe('control+alt+KeyP');

    expect(toGlobalShortcutAccelerator({
      code: 'ArrowLeft',
      ctrl: false,
      alt: false,
      shift: true,
      meta: true,
    })).toBeNull();
  });

  it('returns null for empty bindings', () => {
    expect(toGlobalShortcutAccelerator(null)).toBeNull();
  });

  it('does not capture Windows/Meta key combinations', () => {
    expect(getShortcutBindingFromEvent({
      code: 'KeyJ',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: true,
    } as KeyboardEvent)).toBeNull();
  });

  it('identifies Windows/Meta key events as system reserved', () => {
    expect(isSystemReservedShortcutEvent({
      code: 'KeyJ',
      metaKey: true,
    } as KeyboardEvent)).toBe(true);
  });

  it('does not match legacy Windows/Meta shortcut bindings', () => {
    expect(matchesShortcutEvent({
      code: 'KeyJ',
      ctrl: false,
      alt: false,
      shift: false,
      meta: true,
    }, {
      code: 'KeyJ',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: true,
    } as KeyboardEvent)).toBe(false);
  });
});
