import { describe, expect, it, vi } from 'vitest';

import { shouldAutoHideDesktopLyrics } from './useDesktopLyricsWindowController';

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock('./lyrics', () => ({
  loadSystemLyricsFonts: vi.fn(),
}));

vi.mock('../services/tauri/windowApi', () => ({
  windowApi: {
    getForegroundFullscreenState: vi.fn(),
    refreshCurrentWindowTopmost: vi.fn(),
    startTopmostGuard: vi.fn(),
    stopTopmostGuard: vi.fn(),
  },
}));

describe('desktop lyrics window controller helpers', () => {
  it('auto-hides when playback is paused and pause auto-hide is enabled', () => {
    expect(shouldAutoHideDesktopLyrics({
      autoHideWhenFullscreen: false,
      autoHideWhenPaused: true,
      isForegroundFullscreen: false,
      isPlaying: false,
      isResizeInteractionActive: false,
    })).toBe(true);
  });

  it('keeps desktop lyrics visible while playing when only pause auto-hide is enabled', () => {
    expect(shouldAutoHideDesktopLyrics({
      autoHideWhenFullscreen: false,
      autoHideWhenPaused: true,
      isForegroundFullscreen: false,
      isPlaying: true,
      isResizeInteractionActive: false,
    })).toBe(false);
  });

  it('keeps desktop lyrics visible during resize interactions', () => {
    expect(shouldAutoHideDesktopLyrics({
      autoHideWhenFullscreen: true,
      autoHideWhenPaused: true,
      isForegroundFullscreen: true,
      isPlaying: false,
      isResizeInteractionActive: true,
    })).toBe(false);
  });
});
