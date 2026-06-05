<script setup lang="ts">
import {
  Check,
  ChevronRight,
  Minimize2,
  Music2,
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
import { computed, onMounted, onUnmounted, ref, type Component } from 'vue';

import {
  APP_TRAY_MENU_EVENT,
  TRAY_MENU_READY_EVENT,
  TRAY_MENU_STATE_EVENT,
  type TrayMenuAction,
  type TrayMenuStatePayload,
} from '../../features/tray/actions';
import type { Song } from '../../types';

const appWindow = getCurrentWindow();
const currentSong = ref<Song | null>(null);
const isPlaying = ref(false);
const isDarkTheme = ref(true);
const playMode = ref(0);
const isPlayModeMenuOpen = ref(false);
const submenuPlacement = ref<'left' | 'right'>('left');
let unlistenState: UnlistenFn | null = null;
let unlistenFocus: UnlistenFn | null = null;
let unlistenCloseRequested: UnlistenFn | null = null;

const trackLabel = computed(() => {
  const song = currentSong.value;
  if (!song) return 'Lycia Player';

  const title = song.title || song.name.replace(/\.[^/.]+$/, '');
  return song.artist ? `${title} - ${song.artist}` : title;
});

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

const hideWindow = () => {
  void appWindow.hide();
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    hideWindow();
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
    submenuPlacement.value = event.payload.submenuPlacement;
    isPlayModeMenuOpen.value = false;
  });

  unlistenFocus = await appWindow.onFocusChanged((event) => {
    if (!event.payload) {
      hideWindow();
    }
  });

  unlistenCloseRequested = await appWindow.onCloseRequested((event) => {
    event.preventDefault();
    hideWindow();
  });

  await emitTo('main', TRAY_MENU_READY_EVENT);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  unlistenState?.();
  unlistenFocus?.();
  unlistenCloseRequested?.();
});
</script>

<template>
  <div
    class="tray-menu-shell"
    :class="[
      { 'tray-menu-shell--light': !isDarkTheme },
      `tray-menu-shell--submenu-${submenuPlacement}`,
    ]"
    @pointerdown.self="hideWindow"
  >
    <div class="tray-menu-panel">
      <section class="track-row">
        <Music2 class="track-icon" :size="18" :stroke-width="2.1" />
        <span class="track-title" :title="trackLabel">{{ trackLabel }}</span>
      </section>

      <div class="menu-divider" />

      <section class="transport" aria-label="播放控制" @mouseenter="closePlayModeMenu">
        <button class="transport-button" title="上一首" @click="sendAction('prev-song', { hide: false })">
          <SkipBack :size="22" :stroke-width="2.35" />
        </button>
        <button class="transport-button transport-button--play" title="播放/暂停" @click="sendAction('toggle-play', { hide: false })">
          <Pause v-if="isPlaying" :size="24" :stroke-width="2.5" />
          <Play v-else :size="24" :stroke-width="2.5" />
        </button>
        <button class="transport-button" title="下一首" @click="sendAction('next-song', { hide: false })">
          <SkipForward :size="22" :stroke-width="2.35" />
        </button>
      </section>

      <div class="menu-divider" />

      <button
        class="menu-row"
        :class="{ 'menu-row--open': isPlayModeMenuOpen }"
        @mouseenter="openPlayModeMenu"
        @focus="openPlayModeMenu"
      >
        <span class="row-icon">
          <component :is="playModeConfig.icon" :size="18" :stroke-width="2.15" />
        </span>
        <span class="row-label">{{ playModeConfig.label }}</span>
        <ChevronRight class="row-chevron" :size="18" :stroke-width="2.2" />
      </button>

      <button class="menu-row" @mouseenter="closePlayModeMenu" @click="sendAction('show-mini-player')">
        <span class="row-icon">
          <Minimize2 :size="18" :stroke-width="2.15" />
        </span>
        <span class="row-label">mini窗口</span>
      </button>

      <div class="menu-divider" />

      <button class="menu-row" @mouseenter="closePlayModeMenu" @click="sendAction('open-desktop-lyrics')">
        <span class="row-icon row-icon--text">词</span>
        <span class="row-label">打开桌面歌词</span>
      </button>

      <div class="menu-divider" />

      <button class="menu-row" @mouseenter="closePlayModeMenu" @click="sendAction('open-settings')">
        <span class="row-icon">
          <Settings :size="18" :stroke-width="2.15" />
        </span>
        <span class="row-label">设置</span>
      </button>

      <div class="menu-divider" />

      <button class="menu-row" @mouseenter="closePlayModeMenu" @click="sendAction('quit')">
        <span class="row-icon">
          <Power :size="18" :stroke-width="2.15" />
        </span>
        <span class="row-label">退出</span>
      </button>
    </div>

    <div v-if="isPlayModeMenuOpen" class="play-mode-popover">
      <button
        v-for="option in playModeOptions"
        :key="option.action"
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

  width: 330px;
  height: 276px;
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
  width: 190px;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  padding-bottom: 8px;
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
  height: 32px;
  gap: 9px;
  padding: 0 13px;
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
  margin: 3px 13px;
  background: var(--divider);
}

.transport {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-items: center;
  height: 40px;
  padding: 0 15px;
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
  height: 32px;
  margin: 0 6px;
  gap: 9px;
  border-radius: 7px;
  padding: 0 7px;
  text-align: left;
}

.menu-row--open {
  background: var(--hover-bg);
  color: var(--text-main);
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

.row-chevron {
  flex: 0 0 auto;
  color: currentColor;
}

.play-mode-popover {
  position: absolute;
  top: 86px;
  z-index: 5;
  width: 132px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--panel-bg);
  box-shadow: inset 0 0 0 1px var(--panel-border);
}

.tray-menu-shell--submenu-left .play-mode-popover {
  right: 198px;
}

.tray-menu-shell--submenu-right .play-mode-popover {
  left: 198px;
}

.play-mode-option {
  display: grid;
  grid-template-columns: 18px 1fr 16px;
  align-items: center;
  width: 100%;
  height: 30px;
  gap: 7px;
  border: 0;
  padding: 0 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12.5px;
  text-align: left;
}

.play-mode-option:hover {
  background: var(--hover-bg);
  color: var(--text-main);
}
</style>
