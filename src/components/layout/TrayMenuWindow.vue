<script setup lang="ts">
import {
  Check,
  ChevronRight,
  Music2,
  PanelBottom,
  Pause,
  Play,
  Power,
  Repeat,
  Repeat1,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-vue-next';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emitSongSwitchSignal } from '../../features/songNotification/switchSignal';
import { computed, nextTick, onMounted, onUnmounted, ref, type Component } from 'vue';

import {
  APP_TRAY_MENU_EVENT,
  formatTraySongLabel,
  TRAY_MENU_PANEL_WIDTH,
  TRAY_MENU_PING_EVENT,
  TRAY_MENU_READY_EVENT,
  TRAY_MENU_STATE_EVENT,
  TRAY_MENU_SUBMENU_GAP,
  TRAY_MENU_WINDOW_HEIGHT,
  TRAY_MENU_WINDOW_WIDTH,
  type TrayMenuAction,
  type TrayMenuStatePayload,
} from '../../features/tray/actions';
import type { Song } from '../../types';

const appWindow = getCurrentWindow();
const currentSong = ref<Song | null>(null);
const isPlaying = ref(false);
const isDarkTheme = ref(true);
const playMode = ref(0);
const showDesktopLyrics = ref(false);
const showTaskbarPlayer = ref(false);
const isPlayModeMenuOpen = ref(false);
const playModeTrigger = ref<HTMLButtonElement | null>(null);
const playModePopover = ref<HTMLElement | null>(null);
const submenuPlacement = ref<'left' | 'right'>('left');
let unlistenState: UnlistenFn | null = null;
let unlistenFocus: UnlistenFn | null = null;
let unlistenCloseRequested: UnlistenFn | null = null;
let unlistenPing: UnlistenFn | null = null;

// 尺寸常量单一来源：由 features/tray/actions.ts 注入，定位逻辑使用同一组数值
const shellStyleVars: Record<string, string> = {
  '--tray-shell-width': `${TRAY_MENU_WINDOW_WIDTH}px`,
  '--tray-shell-height': `${TRAY_MENU_WINDOW_HEIGHT}px`,
  '--tray-panel-width': `${TRAY_MENU_PANEL_WIDTH}px`,
  '--tray-submenu-gap': `${TRAY_MENU_SUBMENU_GAP}px`,
};

// 托盘右键后系统可能拒绝本窗口抢占前台，导致收不到失焦事件；
// 超时仍未获得焦点且鼠标不在菜单上时自动隐藏，避免菜单残留屏幕
const FOCUS_FALLBACK_DELAY_MS = 1500;
let focusFallbackTimer: number | null = null;
let isPointerInsideShell = false;

const markShellPointerInside = (inside: boolean) => {
  isPointerInsideShell = inside;
};

const clearFocusFallbackTimer = () => {
  if (focusFallbackTimer !== null) {
    window.clearTimeout(focusFallbackTimer);
    focusFallbackTimer = null;
  }
};

const armFocusFallback = () => {
  clearFocusFallbackTimer();
  focusFallbackTimer = window.setTimeout(() => {
    focusFallbackTimer = null;
    void (async () => {
      try {
        if (!(await appWindow.isVisible())) return;
        if (await appWindow.isFocused()) return;
        if (isPointerInsideShell) {
          armFocusFallback();
          return;
        }
        await appWindow.hide();
      } catch {
        // 窗口可能已销毁，忽略
      }
    })();
  }, FOCUS_FALLBACK_DELAY_MS);
};

const trackLabel = computed(() => formatTraySongLabel(currentSong.value) || 'Lycia Player');

const playModeConfig = computed(() => {
  switch (playMode.value) {
    case 1:
      return {
        label: '单曲循环',
        icon: Repeat1,
      };
    case 2:
      return {
        label: '随机播放',
        icon: Shuffle,
      };
    default:
      return {
        label: '列表循环',
        icon: Repeat,
      };
  }
});

const playModeOptions: Array<{
  label: string;
  value: number;
  action: TrayMenuAction;
  icon: Component;
}> = [
  {
    label: '列表循环',
    value: 0,
    action: 'play-mode-list-loop',
    icon: Repeat,
  },
  {
    label: '单曲循环',
    value: 1,
    action: 'play-mode-single-loop',
    icon: Repeat1,
  },
  {
    label: '随机播放',
    value: 2,
    action: 'play-mode-shuffle',
    icon: Shuffle,
  },
];

const sendAction = async (action: TrayMenuAction, options: { hide?: boolean } = {}) => {
  await emitTo('main', APP_TRAY_MENU_EVENT, action);
  if (options.hide !== false) {
    await appWindow.hide();
  }
};

const openPlayModeMenu = () => {
  isPlayModeMenuOpen.value = true;
};

const closePlayModeMenu = () => {
  isPlayModeMenuOpen.value = false;
};

const focusPlayModeMenu = async () => {
  openPlayModeMenu();
  await nextTick();
  const selectedIndex = playModeOptions.findIndex(option => option.value === playMode.value);
  playModePopover.value?.querySelectorAll<HTMLButtonElement>('button')[Math.max(0, selectedIndex)]?.focus();
};

const closePlayModeMenuAndFocus = () => {
  playModeTrigger.value?.focus();
  closePlayModeMenu();
};

const handlePlayModeKeydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    closePlayModeMenuAndFocus();
    return;
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  const buttons = Array.from(playModePopover.value?.querySelectorAll<HTMLButtonElement>('button') ?? []);
  if (!buttons.length) return;
  const currentIndex = buttons.findIndex(button => button === document.activeElement);
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  buttons[(currentIndex + direction + buttons.length) % buttons.length]?.focus();
};

