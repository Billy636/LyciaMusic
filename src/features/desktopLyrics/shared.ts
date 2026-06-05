import type {
  DesktopLyricsSettings,
  ImportedLyricsFont,
  LyricsStatus,
  LyricLine,
} from '../../composables/lyrics';
import type { Song } from '../../types';

export const DESKTOP_LYRICS_WINDOW_LABEL = 'desktop-lyrics';
export const DESKTOP_LYRICS_STATE_EVENT = 'desktop-lyrics:state';
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
export const DESKTOP_LYRICS_WINDOW_EDGE_SNAP_THRESHOLD = 24;
export const DESKTOP_LYRICS_WINDOW_SCREEN_MARGIN = 12;

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

export interface DesktopLyricsWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopLyricsWindowSizeLimits {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getWorkAreaRight(workArea: DesktopLyricsWorkArea) {
  return workArea.x + workArea.width;
}

function getWorkAreaBottom(workArea: DesktopLyricsWorkArea) {
  return workArea.y + workArea.height;
}

function getIntersectionArea(bounds: DesktopLyricsWindowBounds, workArea: DesktopLyricsWorkArea) {
  const overlapWidth = Math.max(
    0,
    Math.min(bounds.x + bounds.width, getWorkAreaRight(workArea)) - Math.max(bounds.x, workArea.x),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(bounds.y + bounds.height, getWorkAreaBottom(workArea)) - Math.max(bounds.y, workArea.y),
  );

  return overlapWidth * overlapHeight;
}

export function getDesktopLyricsWindowSizeLimits(workArea: DesktopLyricsWorkArea): DesktopLyricsWindowSizeLimits {
  const maxWidth = Math.max(
    DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
    Math.min(
      DESKTOP_LYRICS_WINDOW_MAX_WIDTH,
      Math.max(DESKTOP_LYRICS_WINDOW_MIN_WIDTH, workArea.width - DESKTOP_LYRICS_WINDOW_SCREEN_MARGIN * 2),
    ),
  );
  const maxHeight = Math.max(
    DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
    Math.max(DESKTOP_LYRICS_WINDOW_MIN_HEIGHT, workArea.height - DESKTOP_LYRICS_WINDOW_SCREEN_MARGIN * 2),
  );

  return {
    minWidth: Math.min(DESKTOP_LYRICS_WINDOW_MIN_WIDTH, maxWidth),
    minHeight: Math.min(DESKTOP_LYRICS_WINDOW_MIN_HEIGHT, maxHeight),
    maxWidth,
    maxHeight,
  };
}

export function resolveDesktopLyricsWorkArea(
  workAreas: DesktopLyricsWorkArea[],
  bounds: DesktopLyricsWindowBounds,
): DesktopLyricsWorkArea | null {
  if (workAreas.length === 0) return null;

  const boundsCenterX = bounds.x + bounds.width / 2;
  const boundsCenterY = bounds.y + bounds.height / 2;

  let bestArea = workAreas[0];
  let bestIntersection = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const workArea of workAreas) {
    const intersection = getIntersectionArea(bounds, workArea);
    const workAreaCenterX = workArea.x + workArea.width / 2;
    const workAreaCenterY = workArea.y + workArea.height / 2;
    const distance = (workAreaCenterX - boundsCenterX) ** 2 + (workAreaCenterY - boundsCenterY) ** 2;

    if (intersection > bestIntersection || (intersection === bestIntersection && distance < bestDistance)) {
      bestArea = workArea;
      bestIntersection = intersection;
      bestDistance = distance;
    }
  }

  return bestArea;
}

export function normalizeDesktopLyricsBounds(
  bounds: DesktopLyricsWindowBounds,
  workAreas: DesktopLyricsWorkArea[],
): DesktopLyricsWindowBounds | null {
  const workArea = resolveDesktopLyricsWorkArea(workAreas, bounds);
  if (!workArea) return null;

  const limits = getDesktopLyricsWindowSizeLimits(workArea);
  const width = clamp(bounds.width, limits.minWidth, limits.maxWidth);
  const height = clamp(bounds.height, limits.minHeight, limits.maxHeight);
  const maxX = workArea.x + Math.max(0, workArea.width - width);
  const maxY = workArea.y + Math.max(0, workArea.height - height);

  return {
    x: clamp(bounds.x, workArea.x, maxX),
    y: clamp(bounds.y, workArea.y, maxY),
    width,
    height,
  };
}

export function restoreDesktopLyricsBounds(
  bounds: DesktopLyricsWindowBounds,
  workAreas: DesktopLyricsWorkArea[],
): DesktopLyricsWindowBounds | null {
  const workArea = resolveDesktopLyricsWorkArea(workAreas, bounds);
  if (!workArea) return null;

  const limits = getDesktopLyricsWindowSizeLimits(workArea);
  const width = clamp(bounds.width, limits.minWidth, limits.maxWidth);
  const height = clamp(bounds.height, limits.minHeight, limits.maxHeight);
  const restoredBounds = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width,
    height,
  };

  const hasVisibleIntersection = workAreas.some((candidate) => getIntersectionArea(restoredBounds, candidate) > 0);
  if (hasVisibleIntersection) {
    return restoredBounds;
  }

  const maxX = workArea.x + Math.max(0, workArea.width - width);
  const maxY = workArea.y + Math.max(0, workArea.height - height);

  return {
    x: clamp(bounds.x, workArea.x, maxX),
    y: clamp(bounds.y, workArea.y, maxY),
    width,
    height,
  };
}

export function snapDesktopLyricsBounds(
  bounds: DesktopLyricsWindowBounds,
  workAreas: DesktopLyricsWorkArea[],
  threshold = DESKTOP_LYRICS_WINDOW_EDGE_SNAP_THRESHOLD,
): DesktopLyricsWindowBounds | null {
  const normalizedBounds = normalizeDesktopLyricsBounds(bounds, workAreas);
  if (!normalizedBounds) return null;

  const workArea = resolveDesktopLyricsWorkArea(workAreas, normalizedBounds);
  if (!workArea) return normalizedBounds;

  const nextBounds = { ...normalizedBounds };
  const rightEdge = getWorkAreaRight(workArea);
  const bottomEdge = getWorkAreaBottom(workArea);

  if (Math.abs(nextBounds.x - workArea.x) <= threshold) {
    nextBounds.x = workArea.x;
  }
  if (Math.abs(nextBounds.y - workArea.y) <= threshold) {
    nextBounds.y = workArea.y;
  }
  if (Math.abs((nextBounds.x + nextBounds.width) - rightEdge) <= threshold) {
    nextBounds.x = rightEdge - nextBounds.width;
  }
  if (Math.abs((nextBounds.y + nextBounds.height) - bottomEdge) <= threshold) {
    nextBounds.y = bottomEdge - nextBounds.height;
  }

  return nextBounds;
}
