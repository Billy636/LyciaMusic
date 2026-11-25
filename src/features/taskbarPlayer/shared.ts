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
export const TASKBAR_PLAYER_PANEL_EVENT = 'taskbar-player:panel';
export const TASKBAR_PLAYER_PANEL_REQUEST_EVENT = 'taskbar-player:panel-request';
export const TASKBAR_PLAYER_QUEUE_EVENT = 'taskbar-player:queue';
export const TASKBAR_PLAYER_POSITION_X_KEY = 'taskbar_player_window_position_x';

export const TASKBAR_PLAYER_WINDOW_WIDTH = 280;
export const TASKBAR_PLAYER_MIN_WIDTH = 220;
export const TASKBAR_PLAYER_MAX_WIDTH = 600;
/** 距左边缘的设置范围（逻辑像素）；实际落位仍会按屏幕宽度再次钳制。
 * 下限为负，允许把窗口完全缩进桌面左边界（最长窗口 600px）。 */
export const TASKBAR_PLAYER_MIN_LEFT_OFFSET = -600;
export const TASKBAR_PLAYER_MAX_LEFT_OFFSET = 1430;
export const TASKBAR_PLAYER_DEFAULT_TEXT_COLOR = '#ffffff';
export const TASKBAR_PLAYER_DEFAULT_BACKGROUND_COLOR = '#1b1b20';
export const TASKBAR_PLAYER_DEFAULT_BACKGROUND_OPACITY = 50;
export type TaskbarFrameShape = 'rounded' | 'pill' | 'square';

export function normalizeTaskbarFrameShape(value: unknown): TaskbarFrameShape {
  return value === 'pill' || value === 'square' ? value : 'rounded';
}

export type TaskbarBackgroundMode = 'live' | 'color';

export function normalizeTaskbarBackgroundMode(value: unknown): TaskbarBackgroundMode {
  return value === 'color' ? 'color' : 'live';
}

export function normalizeTaskbarBackgroundColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase() : TASKBAR_PLAYER_DEFAULT_BACKGROUND_COLOR;
}

export type TaskbarContentMode = 'adaptive' | 'title-lyrics' | 'bilingual' | 'double-line' | 'lyrics-only';
export type TaskbarLyricEffect = 'karaoke' | 'none';
/** 方形（直角）/ 圆角矩形 / 圆形。旧值 'square' 实际是圆角矩形，已迁移为 'rounded'。 */
export type TaskbarCoverShape = 'square' | 'rounded' | 'circle';

export function normalizeTaskbarContentMode(value: unknown): TaskbarContentMode {
  return value === 'title-lyrics' || value === 'bilingual' || value === 'double-line' || value === 'lyrics-only'
    ? value : 'adaptive';
}

export function normalizeTaskbarLyricEffect(value: unknown): TaskbarLyricEffect {
  return value === 'none' ? value : 'karaoke';
}

/** A null highlight follows the taskbar font color, including existing settings. */
export function normalizeTaskbarLyricHighlightColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase() : null;
}

export function normalizeTaskbarCoverShape(value: unknown): TaskbarCoverShape {
  if (value === 'circle') return 'circle';
  if (value === 'square') return 'square';
  return 'rounded';
}

/** 各种外框下允许的封面形状组合。 */
export function resolveAllowedCoverShapes(frameShape: TaskbarFrameShape): TaskbarCoverShape[] {
  if (frameShape === 'pill') return ['circle'];
  if (frameShape === 'rounded') return ['rounded', 'circle'];
  return ['square', 'rounded', 'circle'];
}

export function coerceCoverShapeForFrame(
  coverShape: TaskbarCoverShape,
  frameShape: TaskbarFrameShape,
): TaskbarCoverShape {
  const allowed = resolveAllowedCoverShapes(frameShape);
  return allowed.includes(coverShape) ? coverShape : allowed[0];
}

/** Desktop coordinates (logical px) of a freely dragged taskbar player. */
export interface TaskbarFreePosition {
  x: number;
  y: number;
}

