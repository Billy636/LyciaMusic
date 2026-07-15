<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useLyrics } from '../../composables/lyrics';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useSettings } from '../../features/settings/useSettings';
import { useSharedTransition } from '../../composables/useSharedTransition';
import { useToast } from '../../composables/toast';
import { windowApi } from '../../services/tauri/windowApi';
import type { SongDetail } from '../../types';
import LyricsView from './LyricsView.vue';
import PlayerDetailBackground from './PlayerDetailBackground.vue';
import PlayerDetailLeft from './PlayerDetailLeft.vue';
import QueueList from './QueueList.vue';
import { resolvePlayerDetailEscapeAction } from './playerDetailKeyboard';
import { hideMainWindowToTray } from '../../composables/renderingPower';

const {
  showPlayerDetail,
  showQueue,
  currentSong,
  closePlayerDetail,
} = usePlaybackController();

const { settings } = useSettings();

const { parsedLyrics } = useLyrics();
const { staggerPhase } = useSharedTransition();
const { loadSongDetail, clearSongDetailCache } = useSongDetailCache();
const { showToast } = useToast();

const TOP_CHROME_HIDE_DELAY = 2500;
const IMMERSIVE_CURSOR_HIDE_DELAY = 2500;

const isTopChromeVisible = ref(false);
let topChromeHideTimer: ReturnType<typeof setTimeout> | null = null;
const isImmersiveCursorHidden = ref(false);
let immersiveCursorHideTimer: ReturnType<typeof setTimeout> | null = null;
const currentSongDetail = ref<SongDetail | null>(null);
let detailRequestId = 0;

const appWindow = getCurrentWindow();

const isFullscreen = ref(false);
const wasMaximizedBeforeFullscreen = ref(false);
const isFullscreenTransitioning = ref(false);
let unlistenResize: (() => void) | null = null;
let pendingFullscreenTransitions = 0;
let fullscreenTransitionQueue = Promise.resolve();

const enqueueFullscreenTransition = (operation: () => Promise<void>) => {
  pendingFullscreenTransitions += 1;
  isFullscreenTransitioning.value = true;

  const result = fullscreenTransitionQueue.then(operation);
  fullscreenTransitionQueue = result.catch(() => undefined);

  return result.finally(() => {
    pendingFullscreenTransitions -= 1;
    isFullscreenTransitioning.value = pendingFullscreenTransitions > 0;
  });
};

const toggleFullscreen = async () => {
  try {
    await enqueueFullscreenTransition(async () => {
      const currentFullscreen = await appWindow.isFullscreen();
      const state = await windowApi.setImmersiveFullscreen(
        !currentFullscreen,
        currentFullscreen && wasMaximizedBeforeFullscreen.value,
      );

      isFullscreen.value = state.isFullscreen;
      wasMaximizedBeforeFullscreen.value = state.wasMaximizedBeforeFullscreen;
      showTopChrome();
      scheduleTopChromeHide();
    });
  } catch (error) {
    console.error('Failed to toggle fullscreen:', error);
    isFullscreen.value = await appWindow.isFullscreen().catch(() => false);
    showToast('沉浸模式切换失败，请重试', 'error');
  }
};

const exitImmersiveFullscreen = async () => {
  try {
    await enqueueFullscreenTransition(async () => {
      const currentFullscreen = await appWindow.isFullscreen();
      if (!currentFullscreen && !wasMaximizedBeforeFullscreen.value) {
        isFullscreen.value = false;
        return;
      }

      const state = await windowApi.setImmersiveFullscreen(
        false,
        wasMaximizedBeforeFullscreen.value,
      );
      isFullscreen.value = state.isFullscreen;
      wasMaximizedBeforeFullscreen.value = false;
    });
  } catch (error) {
    console.error('Failed to exit fullscreen:', error);
    isFullscreen.value = await appWindow.isFullscreen().catch(() => false);
    showToast('退出沉浸模式失败，请重试', 'error');
  }
};

