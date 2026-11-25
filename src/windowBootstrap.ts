import type { Component } from 'vue';

import {
  DESKTOP_LYRICS_WINDOW_LABEL,
  MAIN_WINDOW_LABEL,
  SONG_NOTIFICATION_WINDOW_LABEL,
  TASKBAR_PLAYER_WINDOW_LABEL,
  TRAY_MENU_WINDOW_LABEL,
} from './windowLabels';

export type WindowKind =
  | 'main'
  | 'desktop-lyrics'
  | 'tray-menu'
  | 'song-notification'
  | 'taskbar-player';

type WindowRootModule = { default: Component };
type WindowRootLoader = () => Promise<WindowRootModule>;

const windowRootLoaders: Record<WindowKind, WindowRootLoader> = {
  main: () => import('./components/window/MainWindowRoot.vue'),
  'desktop-lyrics': () => import('./components/window/DesktopLyricsWindowRoot.vue'),
  'tray-menu': () => import('./components/layout/TrayMenuWindow.vue'),
  'taskbar-player': () => import('./components/layout/TaskbarControlWindow.vue'),
  'song-notification': () => import('./components/window/SongNotificationWindow.vue'),
};

export function resolveWindowKind(windowLabel: string | null | undefined): WindowKind {
  switch (windowLabel) {
    case DESKTOP_LYRICS_WINDOW_LABEL:
      return 'desktop-lyrics';
    case TRAY_MENU_WINDOW_LABEL:
      return 'tray-menu';
    case TASKBAR_PLAYER_WINDOW_LABEL:
      return 'taskbar-player';
    case SONG_NOTIFICATION_WINDOW_LABEL:
      return 'song-notification';
    case MAIN_WINDOW_LABEL:
    default:
      return 'main';
  }
}

export function loadWindowRoot(windowKind: WindowKind) {
  return windowRootLoaders[windowKind]();
}

export const windowUsesRouter = (windowKind: WindowKind) => windowKind === 'main';

export const windowUsesPinia = (windowKind: WindowKind) =>
  windowKind === 'main' || windowKind === 'desktop-lyrics';
