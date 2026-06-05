import type { Song } from '../../types';

export const TASKBAR_PLAYER_WINDOW_LABEL = 'taskbar-player';
export const TASKBAR_PLAYER_STATE_EVENT = 'taskbar-player:state';
export const TASKBAR_PLAYER_STATE_APPLIED_EVENT = 'taskbar-player:state-applied';
export const TASKBAR_PLAYER_ACTION_EVENT = 'taskbar-player:action';
export const TASKBAR_PLAYER_REQUEST_STATE_EVENT = 'taskbar-player:request-state';
export const TASKBAR_PLAYER_READY_EVENT = 'taskbar-player:ready';
export const TASKBAR_PLAYER_VISIBILITY_EVENT = 'taskbar-player:visibility';
export const TASKBAR_PLAYER_DRAG_EVENT = 'taskbar-player:drag';
export const TASKBAR_PLAYER_POSITION_X_KEY = 'taskbar_player_window_position_x';

export const TASKBAR_PLAYER_WINDOW_WIDTH = 320;
export const TASKBAR_PLAYER_WINDOW_HEIGHT = 40;

export interface TaskbarPlayerStatePayload {
  currentSong: Song | null;
  coverUrl: string;
  isPlaying: boolean;
  isDarkTheme: boolean;
}

export type TaskbarPlayerAction =
  | { type: 'toggle-play' }
  | { type: 'prev-song' }
  | { type: 'next-song' }
  | { type: 'close' };