const minimize = () => appWindow.minimize();
const toggleMaximize = async () => {
  const isMaximized = await appWindow.isMaximized();
  if (isMaximized) {
    await appWindow.unmaximize();
    return;
  }
  await appWindow.maximize();
};
const closeApp = async () => {
  if (settings.value.closeToTray) {
    await hideMainWindowToTray(appWindow);
  } else {
    await appWindow.close();
  }
};

const clearTopChromeHideTimer = () => {
  if (topChromeHideTimer) {
    clearTimeout(topChromeHideTimer);
    topChromeHideTimer = null;
  }
};

const scheduleTopChromeHide = () => {
  clearTopChromeHideTimer();
  topChromeHideTimer = setTimeout(() => {
    isTopChromeVisible.value = false;
    topChromeHideTimer = null;
  }, TOP_CHROME_HIDE_DELAY);
};

const showTopChrome = () => {
  clearTopChromeHideTimer();
  isTopChromeVisible.value = true;
};

const handleTopChromeLeave = () => {
  scheduleTopChromeHide();
};

const clearImmersiveCursorHideTimer = () => {
  if (immersiveCursorHideTimer) {
    clearTimeout(immersiveCursorHideTimer);
    immersiveCursorHideTimer = null;
  }
};

const scheduleImmersiveCursorHide = () => {
  clearImmersiveCursorHideTimer();
  if (!showPlayerDetail.value || !isFullscreen.value) {
    isImmersiveCursorHidden.value = false;
    return;
  }

  immersiveCursorHideTimer = setTimeout(() => {
    isImmersiveCursorHidden.value = true;
    immersiveCursorHideTimer = null;
  }, IMMERSIVE_CURSOR_HIDE_DELAY);
};

const handleGlobalMousemove = () => {
  if (!showPlayerDetail.value || !isFullscreen.value) return;

  isImmersiveCursorHidden.value = false;
  scheduleImmersiveCursorHide();
};

watch([showPlayerDetail, isFullscreen], ([visible, fullscreen]) => {
  clearImmersiveCursorHideTimer();
  isImmersiveCursorHidden.value = false;

  if (visible && fullscreen) {
    scheduleImmersiveCursorHide();
  }
});

watch(showPlayerDetail, async (visible) => {
  clearTopChromeHideTimer();

  if (visible) {
    isTopChromeVisible.value = true;
    scheduleTopChromeHide();
    return;
  }

  isTopChromeVisible.value = false;
  currentSongDetail.value = null;
  clearSongDetailCache();

  // Exit fullscreen if we collapse the player details page
  await exitImmersiveFullscreen();
});

watch([showPlayerDetail, () => currentSong.value?.path ?? ''], async ([visible, path]) => {
  const requestId = ++detailRequestId;

  if (!visible || !path) {
    currentSongDetail.value = null;
    return;
  }

  try {
    const detail = await loadSongDetail(path);
    if (
      requestId !== detailRequestId
      || !showPlayerDetail.value
      || path !== (currentSong.value?.path ?? '')
    ) {
      return;
    }

    currentSongDetail.value = detail;
  } catch {
    if (
      requestId !== detailRequestId
      || !showPlayerDetail.value
      || path !== (currentSong.value?.path ?? '')
    ) {
      return;
    }

    currentSongDetail.value = null;
  }
}, { immediate: true });

const isTypingTarget = (target: EventTarget | null) => {
  const INTERACTIVE_SELECTOR = [
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[role="textbox"]',
    '[data-shortcut-capture="true"]',
  ].join(', ');
  return target instanceof HTMLElement && !!target.closest(INTERACTIVE_SELECTOR);
};

const isModalOrMenuOpen = () => {
  const elements = document.querySelectorAll('[class*="z-["]');
  for (const el of elements) {
    const style = window.getComputedStyle(el);
    if (style.pointerEvents === 'none' || style.display === 'none' || style.visibility === 'hidden') {
      continue;
    }
    const zIndex = parseInt(style.zIndex, 10);
    if (!isNaN(zIndex) && zIndex >= 9000) {
      return true;
    }
  }
  return false;
};

