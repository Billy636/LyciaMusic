import { ref } from 'vue';
import type { SongSwitchDirection } from './upcoming';
import {
  SONG_NOTIFICATION_DEFAULT_MODULES,
  normalizeSongNotificationModules,
  type SongNotificationModule,
  type SongNotificationModuleSettings,
} from './shared';

/**
 * 各模块「上一首 / 下一首」按钮的交互信号。
 * 提示窗是独立 webview，所以用模块级响应式状态在桥接层与按钮之间传递。
 */
export const songSwitchHovered = ref(false);
export const songSwitchDirection = ref<SongSwitchDirection>('next');

// 由主窗口桥接层根据设置同步；独立 webview 不直接读设置，避免状态漂移。
let enabledModules: SongNotificationModuleSettings = { ...SONG_NOTIFICATION_DEFAULT_MODULES };
let manualCommitGeneration = 0;
let hoverGeneration = 0;
let commitTimeout: ReturnType<typeof setTimeout> | null = null;
// 最近一次手动切歌来自哪个模块；null 表示自动播完 / 队列点歌等非按钮触发。
let commitOriginModule: SongNotificationModule | null = null;
// 记录当前 hover 来源，避免别的模块的 leave 事件误清掉预览。
let hoverOriginModule: SongNotificationModule | null = null;

export function setSongNotificationModules(value: unknown) {
  enabledModules = normalizeSongNotificationModules(value);
  // 关闭某模块接入时，若它正持有预览，立刻收起，避免卡片滞留。
  if (songSwitchHovered.value && hoverOriginModule && !enabledModules[hoverOriginModule]) {
    hoverOriginModule = null;
    songSwitchHovered.value = false;
    hoverGeneration += 1;
  }
}

export function isSongNotificationModuleEnabled(module: SongNotificationModule): boolean {
  return enabledModules[module] !== false;
}

/** 用户确实点击了切歌按钮，下一次歌曲变更应按「手动切歌」呈现。 */
export function markManualSongSwitch(
  direction: SongSwitchDirection,
  module: SongNotificationModule = 'main',
) {
  manualCommitGeneration += 1;
  commitOriginModule = module;
  songSwitchDirection.value = direction;
  if (commitTimeout !== null) clearTimeout(commitTimeout);
  // 切歌失败时不要让这个标记一直卡住后续的预览关闭逻辑。
  commitTimeout = setTimeout(() => {
    commitTimeout = null;
    manualCommitGeneration = 0;
    commitOriginModule = null;
  }, 4000);
}

export function isManualSongSwitchPending(): boolean {
  return manualCommitGeneration > 0;
}

/** 返回最近一次手动切歌的模块；null 表示这次切歌不是按钮触发的。 */
export function consumeManualSongSwitch(): SongNotificationModule | null {
  if (manualCommitGeneration === 0) return null;
  manualCommitGeneration = 0;
  const module = commitOriginModule;
  commitOriginModule = null;
  if (commitTimeout !== null) clearTimeout(commitTimeout);
  commitTimeout = null;
  return module ?? 'main';
}

export function setSongSwitchHovered(
  active: boolean,
  direction: SongSwitchDirection = 'next',
  module: SongNotificationModule = 'main',
) {
  // 关闭接入的模块不产生新预览；离开事件仍放行，保证残留的 hover 能被清掉。
  if (active && !isSongNotificationModuleEnabled(module)) return;
  if (!active && hoverOriginModule && hoverOriginModule !== module) return;

  if (active) {
    hoverOriginModule = module;
    songSwitchDirection.value = direction;
  } else {
    hoverOriginModule = null;
  }
  if (songSwitchHovered.value === active && songSwitchDirection.value === direction) return;
  songSwitchHovered.value = active;
  hoverGeneration += 1;
}

/** 点击切歌按钮：先收起该模块的悬停预览，再打上手动切歌标记。 */
export function commitSongSwitch(
  direction: SongSwitchDirection,
  module: SongNotificationModule = 'main',
) {
  setSongSwitchHovered(false, direction, module);
  markManualSongSwitch(direction, module);
}

export function getSongSwitchHoverGeneration() {
  return hoverGeneration;
}
