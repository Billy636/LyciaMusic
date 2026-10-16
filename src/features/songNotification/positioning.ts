import type { Monitor } from '@tauri-apps/api/window';
import { SONG_NOTIFICATION_WINDOW_HEIGHT, SONG_NOTIFICATION_WINDOW_WIDTH } from './shared';

export function resolveSongNotificationBounds(monitor: Pick<Monitor, 'workArea' | 'scaleFactor'>) {
  const { position, size } = monitor.workArea;
  const scale = monitor.scaleFactor;
  if (![position.x, position.y, size.width, size.height, scale].every(Number.isFinite)
    || size.width < 1 || size.height < 1 || scale <= 0) return null;

  const margin = Math.max(0, Math.min(
    Math.round(8 * scale),
    Math.floor((size.width - 1) / 2),
    Math.floor((size.height - 1) / 2),
  ));
  const width = Math.max(1, Math.min(Math.round(SONG_NOTIFICATION_WINDOW_WIDTH * scale), size.width - margin * 2));
  const height = Math.max(1, Math.min(Math.round(SONG_NOTIFICATION_WINDOW_HEIGHT * scale), size.height - margin * 2));
  return {
    x: Math.round(position.x + size.width - width - margin),
    y: Math.round(position.y + size.height - height - margin),
    width,
    height,
    scale,
  };
}