const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (!showPlayerDetail.value) return;

  if (event.key === 'Escape') {
    if (isTypingTarget(event.target)) return;
    if (isModalOrMenuOpen()) return;

    event.preventDefault();
    event.stopPropagation();

    const action = resolvePlayerDetailEscapeAction(
      isFullscreen.value,
      isFullscreenTransitioning.value,
    );
    if (action === 'exit-immersive') {
      void exitImmersiveFullscreen();
      return;
    }

    closePlayerDetail();
  }
};

const handleGlobalMouseup = (event: MouseEvent) => {
  if (!showPlayerDetail.value) return;

  if (event.button === 3) {
    if (isModalOrMenuOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    closePlayerDetail();
  }
};

const handleGlobalMousedown = (event: MouseEvent) => {
  if (!showPlayerDetail.value) return;

  if (event.button === 3) {
    if (isModalOrMenuOpen()) return;
    event.preventDefault();
    event.stopPropagation();
  }
};

onMounted(async () => {
  isFullscreen.value = await appWindow.isFullscreen();

  // Listen to window resize to synchronize fullscreen state changes
  const unlisten = await appWindow.listen('tauri://resize', async () => {
    isFullscreen.value = await appWindow.isFullscreen();
  });
  unlistenResize = unlisten;

  window.addEventListener('keydown', handleGlobalKeydown, true);
  window.addEventListener('mousemove', handleGlobalMousemove, true);
  window.addEventListener('mouseup', handleGlobalMouseup, true);
  window.addEventListener('mousedown', handleGlobalMousedown, true);
});

onBeforeUnmount(() => {
  clearTopChromeHideTimer();
  clearImmersiveCursorHideTimer();
  isImmersiveCursorHidden.value = false;
  if (unlistenResize) {
    unlistenResize();
  }
  window.removeEventListener('keydown', handleGlobalKeydown, true);
  window.removeEventListener('mousemove', handleGlobalMousemove, true);
  window.removeEventListener('mouseup', handleGlobalMouseup, true);
  window.removeEventListener('mousedown', handleGlobalMousedown, true);
});


const formatFileSize = (size: number | undefined) => {
  if (!size || size <= 0) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const staggerStyle = (phase: number, translateDir: 'Y' | 'X' = 'Y', distance = 20) => {
  const visible = showPlayerDetail.value || staggerPhase.value >= phase;
  const translate = translateDir === 'Y' ? `translateY(${distance}px)` : `translateX(${distance}px)`;

  return {
    opacity: visible ? 1 : 0,
    transform: visible ? 'translate(0, 0)' : translate,
    transition: `opacity 400ms cubic-bezier(0.22,1,0.36,1) ${showPlayerDetail.value ? phase * 100 : 0}ms, transform 400ms cubic-bezier(0.22,1,0.36,1) ${showPlayerDetail.value ? phase * 100 : 0}ms`,
  };
};

const handleClose = () => {
  closePlayerDetail();
};

const metaInfo = computed(() => {
  if (!currentSong.value) return [];

  const song = currentSong.value;
  const detail = currentSongDetail.value;

  return [
    { label: '歌手', value: song.artist },
    { label: '专辑', value: song.album },
    {
      label: '音质',
      value: (detail?.bitrate || song.bitrate)
        ? `${detail?.sample_rate || song.sample_rate}Hz / ${detail?.bitrate || song.bitrate}kbps`
        : 'Standard',
    },
    (detail?.genre || song.genre) ? { label: '风格', value: detail?.genre || song.genre || '' } : null,
    (detail?.year || song.year) ? { label: '年份', value: detail?.year || song.year || '' } : null,
    detail?.file_size ? { label: '大小', value: formatFileSize(detail.file_size) } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item?.value));
});
</script>

<template>
  <div
    class="fixed inset-x-0 bottom-0 z-[50] flex h-[100vh] flex-col overflow-visible font-sans select-none text-white"
    :class="[
      showPlayerDetail ? 'pointer-events-auto' : 'pointer-events-none',
      isImmersiveCursorHidden ? 'immersive-cursor-hidden' : '',
    ]"
  >
    <div class="relative flex h-[100vh] w-full flex-col pt-[calc(100vh-100%)]">
      <div
        class="absolute inset-0 transition-all duration-600 ease-[cubic-bezier(0.22,1,0.36,1)]"
        :style="{
          opacity: showPlayerDetail ? 1 : 0,
          transform: showPlayerDetail ? 'translateY(0)' : 'translateY(100%)',
        }"
      >
        <PlayerDetailBackground :bgOpacity="1" :active="showPlayerDetail" />
        <div class="absolute inset-0 z-[-1] bg-[#0a0a0a]"></div>
      </div>

      <div
        class="relative z-[60] h-24"
        :style="staggerStyle(1, 'Y', -10)"
        @mouseenter="showTopChrome"
        @mousemove="showTopChrome"
        @mouseleave="handleTopChromeLeave"
      >
        <div
          class="absolute inset-x-0 top-0 h-24"
          :class="showPlayerDetail ? 'pointer-events-auto' : 'pointer-events-none'"
        ></div>

        <div
          class="relative flex h-14 items-center justify-between px-6 transition-all duration-500 ease-out"
          :class="[
            isTopChromeVisible ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0',
            showPlayerDetail ? 'pointer-events-auto' : 'pointer-events-none',
          ]"
        >
          <div class="absolute inset-0" data-tauri-drag-region></div>

          <div class="relative z-10 flex w-1/4 items-center">
            <button
              v-if="!isFullscreen"
              title="收起详情页"
              class="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
              @click="handleClose"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          <div class="pointer-events-none flex-1 truncate px-4 text-center text-sm font-medium text-white/80 drop-shadow-md">
            {{ currentSong?.title || currentSong?.name }}
            <span v-if="currentSong?.artist" class="mx-1 opacity-60">-</span>
            <span class="opacity-60">{{ currentSong?.artist }}</span>
          </div>

          <div class="relative z-10 flex w-1/4 items-center justify-end gap-2">
            <button
              :title="isFullscreenTransitioning ? '正在切换沉浸模式' : isFullscreen ? '退出沉浸模式' : '沉浸模式 (全屏)'"
              :aria-label="isFullscreen ? '退出沉浸模式' : '进入沉浸模式'"
              :disabled="isFullscreenTransitioning"
              class="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
              :class="isFullscreenTransitioning ? 'cursor-wait opacity-50' : ''"
              @click="toggleFullscreen"
            >
              <svg v-if="isFullscreen" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="10" y1="14" x2="3" y2="21" />
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
            <button class="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white" @click="minimize">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14" />
              </svg>
            </button>
            <button v-if="!isFullscreen" class="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white" @click="toggleMaximize">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              </svg>
            </button>
            <button class="rounded-lg p-2 text-white/50 transition hover:bg-red-500 hover:text-white" @click="closeApp">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <PlayerDetailLeft :isExpanded="showPlayerDetail" />

      <div class="relative z-50 flex min-h-0 flex-1 pl-8 pr-0 pb-22">
        <div class="pointer-events-none h-full w-[40%] min-w-[300px]"></div>

        <div
          class="flex h-full min-h-0 flex-1 flex-col justify-center pt-0 pb-0 pl-2 pr-8"
          :style="staggerStyle(2, 'X', 20)"
        >
          <transition name="fade-scale" mode="out-in">
            <QueueList
              v-if="showQueue"
              class="h-full rounded-2xl border border-white/5 bg-black/10 p-4 shadow-xl backdrop-blur-sm"
            />

            <LyricsView v-else-if="showPlayerDetail && parsedLyrics.length > 0" class="h-full" />

            <div
              v-else
              class="flex h-full flex-col items-center justify-center opacity-80"
              style="text-shadow: 0 2px 10px rgba(0,0,0,0.4);"
            >
              <div
                v-for="(info, index) in metaInfo"
                :key="index"
                class="mb-4 flex items-center text-xl font-medium tracking-wider sm:text-2xl"
              >
                <span class="mr-4 text-white/40">{{ info.label }}</span>
                <span class="text-white drop-shadow-md">{{ info.value }}</span>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.97) translateY(10px);
}

.text-shadow-sm {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.immersive-cursor-hidden,
.immersive-cursor-hidden :deep(*) {
  cursor: none !important;
}
</style>
