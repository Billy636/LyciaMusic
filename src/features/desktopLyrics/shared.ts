import type {
  DesktopLyricsSettings,
  ImportedLyricsFont,
  LyricsStatus,
  LyricLine,
} from '../../composables/lyrics';
import type { Song } from '../../types';

export { DESKTOP_LYRICS_WINDOW_LABEL } from '../../windowLabels';
export const DESKTOP_LYRICS_STATE_EVENT = 'desktop-lyrics:state';
export const DESKTOP_LYRICS_ERROR_EVENT = 'desktop-lyrics:error';
export const DESKTOP_LYRICS_PLAYBACK_EVENT = 'desktop-lyrics:playback';
export const DESKTOP_LYRICS_READY_EVENT = 'desktop-lyrics:ready';
export const DESKTOP_LYRICS_REQUEST_STATE_EVENT = 'desktop-lyrics:request-state';
export const DESKTOP_LYRICS_ACTION_EVENT = 'desktop-lyrics:action';
export const DESKTOP_LYRICS_VISIBILITY_EVENT = 'desktop-lyrics:visibility';
export const DESKTOP_LYRICS_BOUNDS_EVENT = 'desktop-lyrics:bounds';
export const DESKTOP_LYRICS_REVEAL_SURFACE_EVENT = 'desktop-lyrics:reveal-surface';
export const DESKTOP_LYRICS_RESET_BOUNDS_EVENT = 'desktop-lyrics:reset-bounds';
export const DESKTOP_LYRICS_BOUNDS_KEY = 'desktop_lyrics_window_bounds';

export const DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH = 900;
export const DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT = 280;
export const DESKTOP_LYRICS_WINDOW_MIN_WIDTH = 520;
export const DESKTOP_LYRICS_WINDOW_MIN_HEIGHT = 160;
export const DESKTOP_LYRICS_WINDOW_MAX_WIDTH = 1440;
export const DESKTOP_LYRICS_WINDOW_MAX_HEIGHT = 1000;

export interface DesktopLyricsContentSettings {
  showTranslation: boolean;
  showRomaji: boolean;
}

export interface DesktopLyricsWindowSettings
  extends DesktopLyricsContentSettings, DesktopLyricsSettings {}

export interface DesktopLyricsSongSnapshot {
  path: string;
  title: string;
  artist: string;
  duration: number;
}

export interface DesktopLyricsWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopLyricsStatePayload {
  song: DesktopLyricsSongSnapshot | null;
  parsedLyrics: LyricLine[];
  lyricsStatus: LyricsStatus;
  fallbackText: string;
  playbackTime: number;
  syncedAt: number;
  isPlaying: boolean;
  audioDelay: number;
  settings: DesktopLyricsWindowSettings;
  customLyricsFonts: ImportedLyricsFont[];
  themeColors: string[];
}

export interface DesktopLyricsPlaybackPayload {
  playbackTime: number;
  syncedAt: number;
  isPlaying: boolean;
  audioDelay: number;
}

export type DesktopLyricsSettingsPatch = Partial<DesktopLyricsWindowSettings>;

export type DesktopLyricsAction =
  | { type: 'toggle-play' }
  | { type: 'prev-song' }
  | { type: 'next-song' }
  | { type: 'adjust-offset'; delta: number }
  | { type: 'close' }
  | { type: 'update-settings'; patch: DesktopLyricsSettingsPatch };

export function createDesktopLyricsSongSnapshot(song: Song | null): DesktopLyricsSongSnapshot | null {
  if (!song) return null;

  return {
    path: song.path,
    title: song.title || song.name,
    artist: song.artist || 'Unknown Artist',
    duration: song.duration,
  };
}

export function restoreDesktopLyricsBounds(
  bounds: Partial<DesktopLyricsWindowBounds>,
): DesktopLyricsWindowBounds | null {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return null;

  // Coordinates are user-owned, including taskbar overlap and fully off-screen
  // positions. Renderers enforce their own DPI-aware size safety limits.
  return {
    x: Math.round(bounds.x as number),
    y: Math.round(bounds.y as number),
    width: Math.max(
      DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
      Math.round(Number.isFinite(bounds.width) ? bounds.width as number : DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH),
    ),
    height: Math.max(
      DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
      Math.round(Number.isFinite(bounds.height) ? bounds.height as number : DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT),
    ),
  };
}
