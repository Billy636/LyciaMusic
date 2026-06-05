import type { Ref } from 'vue';
import type { Song } from '../../types';

export const APP_TRAY_MENU_EVENT = 'app:tray-menu';
export const APP_TRAY_MENU_OPEN_EVENT = 'app:tray-menu-open';
export const TRAY_MENU_WINDOW_LABEL = 'tray-menu';
export const TRAY_MENU_STATE_EVENT = 'tray-menu:state';
export const TRAY_MENU_READY_EVENT = 'tray-menu:ready';
export const TRAY_MENU_PANEL_WIDTH = 190;
export const TRAY_MENU_SUBMENU_WIDTH = 132;
export const TRAY_MENU_SUBMENU_GAP = 8;
export const TRAY_MENU_WINDOW_WIDTH = TRAY_MENU_PANEL_WIDTH + TRAY_MENU_SUBMENU_WIDTH + TRAY_MENU_SUBMENU_GAP;
export const TRAY_MENU_WINDOW_HEIGHT = 276;

export type TrayMenuSubmenuPlacement = 'left' | 'right';

export type TrayMenuAction =
  | 'prev-song'
  | 'toggle-play'
  | 'next-song'
  | 'play-mode-list-loop'
  | 'play-mode-single-loop'
  | 'play-mode-shuffle'
  | 'show-mini-player'
  | 'open-desktop-lyrics'
  | 'open-settings'
  | 'quit';

export interface TrayMenuOpenPayload {
  x: number;
  y: number;
}

export interface TrayMenuStatePayload {
  currentSong: Song | null;
  isPlaying: boolean;
  isDarkTheme: boolean;
  playMode: number;
  showDesktopLyrics: boolean;
  submenuPlacement: TrayMenuSubmenuPlacement;
}

export interface TrayMenuActionDeps {
  prevSong: () => void;
  togglePlay: () => void | Promise<unknown>;
  nextSong: () => void;
  playMode: Ref<number>;
  isMiniMode: Ref<boolean>;
  showDesktopLyrics: Ref<boolean>;
  revealMainWindow: () => Promise<unknown>;
  openSettings: () => Promise<unknown>;
  quitApp: () => Promise<unknown>;
}

export async function handleTrayMenuAction(action: TrayMenuAction, deps: TrayMenuActionDeps) {
  switch (action) {
    case 'prev-song':
      deps.prevSong();
      break;
    case 'toggle-play':
      await deps.togglePlay();
      break;
    case 'next-song':
      deps.nextSong();
      break;
    case 'play-mode-list-loop':
      deps.playMode.value = 0;
      break;
    case 'play-mode-single-loop':
      deps.playMode.value = 1;
      break;
    case 'play-mode-shuffle':
      deps.playMode.value = 2;
      break;
    case 'show-mini-player':
      deps.isMiniMode.value = true;
      break;
    case 'open-desktop-lyrics':
      deps.showDesktopLyrics.value = true;
      break;
    case 'open-settings':
      deps.isMiniMode.value = false;
      await deps.openSettings();
      await deps.revealMainWindow();
      break;
    case 'quit':
      await deps.quitApp();
      break;
    default:
      break;
  }
}