const hideWindow = () => {
  void appWindow.hide();
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (isPlayModeMenuOpen.value) {
      closePlayModeMenuAndFocus();
    } else {
      hideWindow();
    }
  }
};

onMounted(async () => {
  try {
    await appWindow.setBackgroundColor([0, 0, 0, 0]);
  } catch (error) {
    console.warn('Failed to force transparent background for tray menu window:', error);
  }

  await appWindow.setAlwaysOnTop(true);
  window.addEventListener('keydown', handleKeydown);

  unlistenState = await listen<TrayMenuStatePayload>(TRAY_MENU_STATE_EVENT, (event) => {
    currentSong.value = event.payload.currentSong;
    isPlaying.value = event.payload.isPlaying;
    isDarkTheme.value = event.payload.isDarkTheme;
    playMode.value = event.payload.playMode;
    showDesktopLyrics.value = event.payload.showDesktopLyrics;
    showTaskbarPlayer.value = event.payload.showTaskbarPlayer;
    submenuPlacement.value = event.payload.submenuPlacement;
    isPlayModeMenuOpen.value = false;
    armFocusFallback();
  });

  unlistenFocus = await appWindow.onFocusChanged((event) => {
    if (event.payload) {
      // 已获得焦点，走常规的失焦隐藏路径，无需兜底
      clearFocusFallbackTimer();
      return;
    }
    hideWindow();
  });

  unlistenCloseRequested = await appWindow.onCloseRequested((event) => {
    event.preventDefault();
    hideWindow();
  });

  // 主窗口刷新后不会重建本窗口，收到 ping 时重发 READY 以恢复 ready 标记与状态同步
  unlistenPing = await listen(TRAY_MENU_PING_EVENT, () => {
    void emitTo('main', TRAY_MENU_READY_EVENT);
  });

  await emitTo('main', TRAY_MENU_READY_EVENT);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  clearFocusFallbackTimer();
  unlistenState?.();
  unlistenFocus?.();
  unlistenCloseRequested?.();
  unlistenPing?.();
});
</script>

