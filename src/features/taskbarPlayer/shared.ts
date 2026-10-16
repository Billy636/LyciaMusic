import type { Song } from '../../types';
import type { LyricLine, LyricsStatus } from '../../composables/lyrics/types';

export { TASKBAR_PLAYER_WINDOW_LABEL } from '../../windowLabels';
export const TASKBAR_PLAYER_STATE_EVENT = 'taskbar-player:state';
export const TASKBAR_PLAYER_PLAYBACK_EVENT = 'taskbar-player:playback';
export const TASKBAR_PLAYER_STATE_APPLIED_EVENT = 'taskbar-player:state-applied';
export const TASKBAR_PLAYER_ACTION_EVENT = 'taskbar-player:action';
export const TASKBAR_PLAYER_REQUEST_STATE_EVENT = 'taskbar-player:request-state';
export const TASKBAR_PLAYER_READY_EVENT = 'taskbar-player:ready';
export const TASKBAR_PLAYER_VISIBILITY_EVENT = 'taskbar-player:visibility';
export const TASKBAR_PLAYER_DRAG_EVENT = 'taskbar-player:drag';
export const TASKBAR_PLAYER_POSITION_X_KEY = 'taskbar_player_window_position_x';

export const TASKBAR_PLAYER_WINDOW_WIDTH = 280;
export const TASKBAR_PLAYER_MIN_WIDTH = 220;
export const TASKBAR_PLAYER_MAX_WIDTH = 600;
export const TASKBAR_PLAYER_DEFAULT_TEXT_COLOR = '#ffffff';
export type TaskbarContentMode = 'title-lyrics' | 'bilingual' | 'double-line' | 'lyrics-only';
export type TaskbarLyricEffect = 'karaoke' | 'word' | 'none';
export type TaskbarCoverShape = 'square' | 'circle';

export function normalizeTaskbarContentMode(value: unknown): TaskbarContentMode {
  return value === 'bilingual' || value === 'double-line' || value === 'lyrics-only' ? value : 'title-lyrics';
}

export function normalizeTaskbarLyricEffect(value: unknown): TaskbarLyricEffect {
  return value === 'word' || value === 'none' ? value : 'karaoke';
}

/** A null highlight follows the taskbar font color, including existing settings. */
export function normalizeTaskbarLyricHighlightColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase() : null;
}

export function normalizeTaskbarCoverShape(value: unknown): TaskbarCoverShape {
  return value === 'circle' ? 'circle' : 'square';
}

export function normalizeTaskbarLeftOffset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(value))) : 0;
}

export function normalizeTaskbarTextColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase() : TASKBAR_PLAYER_DEFAULT_TEXT_COLOR;
}
export function normalizeTaskbarWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(TASKBAR_PLAYER_MAX_WIDTH, Math.max(TASKBAR_PLAYER_MIN_WIDTH, Math.round(value)))
    : TASKBAR_PLAYER_WINDOW_WIDTH;
}
export const TASKBAR_PLAYER_WINDOW_HEIGHT = 40;

export type OwnerBindingState = 'bound' | 'failed' | 'unsupported' | 'already_bound';
export type GeometrySource = 'tray' | 'taskbar_fallback';

export interface RectPhysical {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TaskbarTrayGeometry {
  taskbar_rect_physical: RectPhysical;
  tray_rect_physical: RectPhysical | null;
  taskbar_hwnd_changed: boolean;
  owner_binding: OwnerBindingState;
  source: GeometrySource;
  scale_factor: number;
}

export function readSavedTaskbarPositionX(): number | null {
  if (typeof localStorage === 'undefined') return null;
  const stored = localStorage.getItem(TASKBAR_PLAYER_POSITION_X_KEY);
  if (!stored) return null;
  const parsed = parseInt(stored, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function writeSavedTaskbarPositionX(x: number) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(TASKBAR_PLAYER_POSITION_X_KEY, String(Math.round(x)));
}

export interface TaskbarPlayerPlaybackPayload {
  songPath: string | null;
  playbackTime: number;
  syncedAt: number;
  isPlaying: boolean;
  audioDelay: number;
}

export interface TaskbarPlayerStatePayload extends TaskbarPlayerPlaybackPayload {
  currentSong: Song | null;
  coverUrl: string;
  isDarkTheme: boolean;
  backgroundOpacity?: number;
  textColor?: string;
  contentMode?: TaskbarContentMode;
  lyricEffect?: TaskbarLyricEffect;
  lyricHighlightColor?: string | null;
  translationKaraoke?: boolean;
  coverShape?: TaskbarCoverShape;
  coverRotate?: boolean;
  canDrag?: boolean;
  parsedLyrics: LyricLine[];
  lyricsStatus: LyricsStatus;
}

export interface TaskbarPlayerDragPayload {
  dragging: boolean;
  leftOffset?: number;
}

export type TaskbarPlayerAction =
  | { type: 'toggle-main-window' }
  | { type: 'toggle-play' }
  | { type: 'prev-song' }
  | { type: 'next-song' }
  | { type: 'set-left-offset'; offset: number }
  | { type: 'align-left' }
  | { type: 'close' };
