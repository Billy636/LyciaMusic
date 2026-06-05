<script setup lang="ts">
import { LogicalSize } from '@tauri-apps/api/dpi';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import { getNextWheelVolume } from '../../composables/playerUiShell';
import {
  MINI_PLAYER_ACTION_EVENT,
  MINI_PLAYER_BOUNDS_EVENT,
  MINI_PLAYER_READY_EVENT,
  MINI_PLAYER_REQUEST_STATE_EVENT,
  MINI_PLAYER_STATE_APPLIED_EVENT,
  MINI_PLAYER_STATE_EVENT,
  MINI_PLAYER_VISIBILITY_EVENT,
  MINI_PLAYER_WINDOW_BASE_HEIGHT,
  MINI_PLAYER_WINDOW_EXPANDED_HEIGHT,
  MINI_PLAYER_WINDOW_VOLUME_HEIGHT,
  MINI_PLAYER_WINDOW_WIDTH,
  type MiniPlayerAction,
  type MiniPlayerStatePayload,
} from '../../features/miniPlayer/shared';
import type { Song } from '../../types';

const appWindow = getCurrentWindow();
const currentSong = ref<Song | null>(null);
const isPlaying = ref(false);
const isDarkTheme = ref(false);
const volume = ref(100);
const queue = ref<Song[]>([]);
const lyricText = ref('');
const localCoverUrl = ref('');
const isWindowVisible = ref(false);
const showMiniPlaylist = ref(false);
const showVolumePopover = ref(false);
const isHovering = ref(false);
const isCoverHovering = ref(false);
const showLyrics = ref(false);
const isDraggingVolume = ref(false);
const volumeBarRef = ref<HTMLElement | null>(null);
const volumeButtonRef = ref<HTMLElement | null>(null);
const volumePopoverRef = ref<HTMLElement | null>(null);
const volumePopoverStyle = ref<Record<string, string>>({
  left: '0px',
  top: '0px',
});
let idleTimer: number | null = null;
let unlistenWindowMoved: (() => void) | null = null;
let unlistenCloseRequested: (() => void) | null = null;
let unlistenState: (() => void) | null = null;
let unlistenVisibility: (() => void) | null = null;

const VOLUME_POPOVER_WIDTH = 160;
const VOLUME_POPOVER_GAP = 8;
const VOLUME_POPOVER_MARGIN = 8;

const displayQueue = computed(() => queue.value);

const formatDuration = (seconds: number) => {
  if (!seconds) return '00:00';

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const sendAction = (action: MiniPlayerAction) => {
  void emitTo('main', MINI_PLAYER_ACTION_EVENT, action);
};

const stopIdleTimer = () => {
  if (idleTimer) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
};

const resetIdleTimer = () => {
  stopIdleTimer();
  showLyrics.value = false;

  if (isWindowVisible.value && isPlaying.value) {
    idleTimer = window.setTimeout(() => {
      if (!isHovering.value) showLyrics.value = true;
    }, 5000);
  }
};

const applyWindowHeight = async () => {
  let height = MINI_PLAYER_WINDOW_BASE_HEIGHT;
  if (showMiniPlaylist.value) {
    height = MINI_PLAYER_WINDOW_EXPANDED_HEIGHT;
  } else if (showVolumePopover.value || isDraggingVolume.value) {
    height = MINI_PLAYER_WINDOW_VOLUME_HEIGHT;
  }

  const size = new LogicalSize(MINI_PLAYER_WINDOW_WIDTH, height);
  await appWindow.setMinSize(size);
  await appWindow.setMaxSize(size);
  await appWindow.setSize(size);
};

const updateVolumePopoverPosition = () => {
  if (!volumeButtonRef.value) return;
  const rect = volumeButtonRef.value.getBoundingClientRect();

  let left = rect.left + rect.width / 2 - VOLUME_POPOVER_WIDTH / 2;
  const maxLeft = window.innerWidth - VOLUME_POPOVER_WIDTH - VOLUME_POPOVER_MARGIN;
  left = Math.max(VOLUME_POPOVER_MARGIN, Math.min(left, maxLeft));

  volumePopoverStyle.value = {
    left: `${left}px`,
    top: `${rect.bottom + VOLUME_POPOVER_GAP}px`,
  };
};

const setVolume = (nextVolume: number) => {
  const normalizedVolume = Math.max(0, Math.min(100, Math.round(nextVolume)));
  volume.value = normalizedVolume;
  sendAction({ type: 'set-volume', volume: normalizedVolume });
};

const handleVolumeWheel = (event: WheelEvent) => {
  setVolume(getNextWheelVolume(volume.value, event.deltaY));
};

const updateVolume = (clientX: number) => {
  if (!volumeBarRef.value) return;
  const rect = volumeBarRef.value.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  setVolume(percent * 100);
};

const startVolumeDrag = (event: PointerEvent) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  showVolumePopover.value = true;
  isDraggingVolume.value = true;
  updateVolume(event.clientX);
};

