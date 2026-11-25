import { emitTo } from '@tauri-apps/api/event';
import type { SongSwitchDirection } from './upcoming';
import {
  SONG_NOTIFICATION_SWITCH_EVENT,
  type SongNotificationModule,
  type SongNotificationSwitchPayload,
} from './shared';

/**
 * 铃动窗 / 桌面歌词 / 托盘菜单都是独立 webview，播控状态由主窗口持有。
 * 这些按钮把「悬停预览 / 离开 / 点击切歌」意图转发给主窗口，由切歌提示桥接层
 * 统一按设置里的模块开关过滤后再驱动提示卡。
 */
export function emitSongSwitchSignal(
  module: SongNotificationModule,
  phase: SongNotificationSwitchPayload['phase'],
  direction: SongSwitchDirection,
) {
  const payload: SongNotificationSwitchPayload = { module, phase, direction };
  void emitTo('main', SONG_NOTIFICATION_SWITCH_EVENT, payload);
}