const TASKBAR_FREE_POSITION_LIMIT = 100_000;

export function normalizeTaskbarFreePosition(value: unknown): TaskbarFreePosition | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y } = value as Partial<TaskbarFreePosition>;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const clamp = (coordinate: number) => Math.max(
    -TASKBAR_FREE_POSITION_LIMIT,
    Math.min(TASKBAR_FREE_POSITION_LIMIT, Math.round(coordinate)),
  );
  return { x: clamp(x), y: clamp(y) };
}

export function normalizeTaskbarLeftOffset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(TASKBAR_PLAYER_MIN_LEFT_OFFSET, Math.min(TASKBAR_PLAYER_MAX_LEFT_OFFSET, Math.round(value))) : 0;
}

export function normalizeTaskbarTextColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase() : TASKBAR_PLAYER_DEFAULT_TEXT_COLOR;
}
export function normalizeTaskbarWidth(value: unknown, maxWidth = TASKBAR_PLAYER_MAX_WIDTH): number {
  const upper = Number.isFinite(maxWidth) && maxWidth >= TASKBAR_PLAYER_MIN_WIDTH
    ? Math.floor(maxWidth) : TASKBAR_PLAYER_MAX_WIDTH;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(upper, Math.max(TASKBAR_PLAYER_MIN_WIDTH, Math.round(value)))
    : TASKBAR_PLAYER_WINDOW_WIDTH;
}
export const TASKBAR_PLAYER_WINDOW_HEIGHT = 44;
/** 展开式播放队列面板的高度（逻辑像素），窗口向上生长以保持播控条位置不变。 */
export const TASKBAR_PLAYER_PANEL_HEIGHT = 320;
export const TASKBAR_PLAYER_WINDOW_MAX_HEIGHT = TASKBAR_PLAYER_WINDOW_HEIGHT + TASKBAR_PLAYER_PANEL_HEIGHT;

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
  /** 0-100，跟随主窗口音量，用于播控条的音量面板。 */
  volume?: number;
}

export interface TaskbarPlayerStatePayload extends TaskbarPlayerPlaybackPayload {
  currentSong: Song | null;
  coverUrl: string;
  isDarkTheme: boolean;
  backgroundOpacity?: number;
  backgroundMode?: TaskbarBackgroundMode;
  frameShape?: TaskbarFrameShape;
  alwaysOnTop?: boolean;
  backgroundColor?: string;
  textColor?: string;
  contentMode?: TaskbarContentMode;
  lyricEffect?: TaskbarLyricEffect;
  lyricHighlightColor?: string | null;
  translationKaraoke?: boolean;
  coverShape?: TaskbarCoverShape;
  coverRotate?: boolean;
  canDrag?: boolean;
  doubleClickToPause?: boolean;
  parsedLyrics: LyricLine[];
  lyricsStatus: LyricsStatus;
}

export interface TaskbarPlayerQueuePayload {
  paths: string[];
  currentPath: string | null;
}

export interface TaskbarPlayerPanelPayload {
  open: boolean;
}

export interface TaskbarPlayerDragPayload {
  dragging: boolean;
  leftOffset?: number;
  position?: TaskbarFreePosition;
}

export type TaskbarPlayerAction =
  | { type: 'toggle-main-window' }
  | { type: 'toggle-position-lock' }
  | { type: 'set-volume'; volume: number }
  | { type: 'toggle-mute' }
  | { type: 'set-queue-panel'; open: boolean }
  | { type: 'close-queue' }
  | { type: 'play-queue-path'; path: string }
  | { type: 'seek-lyric'; time: number }
  | { type: 'seek-play-lyric'; time: number }
  | { type: 'toggle-play' }
  | { type: 'prev-song' }
  | { type: 'next-song' }
  | { type: 'set-width'; width: number; anchor: 'left' | 'right' }
  | { type: 'set-left-offset'; offset: number }
  | { type: 'align-left' }
  | { type: 'close' };
