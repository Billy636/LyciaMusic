import type { Song } from '../../types';

export { TASKBAR_PLAYER_WINDOW_LABEL } from '../../windowLabels';
export const TASKBAR_PLAYER_STATE_EVENT = 'taskbar-player:state';
export const TASKBAR_PLAYER_STATE_APPLIED_EVENT = 'taskbar-player:state-applied';
export const TASKBAR_PLAYER_ACTION_EVENT = 'taskbar-player:action';
export const TASKBAR_PLAYER_REQUEST_STATE_EVENT = 'taskbar-player:request-state';
export const TASKBAR_PLAYER_READY_EVENT = 'taskbar-player:ready';
export const TASKBAR_PLAYER_VISIBILITY_EVENT = 'taskbar-player:visibility';
export const TASKBAR_PLAYER_DRAG_EVENT = 'taskbar-player:drag';
export const TASKBAR_PLAYER_POSITION_X_KEY = 'taskbar_player_window_position_x';

export const TASKBAR_PLAYER_WINDOW_WIDTH = 280;
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

export interface TaskbarPlayerStatePayload {
  currentSong: Song | null;
  coverUrl: string;
  isPlaying: boolean;
  isDarkTheme: boolean;
}

export type TaskbarPlayerAction =
  | { type: 'toggle-main-window' }
  | { type: 'toggle-play' }
  | { type: 'prev-song' }
  | { type: 'next-song' }
  | { type: 'close' };
