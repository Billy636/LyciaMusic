import type { Component } from 'vue';

import {
  DESKTOP_LYRICS_WINDOW_LABEL,
  MAIN_WINDOW_LABEL,
  MINI_PLAYER_WINDOW_LABEL,
  TASKBAR_PLAYER_WINDOW_LABEL,
  TRAY_MENU_WINDOW_LABEL,
} from './windowLabels';

export type WindowKind =
  | 'main'
  | 'desktop-lyrics'
  | 'mini-player'
  | 'tray-menu'
  | 'taskbar-player';

type WindowRootModule = { default: Component };
type WindowRootLoader = () => Promise<WindowRootModule>;

const windowRootLoaders: Record<WindowKind, WindowRootLoader> = {
  main: () => import('./components/window/MainWindowRoot.vue'),
  'desktop-lyrics': () => import('./components/window/DesktopLyricsWindowRoot.vue'),
  'mini-player': () => import('./components/layout/MiniPlayerWindow.vue'),
  'tray-menu': () => import('./components/layout/TrayMenuWindow.vue'),
  'taskbar-player': () => import('./components/layout/TaskbarControlWindow.vue'),
};

export function resolveWindowKind(windowLabel: string | null | undefined): WindowKind {
  switch (windowLabel) {
    case DESKTOP_LYRICS_WINDOW_LABEL:
      return 'desktop-lyrics';
    case MINI_PLAYER_WINDOW_LABEL:
      return 'mini-player';
    case TRAY_MENU_WINDOW_LABEL:
      return 'tray-menu';
    case TASKBAR_PLAYER_WINDOW_LABEL:
      return 'taskbar-player';
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
