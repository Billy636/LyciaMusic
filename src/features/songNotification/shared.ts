export { SONG_NOTIFICATION_WINDOW_LABEL } from '../../windowLabels';

export const SONG_NOTIFICATION_STATE_EVENT = 'song-notification:state';
export const SONG_NOTIFICATION_READY_EVENT = 'song-notification:ready';
export const SONG_NOTIFICATION_PRESENTED_EVENT = 'song-notification:presented';
export const SONG_NOTIFICATION_DISMISSED_EVENT = 'song-notification:dismissed';

export const SONG_NOTIFICATION_WINDOW_WIDTH = 360;
export const SONG_NOTIFICATION_WINDOW_HEIGHT = 112;
export const SONG_NOTIFICATION_DURATION_MS = 4000;

export interface SongNotificationStatePayload {
  id: number;
  title: string;
  artist: string;
  coverUrl: string;
  isDarkTheme: boolean;
  expiresAt: number;
}

export interface SongNotificationIdPayload {
  id: number;
}
