import { describe, expect, it } from 'vitest';

import {
  createDefaultShortcutSettings,
  getShortcutBindingFromEvent,
  isSystemReservedShortcutEvent,
  matchesShortcutEvent,
  normalizeShortcutSettings,
  shortcutActionLabels,
  shortcutActionOrder,
  toGlobalShortcutAccelerator,
} from './shortcuts';

describe('shortcut settings helpers', () => {
  it('keeps global shortcuts disabled by default', () => {
    expect(createDefaultShortcutSettings().globalEnabled).toBe(false);
  });

  it('offers a configurable main window toggle with Ctrl+W as the local default', () => {
    const defaults = createDefaultShortcutSettings();

    expect(shortcutActionLabels.toggleMainWindow).toBe('显示/收起主窗口');
    expect(defaults.local.toggleMainWindow).toEqual({
      code: 'KeyW',
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    });
    expect(defaults.global.toggleMainWindow).toBeNull();
  });

  it('adds the main window toggle when loading shortcut settings saved by an older version', () => {
    const legacySettings = createDefaultShortcutSettings();
    delete (legacySettings.local as Partial<typeof legacySettings.local>).toggleMainWindow;
    delete (legacySettings.global as Partial<typeof legacySettings.global>).toggleMainWindow;

    const normalized = normalizeShortcutSettings(legacySettings);

    expect(normalized.local.toggleMainWindow).toEqual({
      code: 'KeyW',
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    });
    expect(normalized.global.toggleMainWindow).toBeNull();
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

  it('offers local song highlight shortcuts while leaving global bindings empty', () => {
    const defaults = createDefaultShortcutSettings();

    expect(shortcutActionLabels.addSongHighlight).toBe('添加/更新高潮点');
    expect(shortcutActionLabels.playSongHighlight).toBe('跳到主高潮并播放');
    expect(defaults.local.addSongHighlight).toEqual({
      code: 'KeyM',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    });
    expect(defaults.local.playSongHighlight).toEqual({
      code: 'KeyM',
      ctrl: false,
      alt: false,
      shift: true,
      meta: false,
    });
    expect(defaults.global.addSongHighlight).toBeNull();
    expect(defaults.global.playSongHighlight).toBeNull();
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
