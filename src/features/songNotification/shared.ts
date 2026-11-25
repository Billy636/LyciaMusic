export { SONG_NOTIFICATION_WINDOW_LABEL } from '../../windowLabels';

export const SONG_NOTIFICATION_STATE_EVENT = 'song-notification:state';
export const SONG_NOTIFICATION_READY_EVENT = 'song-notification:ready';
export const SONG_NOTIFICATION_PRESENTED_EVENT = 'song-notification:presented';
export const SONG_NOTIFICATION_DISMISSED_EVENT = 'song-notification:dismissed';

// 原尺寸 360×112，整体缩小 1/4：长 270，宽按同样比例 84。
export const SONG_NOTIFICATION_WINDOW_WIDTH = 270;
export const SONG_NOTIFICATION_WINDOW_HEIGHT = 84;
export const SONG_NOTIFICATION_DURATION_MS = 4000;

/** 自动播完时，上一首剩余多少秒开始出现提示并逐渐加深。 */
export const SONG_NOTIFICATION_AUTO_RAMP_SECONDS = 1.5;
/** 确认切歌后完全不透明的保持时长。 */
export const SONG_NOTIFICATION_HOLD_MS = 500;
/** 手动 hover 切歌按钮时的预览不透明度。 */
export const SONG_NOTIFICATION_PREVIEW_OPACITY = 0.6;
/** 自动播完预告的起始不透明度。 */
export const SONG_NOTIFICATION_AUTO_START_OPACITY = 0.3;

export type SongNotificationFrameShape = 'rounded' | 'pill' | 'square';
export type SongNotificationBackgroundMode = 'live' | 'color';
export type SongNotificationRevealMode = 'preview' | 'auto' | 'confirmed';

/** 会触发切歌提示的播放按钮所在模块。 */
export type SongNotificationModule = 'main' | 'taskbar' | 'desktopLyrics' | 'tray';
export type SongNotificationModuleSettings = Record<SongNotificationModule, boolean>;

export const SONG_NOTIFICATION_MODULE_KEYS: readonly SongNotificationModule[] = [
  'main', 'taskbar', 'desktopLyrics', 'tray',
];

export const SONG_NOTIFICATION_DEFAULT_MODULES: SongNotificationModuleSettings = {
  main: true,
  taskbar: true,
  desktopLyrics: true,
  tray: true,
};

/** 旧配置缺字段时按「默认全开」补齐，避免升级后某模块静默失效。 */
export function normalizeSongNotificationModules(value: unknown): SongNotificationModuleSettings {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<Record<SongNotificationModule, unknown>>;
  return {
    main: source.main !== false,
    taskbar: source.taskbar !== false,
    desktopLyrics: source.desktopLyrics !== false,
    tray: source.tray !== false,
  };
}

/** 独立 webview（铃动窗/桌面歌词/托盘菜单）把切歌意图转发给主窗口。 */
export const SONG_NOTIFICATION_SWITCH_EVENT = 'song-notification:switch';
export interface SongNotificationSwitchPayload {
  module: SongNotificationModule;
  phase: 'hover' | 'leave' | 'commit';
  direction: 'next' | 'previous';
}

export const SONG_NOTIFICATION_DEFAULT_FRAME_SHAPE: SongNotificationFrameShape = 'rounded';
export const SONG_NOTIFICATION_DEFAULT_BACKGROUND_MODE: SongNotificationBackgroundMode = 'live';
// 与设置面板色板中的「经典红」一致。
export const SONG_NOTIFICATION_DEFAULT_BACKGROUND_COLOR = '#ec4141';

export function normalizeSongNotificationFrameShape(value: unknown): SongNotificationFrameShape {
  return value === 'pill' || value === 'square' ? value : SONG_NOTIFICATION_DEFAULT_FRAME_SHAPE;
}

export function normalizeSongNotificationBackgroundMode(value: unknown): SongNotificationBackgroundMode {
  return value === 'color' ? 'color' : SONG_NOTIFICATION_DEFAULT_BACKGROUND_MODE;
}

export function normalizeSongNotificationBackgroundColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase() : SONG_NOTIFICATION_DEFAULT_BACKGROUND_COLOR;
}

export interface SongNotificationReveal {
  mode: SongNotificationRevealMode;
  /** 当前阶段开始时间（Date.now()），用于跨窗口计算不透明度与保持时长。 */
  startedAt: number;
}

export interface SongNotificationStatePayload {
  id: number;
  title: string;
  artist: string;
  coverUrl: string;
  isDarkTheme: boolean;
  expiresAt: number;
  reveal: SongNotificationReveal;
  frameShape: SongNotificationFrameShape;
  backgroundMode: SongNotificationBackgroundMode;
  backgroundColor: string;
}

export interface SongNotificationIdPayload {
  id: number;
}
