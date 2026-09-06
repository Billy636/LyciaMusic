import type { Song } from '../../types';

export { MINI_PLAYER_WINDOW_LABEL } from '../../windowLabels';
export const MINI_PLAYER_STATE_EVENT = 'mini-player:state';
export const MINI_PLAYER_STATE_APPLIED_EVENT = 'mini-player:state-applied';
export const MINI_PLAYER_ACTION_EVENT = 'mini-player:action';
export const MINI_PLAYER_REQUEST_STATE_EVENT = 'mini-player:request-state';
export const MINI_PLAYER_READY_EVENT = 'mini-player:ready';
export const MINI_PLAYER_VISIBILITY_EVENT = 'mini-player:visibility';
export const MINI_PLAYER_BOUNDS_EVENT = 'mini-player:bounds';
export const MINI_PLAYER_BOUNDS_KEY = 'mini_player_window_bounds';
export const APP_SHOW_MAIN_EVENT = 'app:show-main';

export const MINI_PLAYER_WINDOW_WIDTH = 300;
export const MINI_PLAYER_WINDOW_BASE_HEIGHT = 75;
export const MINI_PLAYER_WINDOW_EXPANDED_HEIGHT = 420;
export const MINI_PLAYER_WINDOW_VOLUME_HEIGHT = 135;

export interface MiniPlayerWindowBounds {
  x: number;
  y: number;
}

export interface MiniPlayerStatePayload {
  currentSong: Song | null;
  coverUrl: string;
  isPlaying: boolean;
  isDarkTheme: boolean;
  volume: number;
  queuePaths: string[];
  lyricText: string;
}

export type MiniPlayerAction =
  | { type: 'toggle-play' }
  | { type: 'prev-song' }
  | { type: 'next-song' }
  | { type: 'set-volume'; volume: number }
  | { type: 'toggle-mute' }
  | { type: 'play-song'; path: string }
  | { type: 'close' }
  | { type: 'restore-main' };