<template>
  <div
    class="tray-menu-shell"
    :class="[
      { 'tray-menu-shell--light': !isDarkTheme },
      `tray-menu-shell--submenu-${submenuPlacement}`,
    ]"
    :style="shellStyleVars"
    @pointerenter="markShellPointerInside(true)"
    @pointerleave="markShellPointerInside(false)"
    @pointerdown.self="hideWindow"
  >
    <div class="tray-menu-panel">
      <section class="track-row">
        <Music2 class="track-icon" :size="18" :stroke-width="2.1" />
        <span class="track-title" :title="trackLabel">{{ trackLabel }}</span>
      </section>

      <div class="menu-divider" />

      <section class="transport" aria-label="播放控制" @mouseenter="closePlayModeMenu" @focusin="closePlayModeMenu">
        <button
          class="transport-button"
          title="上一首"
          @pointerenter="emitSongSwitchSignal('tray', 'hover', 'previous')"
          @pointerleave="emitSongSwitchSignal('tray', 'leave', 'previous')"
          @click="sendAction('prev-song', { hide: false })"
        >
          <SkipBack :size="22" :stroke-width="2.35" />
        </button>
        <button class="transport-button transport-button--play" title="播放/暂停" @click="sendAction('toggle-play', { hide: false })">
          <Pause v-if="isPlaying" :size="24" :stroke-width="2.5" />
          <Play v-else :size="24" :stroke-width="2.5" />
        </button>
        <button
          class="transport-button"
          title="下一首"
          @pointerenter="emitSongSwitchSignal('tray', 'hover', 'next')"
          @pointerleave="emitSongSwitchSignal('tray', 'leave', 'next')"
          @click="sendAction('next-song', { hide: false })"
        >
          <SkipForward :size="22" :stroke-width="2.35" />
        </button>
      </section>

      <div class="menu-divider" />

      <button
        ref="playModeTrigger"
        type="button"
        class="menu-row"
        :class="{ 'menu-row--open': isPlayModeMenuOpen }"
        aria-haspopup="menu"
        aria-controls="tray-play-mode-menu"
        :aria-expanded="isPlayModeMenuOpen"
        @mouseenter="openPlayModeMenu"
        @focus="openPlayModeMenu"
        @keydown.right.prevent="focusPlayModeMenu"
        @keydown.enter.prevent="focusPlayModeMenu"
        @keydown.space.prevent="focusPlayModeMenu"
      >
        <span class="row-icon">
          <component :is="playModeConfig.icon" :size="18" :stroke-width="2.15" />
        </span>
        <span class="row-label">{{ playModeConfig.label }}</span>
        <ChevronRight class="row-chevron" :size="18" :stroke-width="2.2" />
      </button>

      <div class="menu-divider" />

      <button class="menu-row" @mouseenter="closePlayModeMenu" @focus="closePlayModeMenu" @click="sendAction('toggle-desktop-lyrics')">
        <span class="row-icon row-icon--text">词</span>
        <span class="row-label">桌面歌词</span>
        <Check v-if="showDesktopLyrics" class="row-check" :size="16" :stroke-width="2.3" />
      </button>

      <button
        type="button"
        class="menu-row"
        :aria-pressed="showTaskbarPlayer"
        @mouseenter="closePlayModeMenu"
        @focus="closePlayModeMenu"
        @click="sendAction('toggle-taskbar-player')"
      >
        <span class="row-icon">
          <PanelBottom :size="18" :stroke-width="2.15" />
        </span>
        <span class="row-label">铃动窗</span>
        <Check v-if="showTaskbarPlayer" class="row-check" :size="16" :stroke-width="2.3" />
      </button>

      <div class="menu-divider" />

      <button class="menu-row" @mouseenter="closePlayModeMenu" @focus="closePlayModeMenu" @click="sendAction('open-settings')">
        <span class="row-icon">
          <Settings :size="18" :stroke-width="2.15" />
        </span>
        <span class="row-label">设置</span>
      </button>

      <div class="menu-divider" />

      <button class="menu-row" @mouseenter="closePlayModeMenu" @focus="closePlayModeMenu" @click="sendAction('quit')">
        <span class="row-icon">
          <Power :size="18" :stroke-width="2.15" />
        </span>
        <span class="row-label">退出</span>
      </button>
    </div>

    <div v-if="isPlayModeMenuOpen" id="tray-play-mode-menu" ref="playModePopover" class="play-mode-popover" role="menu" aria-label="播放模式" @keydown="handlePlayModeKeydown">
      <button
        v-for="option in playModeOptions"
        :key="option.action"
        type="button"
        role="menuitemradio"
        :aria-checked="playMode === option.value"
        class="play-mode-option"
        @click="sendAction(option.action)"
      >
        <component :is="option.icon" :size="17" :stroke-width="2.1" />
        <span>{{ option.label }}</span>
        <Check v-if="playMode === option.value" :size="16" :stroke-width="2.3" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.tray-menu-shell {
  --panel-bg: rgba(39, 40, 52, 0.98);
  --panel-border: rgba(255, 255, 255, 0.12);
  --text-main: rgba(241, 243, 249, 0.9);
  --text-muted: rgba(241, 243, 249, 0.68);
  --divider: rgba(255, 255, 255, 0.075);
  --hover-bg: rgba(255, 255, 255, 0.075);
  --panel-padding-y: 6px;
  --track-row-height: 30px;
  --transport-height: 36px;
  --menu-row-height: 30px;
  --divider-margin-y: 4px;
  /* 分隔线占位 = 上下 margin + 1px 线高，供子菜单 popover 垂直对齐使用 */
  --divider-span: calc(var(--divider-margin-y) * 2 + 1px);

  width: var(--tray-shell-width);
  height: var(--tray-shell-height);
  padding: 0;
  overflow: hidden;
  background: transparent;
  color: var(--text-main);
  font-family: Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  position: relative;
  user-select: none;
}