const toggleVolumePopover = () => {
  showVolumePopover.value = !showVolumePopover.value;
  if (showVolumePopover.value) {
    showMiniPlaylist.value = false;
    void nextTick(() => updateVolumePopoverPosition());
  }
};

const toggleMiniPlaylist = () => {
  showMiniPlaylist.value = !showMiniPlaylist.value;
  if (showMiniPlaylist.value) {
    showVolumePopover.value = false;
  }
};

const onMouseEnter = () => {
  isHovering.value = true;
  if (idleTimer) window.clearTimeout(idleTimer);
  showLyrics.value = false;
};

const onMouseLeave = () => {
  isHovering.value = false;
  resetIdleTimer();
};

const onGlobalPointerMove = (event: PointerEvent) => {
  if (isWindowVisible.value && isDraggingVolume.value) {
    event.preventDefault();
    updateVolume(event.clientX);
  }
};

const onGlobalPointerEnd = () => {
  isDraggingVolume.value = false;
};

const onGlobalMouseDown = (event: MouseEvent) => {
  if (!isWindowVisible.value || !showVolumePopover.value) return;
  const target = event.target as Node | null;
  if (!target) return;

  const clickInButton = !!volumeButtonRef.value?.contains(target);
  const clickInPopover = !!volumePopoverRef.value?.contains(target);
  if (!clickInButton && !clickInPopover) {
    showVolumePopover.value = false;
  }
};

const onGlobalResize = () => {
  if (isWindowVisible.value && showVolumePopover.value) {
    updateVolumePopoverPosition();
  }
};

const onGlobalKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    showVolumePopover.value = false;
    showMiniPlaylist.value = false;
  }
};

watch(isPlaying, () => {
  resetIdleTimer();
});

watch([showMiniPlaylist, showVolumePopover, isDraggingVolume], () => {
  void applyWindowHeight();
  if (showVolumePopover.value) {
    void nextTick(() => updateVolumePopoverPosition());
  }
});

onMounted(async () => {
  try {
    await appWindow.setBackgroundColor([0, 0, 0, 0]);
  } catch (error) {
    console.warn('Failed to force transparent background for mini player window:', error);
  }

  await appWindow.setAlwaysOnTop(true);
  await applyWindowHeight();
  resetIdleTimer();

  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerEnd);
  window.addEventListener('pointercancel', onGlobalPointerEnd);
  window.addEventListener('mousedown', onGlobalMouseDown);
  window.addEventListener('resize', onGlobalResize);
  window.addEventListener('keydown', onGlobalKeydown);

  unlistenState = await listen<MiniPlayerStatePayload>(MINI_PLAYER_STATE_EVENT, (event) => {
    currentSong.value = event.payload.currentSong;
    localCoverUrl.value = event.payload.coverUrl;
    isPlaying.value = event.payload.isPlaying;
    isDarkTheme.value = event.payload.isDarkTheme;
    volume.value = event.payload.volume;
    queue.value = event.payload.queue;
    lyricText.value = event.payload.lyricText;
    void nextTick(() => emitTo('main', MINI_PLAYER_STATE_APPLIED_EVENT));
  });

  unlistenVisibility = await listen<{ visible: boolean }>(MINI_PLAYER_VISIBILITY_EVENT, (event) => {
    isWindowVisible.value = event.payload.visible;
    if (isWindowVisible.value) {
      resetIdleTimer();
      if (showVolumePopover.value) {
        void nextTick(() => updateVolumePopoverPosition());
      }
      return;
    }

    stopIdleTimer();
    showLyrics.value = false;
    showVolumePopover.value = false;
    isDraggingVolume.value = false;
  });

  unlistenWindowMoved = await appWindow.onMoved(async () => {
    const factor = await appWindow.scaleFactor();
    const position = (await appWindow.outerPosition()).toLogical(factor);
    await emitTo('main', MINI_PLAYER_BOUNDS_EVENT, {
      x: position.x,
      y: position.y,
    });

    if (showVolumePopover.value) {
      updateVolumePopoverPosition();
    }
  });

  unlistenCloseRequested = await appWindow.onCloseRequested((event) => {
    event.preventDefault();
    sendAction({ type: 'close' });
  });

  await emitTo('main', MINI_PLAYER_READY_EVENT);
  await emitTo('main', MINI_PLAYER_REQUEST_STATE_EVENT);
});

