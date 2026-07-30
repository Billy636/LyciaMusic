<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useLyrics } from '../../composables/lyrics';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useSettings } from '../../features/settings/useSettings';
import { useSharedTransition } from '../../composables/useSharedTransition';
import type { SongDetail } from '../../types';
import LyricsView from './LyricsView.vue';
import PlayerDetailBackground from './PlayerDetailBackground.vue';
import PlayerDetailLeft from './PlayerDetailLeft.vue';
import QueueList from './QueueList.vue';

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

const TOP_CHROME_HIDE_DELAY = 2500;

const isTopChromeVisible = ref(false);
let topChromeHideTimer: ReturnType<typeof setTimeout> | null = null;
const currentSongDetail = ref<SongDetail | null>(null);
let detailRequestId = 0;

const appWindow = getCurrentWindow();

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
    await appWindow.hide();
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

watch(showPlayerDetail, (visible) => {
  clearTopChromeHideTimer();

  if (visible) {
    isTopChromeVisible.value = true;
    scheduleTopChromeHide();
    return;
  }

  isTopChromeVisible.value = false;
  currentSongDetail.value = null;
  clearSongDetailCache();
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

onBeforeUnmount(() => {
  clearTopChromeHideTimer();
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
    { label: '音质', value: song.bitrate ? `${song.sample_rate}Hz / ${song.bitrate}kbps` : 'Standard' },
    (detail?.genre || song.genre) ? { label: '风格', value: detail?.genre || song.genre || '' } : null,
    (detail?.year || song.year) ? { label: '年份', value: detail?.year || song.year || '' } : null,
    detail?.file_size ? { label: '大小', value: formatFileSize(detail.file_size) } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item?.value));
});
</script>

<template>
  <div
    class="fixed inset-x-0 bottom-0 z-[50] flex h-[100vh] flex-col overflow-visible font-sans select-none text-white"
    :class="showPlayerDetail ? 'pointer-events-auto' : 'pointer-events-none'"
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
              title="收起详情页"
              class="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
              @click="handleClose"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          <transition name="song-switch-text" mode="out-in">
            <div :key="currentSong?.path" class="pointer-events-none flex-1 truncate px-4 text-center text-sm font-medium text-white/80 drop-shadow-md">
              {{ currentSong?.title || currentSong?.name }}
              <span v-if="currentSong?.artist" class="mx-1 opacity-60">-</span>
              <span class="opacity-60">{{ currentSong?.artist }}</span>
            </div>
          </transition>

          <div class="relative z-10 flex w-1/4 items-center justify-end gap-2">
            <button class="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white" @click="minimize">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14" />
              </svg>
            </button>
            <button class="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white" @click="toggleMaximize">
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

            <LyricsView v-else-if="parsedLyrics.length > 0" class="h-full" />

            <transition v-else name="song-switch-meta" mode="out-in">
              <div
                :key="currentSong?.path"
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

/* 切歌时标题/歌手文字过渡 */
.song-switch-text-enter-active,
.song-switch-text-leave-active {
  transition:
    opacity 300ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-switch-text-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.song-switch-text-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* 切歌时歌曲元信息面板过渡 */
.song-switch-meta-enter-active,
.song-switch-meta-leave-active {
  transition:
    opacity 360ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 360ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-switch-meta-enter-from {
  opacity: 0;
  transform: translateY(16px) scale(0.98);
}

.song-switch-meta-leave-to {
  opacity: 0;
  transform: translateY(-12px) scale(0.98);
}

.text-shadow-sm {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}
</style>
