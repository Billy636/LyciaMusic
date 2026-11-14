import { invoke, isTauri } from '@tauri-apps/api/core';
import type { DesktopLyricsPlaybackPayload, DesktopLyricsStatePayload, DesktopLyricsWindowBounds } from './shared';

// Browser previews and other platforms retain the WebView renderer.
export const usesNativeDesktopLyrics = () => isTauri()
  && typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

export const nativeDesktopLyrics = {
  open: (payload: DesktopLyricsStatePayload, bounds: DesktopLyricsWindowBounds | null) =>
    invoke<void>('native_desktop_lyrics_open', { payload, bounds }),
  state: (payload: DesktopLyricsStatePayload) => invoke<void>('native_desktop_lyrics_state', { payload }),
  playback: (payload: DesktopLyricsPlaybackPayload) => invoke<void>('native_desktop_lyrics_playback', { payload }),
  reveal: () => invoke<void>('native_desktop_lyrics_reveal'),
  close: () => invoke<void>('native_desktop_lyrics_close'),
};