onUnmounted(() => {
  stopIdleTimer();
  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerEnd);
  window.removeEventListener('pointercancel', onGlobalPointerEnd);
  window.removeEventListener('mousedown', onGlobalMouseDown);
  window.removeEventListener('resize', onGlobalResize);
  window.removeEventListener('keydown', onGlobalKeydown);
  unlistenWindowMoved?.();
  unlistenCloseRequested?.();
  unlistenState?.();
  unlistenVisibility?.();
});
</script>

<template>
  <div
    class="w-[300px] h-full relative select-none overflow-hidden bg-transparent !border-none !outline-none !ring-0 !shadow-none"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div class="h-[75px] shrink-0 relative overflow-hidden border-0 border-transparent">
      <div
        class="h-[45px] w-full bg-white dark:bg-gray-900 flex relative border-0"
        :class="[isDarkTheme ? 'dark !bg-gray-900' : '!bg-white']"
        data-tauri-drag-region
      >
        <div class="w-[45px] h-[45px] shrink-0 relative overflow-hidden" @mouseenter="isCoverHovering = true" @mouseleave="isCoverHovering = false" data-tauri-drag-region>
          <img v-if="localCoverUrl" :src="localCoverUrl" class="w-full h-full object-cover pointer-events-none" />
          <div v-else class="w-full h-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-gray-400 pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
        </div>

        <div class="flex-1 flex items-center justify-center overflow-hidden px-4 relative" data-tauri-drag-region>
          <transition name="fade">
            <div v-if="showLyrics" class="absolute inset-0 flex items-center justify-center px-4 overflow-hidden pointer-events-none" data-tauri-drag-region>
              <div class="text-xs whitespace-nowrap text-[#EC4141] font-medium" :class="{ 'marquee': lyricText && lyricText.length > 20 }">
                <span>{{ lyricText || (currentSong ? currentSong.title : 'Lycia Player') }}</span>
              </div>
            </div>
          </transition>

          <transition name="fade">
            <div v-show="!showLyrics" class="flex flex-1 items-center justify-center gap-4 h-full pointer-events-none" data-tauri-drag-region>
              <button @click.stop="sendAction({ type: 'prev-song' })" class="text-gray-700 dark:text-white/80 hover:text-[#EC4141] transition-colors pointer-events-auto">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg>
              </button>

              <button @click.stop="sendAction({ type: 'toggle-play' })" class="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-800 dark:text-white hover:text-[#EC4141] pointer-events-auto">
                <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 fill-current ml-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              </button>

              <button @click.stop="sendAction({ type: 'next-song' })" class="text-gray-700 dark:text-white/80 hover:text-[#EC4141] transition-colors pointer-events-auto">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
              </button>
            </div>
          </transition>
        </div>

        <div class="shrink-0 flex items-center justify-end pr-7 gap-1 relative z-10 pointer-events-none" data-tauri-drag-region>
          <div class="relative flex items-center justify-center h-full pointer-events-auto">
            <Teleport to="body">
              <div
                v-if="showVolumePopover || isDraggingVolume"
                ref="volumePopoverRef"
                class="fixed z-[200] w-40 h-[46px] bg-white/95 dark:bg-gray-800/95 backdrop-blur shadow-xl rounded-xl border border-gray-200 dark:border-white/10 px-2.5 py-2 flex items-center gap-2"
                :class="[isDarkTheme ? 'dark !bg-gray-800/95 !border-white/10' : '!bg-white/95 !border-gray-200']"
                :style="volumePopoverStyle"
                @wheel.prevent.stop="handleVolumeWheel"
              >
                <button
                  @click.stop="sendAction({ type: 'toggle-mute' })"
                  class="shrink-0 text-gray-500 dark:text-white/80 hover:text-[#EC4141] transition-colors"
                >
                  <svg v-if="volume === 0" xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                </button>

                <div
                  ref="volumeBarRef"
                  class="relative flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full cursor-pointer [touch-action:none]"
                  @pointerdown.stop="startVolumeDrag"
                >
                  <div class="absolute left-0 top-0 h-full bg-[#EC4141] rounded-full" :style="{ width: volume + '%' }"></div>
                  <div class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-sm cursor-grab active:cursor-grabbing" :style="{ left: volume + '%' }"></div>
                </div>

                <div class="w-8 text-right text-[10px] text-gray-500 dark:text-white/60 font-medium select-none">{{ volume }}%</div>
              </div>
            </Teleport>

            <button
              ref="volumeButtonRef"
              @click.stop="toggleVolumePopover"
              @wheel.prevent.stop="handleVolumeWheel"
              class="text-gray-500 dark:text-white/80 hover:text-gray-800 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
              <svg v-if="volume === 0" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
            </button>
          </div>

          <button
            @click.stop="toggleMiniPlaylist"
            class="p-1 rounded-full transition-colors pointer-events-auto"
            :class="showMiniPlaylist ? 'text-[#EC4141] bg-red-50 dark:bg-red-500/10' : 'text-gray-500 dark:text-white/80 hover:text-[#EC4141] hover:bg-gray-100 dark:hover:bg-white/10'"
            title="播放列表"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h10m-10 4h6" />
            </svg>
          </button>
        </div>

        <button @click.stop="sendAction({ type: 'close' })" class="absolute top-1 right-1 text-gray-400 dark:text-white/50 hover:text-white hover:bg-[#EC4141] p-0.5 rounded transition-colors z-20 pointer-events-auto" title="关闭">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        <button @click.stop="sendAction({ type: 'restore-main' })" class="absolute top-[18px] right-1 text-gray-400 dark:text-white/50 hover:text-[#EC4141] p-0.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 transition-colors z-20 pointer-events-auto" title="显示主窗口">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>

      <transition name="slide-up">
        <div v-if="isCoverHovering && currentSong && !showMiniPlaylist" class="w-full flex justify-center pointer-events-none mt-1 z-40">
          <div class="px-3 py-1 bg-black/80 backdrop-blur-md rounded-lg text-white/90 text-xs font-medium max-w-[95%] truncate border border-white/10">
            {{ currentSong.title || currentSong.name }} - {{ currentSong.artist }}
          </div>
        </div>
      </transition>
    </div>

    <transition name="mini-queue">
      <div
        v-if="showMiniPlaylist"
        class="absolute left-0 right-0 top-[45px] bottom-0 z-30 bg-white/95 dark:bg-gray-900/95"
        :class="[isDarkTheme ? 'dark !bg-gray-900/95' : '!bg-white/95']"
      >
        <div class="h-full overflow-y-auto custom-scrollbar px-1.5 pt-0 pb-1.5">
          <div v-if="displayQueue.length === 0" class="h-full flex items-center justify-center text-xs text-gray-400 dark:text-white/30">
            暂无歌曲
          </div>

          <button
            v-for="(song, index) in displayQueue"
            :key="song.path + index"
            @click="sendAction({ type: 'play-song', song })"
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors"
            :class="currentSong?.path === song.path ? 'bg-[#EC4141]/10 text-[#EC4141]' : 'text-gray-700 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5'"
          >
            <div class="w-5 shrink-0 text-[10px] text-center" :class="currentSong?.path === song.path ? 'text-[#EC4141]' : 'text-gray-400 dark:text-white/30'">
              <svg v-if="currentSong?.path === song.path" xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mx-auto" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
              <span v-else>{{ index + 1 }}</span>
            </div>

            <div class="min-w-0 flex-1">
              <div class="text-xs truncate font-medium">{{ song.title || song.name.replace(/\.[^/.]+$/, '') }}</div>
              <div class="text-[10px] truncate" :class="currentSong?.path === song.path ? 'text-[#EC4141]/70' : 'text-gray-400 dark:text-white/30'">{{ song.artist || 'Unknown Artist' }}</div>
            </div>

            <div class="text-[10px] shrink-0" :class="currentSong?.path === song.path ? 'text-[#EC4141]/70' : 'text-gray-400 dark:text-white/30'">
              {{ formatDuration(song.duration) }}
            </div>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
  position: absolute;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}

.mini-queue-enter-active,
.mini-queue-leave-active {
  transition: all 0.25s ease;
}

.mini-queue-enter-from,
.mini-queue-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.marquee {
  display: inline-block;
  animation: marquee 10s linear infinite;
  padding-left: 100%;
}

@keyframes marquee {
  0% { transform: translate(0, 0); }
  100% { transform: translate(-100%, 0); }
}

.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(148, 163, 184, 0.35);
  border-radius: 3px;
}
</style>