.tray-menu-shell--light {
  --panel-bg: rgba(248, 249, 252, 0.98);
  --panel-border: rgba(20, 24, 36, 0.12);
  --text-main: rgba(28, 31, 42, 0.9);
  --text-muted: rgba(28, 31, 42, 0.58);
  --divider: rgba(20, 24, 36, 0.095);
  --hover-bg: rgba(20, 24, 36, 0.065);
}

.tray-menu-panel {
  position: absolute;
  top: 0;
  display: flex;
  flex-direction: column;
  width: var(--tray-panel-width);
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  padding: var(--panel-padding-y) 0;
  border: 0;
  border-radius: 10px;
  background: var(--panel-bg);
  box-shadow: inset 0 0 0 1px var(--panel-border);
  backdrop-filter: blur(18px);
}

.tray-menu-shell--submenu-left .tray-menu-panel {
  right: 0;
}

.tray-menu-shell--submenu-right .tray-menu-panel {
  left: 0;
}

.track-row {
  display: flex;
  align-items: center;
  height: var(--track-row-height);
  gap: 9px;
  padding: 0 12px;
}

.track-icon {
  flex: 0 0 auto;
  color: var(--text-muted);
}

.track-title {
  min-width: 0;
  overflow: hidden;
  color: var(--text-main);
  font-size: 13.5px;
  font-weight: 480;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-divider {
  height: 1px;
  margin: var(--divider-margin-y) 12px;
  background: var(--divider);
}

.transport {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-items: center;
  height: var(--transport-height);
  padding: 0 12px;
}

.transport-button,
.menu-row {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: default;
}

.transport-button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 32px;
  border-radius: 7px;
}

.transport-button--play {
  color: var(--text-main);
}

.transport-button:hover,
.menu-row:hover {
  background: var(--hover-bg);
  color: var(--text-main);
}

.menu-row {
  display: flex;
  align-items: center;
  width: calc(100% - 12px);
  height: var(--menu-row-height);
  margin: 0 6px;
  gap: 9px;
  border-radius: 6px;
  padding: 0 7px;
  text-align: left;
}

.menu-row--open {
  background: var(--hover-bg);
  color: var(--text-main);
}

.menu-row:focus-visible {
  background: var(--hover-bg);
  color: var(--text-main);
  box-shadow: inset 0 0 0 1px var(--text-muted);
}

.row-icon {
  display: grid;
  place-items: center;
  width: 19px;
  height: 19px;
  flex: 0 0 auto;
  color: currentColor;
}

.row-icon--text {
  font-size: 15px;
  font-weight: 650;
  line-height: 1;
}

.row-label {
  min-width: 0;
  overflow: hidden;
  flex: 1;
  color: currentColor;
  font-size: 13.5px;
  font-weight: 480;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-chevron,
.row-check {
  flex: 0 0 auto;
  color: currentColor;
}

.play-mode-popover {
  position: absolute;
  /* 与播放模式行顶部对齐：面板上内边距 + 曲目行 + 分隔线 + 传输区 + 分隔线 */
  top: calc(
    var(--panel-padding-y) + var(--track-row-height) + var(--divider-span)
    + var(--transport-height) + var(--divider-span)
  );
  z-index: 5;
  width: 132px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--panel-bg);
  box-shadow: inset 0 0 0 1px var(--panel-border);
  padding: 4px 0;
}

.tray-menu-shell--submenu-left .play-mode-popover {
  right: calc(var(--tray-panel-width) + var(--tray-submenu-gap));
}

.tray-menu-shell--submenu-right .play-mode-popover {
  left: calc(var(--tray-panel-width) + var(--tray-submenu-gap));
}

.play-mode-option {
  display: grid;
  grid-template-columns: 18px 1fr 16px;
  align-items: center;
  width: calc(100% - 8px);
  height: 28px;
  margin: 0 4px;
  border-radius: 5px;
  gap: 7px;
  border: 0;
  padding: 0 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12.5px;
  text-align: left;
}

.play-mode-option:hover,
.play-mode-option:focus-visible {
  background: var(--hover-bg);
  color: var(--text-main);
}

.play-mode-option:focus-visible {
  box-shadow: inset 0 0 0 1px var(--text-muted);
}
</style>
