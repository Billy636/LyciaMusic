<script setup lang="ts">
import { AudioLines, Eye, EyeOff, SlidersHorizontal } from 'lucide-vue-next';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { useLyrics } from '../../composables/lyrics';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import AudioVisualizer from '../player/AudioVisualizer.vue';
import FooterContextMenu from "../overlays/FooterContextMenu.vue";
import EqualizerPanel from '../player/EqualizerPanel.vue';
import { useSettings } from '../../features/settings/useSettings';
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import type { RemoteDownloadProgress } from '../../types';
import {
  FOOTER_PROGRESS_HIDDEN_KEY,
  getProgressVisualState,
  readStoredProgressHidden
} from './playerFooterProgress';

const { 
  currentSong,
  isPlaying, volume, currentTime, playMode, showPlaylist, showPlayerDetail,
  togglePlay, nextSong, prevSong, handleVolume, handleVolumeWheel, toggleMute, toggleMode, togglePlaylist,
  togglePlayerDetail, seekTo, formatDuration
} = usePlaybackController();
const { isFavorite, toggleFavorite } = useLibraryCollections();

const handleOpenDetail = () => {
  togglePlayerDetail();
};

const { showDesktopLyrics, showLyricsPlayerSettingsPanel } = useLyrics();

// --- Context Menu State ---
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);

const handleContextMenu = (e: MouseEvent) => {
  if (!currentSong.value) return;
  e.preventDefault();
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

const toggleLyrics = () => { showDesktopLyrics.value = !showDesktopLyrics.value; };
const toggleLyricsPlayerSettings = () => {
  showLyricsPlayerSettingsPanel.value = !showLyricsPlayerSettingsPanel.value;
};
const isVisualizerEnabled = ref(localStorage.getItem('footer_visualizer_enabled') !== 'false');
const isProgressHidden = ref(readStoredProgressHidden(localStorage));
const remoteDownloadProgress = ref<RemoteDownloadProgress | null>(null);
let unlistenRemoteDownload: UnlistenFn | null = null;

const toggleVisualizer = () => {
  isVisualizerEnabled.value = !isVisualizerEnabled.value;
  localStorage.setItem('footer_visualizer_enabled', isVisualizerEnabled.value.toString());
};

const toggleProgressVisibility = () => {
  isProgressHidden.value = !isProgressHidden.value;
  localStorage.setItem(FOOTER_PROGRESS_HIDDEN_KEY, isProgressHidden.value.toString());
};

// 不再使用单独的模糊样式 -> 全透明

// --- 进度条拖拽逻辑 ---
const isDraggingProgress = ref(false);
const progressBarRef = ref<HTMLElement | null>(null);
const dragTime = ref(0); 

const displayProgress = computed(() => {
  if (!currentSong.value || currentSong.value.duration <= 0) return 0;
  const time = isDraggingProgress.value ? dragTime.value : currentTime.value;
  return Math.max(0, Math.min(100, (time / currentSong.value.duration) * 100));
});

const progressFillClass = computed(() => (
  showPlayerDetail.value
    ? 'bg-zinc-300/30'
    : 'bg-zinc-300/30'
));

const progressTrackClass = computed(() => (
  showPlayerDetail.value
    ? 'bg-transparent'
    : 'bg-transparent'
));

const progressThumbClass = computed(() => (
  showPlayerDetail.value
    ? 'border-white/45 bg-white'
    : 'border-black/10 dark:border-white/20 bg-white'
));

const progressVisualState = computed(() => getProgressVisualState(isProgressHidden.value, isDraggingProgress.value));

const startProgressDrag = (e: PointerEvent) => { 
  if (!currentSong.value || currentSong.value.duration <= 0) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  isDraggingProgress.value = true; 
  updateProgressFromEvent(e); 
};

const stopProgressDrag = async (commit = true) => { 
  if (isDraggingProgress.value) { 
    const targetTime = dragTime.value;
    isDraggingProgress.value = false; 
    if (commit) {
      await seekTo(targetTime);
    }
  } 
};

const updateProgressFromEvent = (e: PointerEvent) => {
  if (!progressBarRef.value || !currentSong.value || currentSong.value.duration <= 0) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  dragTime.value = (offsetX / rect.width) * currentSong.value.duration;
};

// 计算总时长与当前时间
const currentTimeStr = computed(() => formatDuration(isDraggingProgress.value ? dragTime.value : currentTime.value));
const totalTimeStr = computed(() => currentSong.value ? formatDuration(currentSong.value.duration) : '0:00');
const isCurrentRemoteDownloadActive = computed(() => {
  const progress = remoteDownloadProgress.value;
  return !!progress
    && !progress.done
    && !!currentSong.value
    && progress.uri === currentSong.value.path;
});
const remoteDownloadText = computed(() => {
  const progress = remoteDownloadProgress.value;
  if (!progress || progress.percent === null) return '正在加载远程歌曲';
  return `正在加载远程歌曲 ${Math.round(progress.percent)}%`;
});

// --- 音量拖拽逻辑 ---
const isDraggingVolume = ref(false);
const volumeBarRef = ref<HTMLElement | null>(null);

const updateVolume = (clientY: number) => {
  if (!volumeBarRef.value) return;
  const rect = volumeBarRef.value.getBoundingClientRect();
  const height = rect.height;
  const distance = rect.bottom - clientY;
  const percent = Math.max(0, Math.min(1, distance / height));
  const newVol = Math.round(percent * 100);
  handleVolume({ target: { value: newVol.toString() } } as any);
};

const startDrag = (e: PointerEvent) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  isDraggingVolume.value = true;
  updateVolume(e.clientY);
};

const onGlobalPointerMove = (e: PointerEvent) => {
  if (isDraggingVolume.value) { e.preventDefault(); updateVolume(e.clientY); }
  if (isDraggingProgress.value) { e.preventDefault(); updateProgressFromEvent(e); }
};

const onGlobalPointerEnd = (commitProgress = true) => {
  isDraggingVolume.value = false;
  stopProgressDrag(commitProgress);
};

const onGlobalPointerUp = () => onGlobalPointerEnd(true);
const onGlobalPointerCancel = () => onGlobalPointerEnd(false);

// --- 音量滑块显示逻辑 ---
const showVolumeSlider = ref(false);
let volumeTimer: any = null;

const handleVolumeEnter = () => {
  if (volumeTimer) clearTimeout(volumeTimer);
  showVolumeSlider.value = true;
  handleFooterMouseEnter(); // Also stop idle timer
};

const handleVolumeLeave = () => {
  volumeTimer = setTimeout(() => {
    if (!isDraggingVolume.value) {
      showVolumeSlider.value = false;
      // If we left the volume slider, check if we should start footer idle timer
      startIdleTimer();
    }
  }, 300);
};

// --- EQ Panel State ---
const showEqPanel = ref(false);
const eqButtonRef = ref<HTMLElement | null>(null);
const eqPanelRef = ref<HTMLElement | null>(null);

const { settings } = useSettings();

watch(
  () => settings.value.audio.showEqualizerInFooter,
  (show) => {
    if (show === false) {
      showEqPanel.value = false;
    }
  }
);

const toggleEqPanel = (e: MouseEvent) => {
  e.stopPropagation();
  showEqPanel.value = !showEqPanel.value;
};

const handleWindowClick = (e: MouseEvent) => {
  if (showEqPanel.value && eqPanelRef.value && eqButtonRef.value) {
    const target = e.target as HTMLElement;
    if (!eqPanelRef.value.contains(target) && !eqButtonRef.value.contains(target)) {
      showEqPanel.value = false;
    }
  }
};

// --- Idle State for Auto-Hide ---
const isPinned = ref(localStorage.getItem('footer_pinned') === 'true');
const isIdle = ref(false);
let idleTimer: any = null;

const togglePin = () => {
  isPinned.value = !isPinned.value;
  localStorage.setItem('footer_pinned', isPinned.value.toString());
  if (!isPinned.value) {
    startIdleTimer();
  } else {
    isIdle.value = false;
    if (idleTimer) clearTimeout(idleTimer);
  }
};

const startIdleTimer = () => {
  if (idleTimer) clearTimeout(idleTimer);
  // Do not hide if context menu, dragging, or volume slider is active
  if (showContextMenu.value || isDraggingProgress.value || isDraggingVolume.value || showVolumeSlider.value || isPinned.value) return;
  
  idleTimer = setTimeout(() => {
    isIdle.value = true;
  }, 2000);
};

const handleFooterMouseEnter = () => {
  isIdle.value = false;
  if (idleTimer) clearTimeout(idleTimer);
};

const handleFooterMouseMove = () => {
  if (isIdle.value) isIdle.value = false;
  if (idleTimer) clearTimeout(idleTimer);
};

const handleFooterMouseLeave = () => {
  startIdleTimer();
};

onMounted(async () => { 
  window.addEventListener('pointermove', onGlobalPointerMove); 
  window.addEventListener('pointerup', onGlobalPointerUp); 
  window.addEventListener('pointercancel', onGlobalPointerCancel); 
  window.addEventListener('click', handleWindowClick); 
  startIdleTimer(); // Start initial idle timer
  unlistenRemoteDownload = await listen<RemoteDownloadProgress>('remote-download-progress', event => {
    remoteDownloadProgress.value = event.payload;
  });
});
onUnmounted(() => { 
  window.removeEventListener('pointermove', onGlobalPointerMove); 
  window.removeEventListener('pointerup', onGlobalPointerUp); 
  window.removeEventListener('pointercancel', onGlobalPointerCancel); 
  window.removeEventListener('click', handleWindowClick); 
  if (idleTimer) clearTimeout(idleTimer);
  unlistenRemoteDownload?.();
  unlistenRemoteDownload = null;
});
</script>

<template>
  <footer 
    class="h-20 flex items-center justify-between px-4 z-[60] relative select-none bg-transparent"
    @mouseenter="handleFooterMouseEnter"
    @mousemove="handleFooterMouseMove"
    @mouseleave="handleFooterMouseLeave"
  >
    
    <div
      v-if="showPlayerDetail && currentSong && isVisualizerEnabled"
      class="pointer-events-none absolute left-5 right-5 top-[-76px] h-16 z-40 transition-opacity duration-500 [mask-image:linear-gradient(90deg,transparent,black_1.5%,black_98.5%,transparent)]"
      :class="isIdle ? 'opacity-25' : 'opacity-100'"
    >
      <AudioVisualizer
        :active="showPlayerDetail && isVisualizerEnabled"
        :is-playing="isPlaying"
        :song-path="currentSong.path"
      />
    </div>

    <div 
      ref="progressBarRef"
      class="absolute top-[-10px] left-0 w-full h-[22px] cursor-pointer group/progress z-50 [touch-action:none]"
      @pointerdown="startProgressDrag"
    >
      <div class="absolute inset-y-0 left-0 right-0 flex items-center">
        <div
          class="relative w-full rounded-full transition-[height] duration-200"
          :class="isDraggingProgress ? 'h-[5px]' : 'h-[2px] group-hover/progress:h-[5px]'"
        >
          <div class="absolute inset-0 rounded-full transition-colors duration-200" :class="progressTrackClass"></div>
          <div
            class="absolute inset-y-0 left-0 rounded-full transition-[background-color,opacity] duration-200 overflow-visible"
            :class="[progressFillClass, progressVisualState.trackClass]"
            :style="{ width: displayProgress + '%' }"
          >
            <!-- 白色滑块圆球 (Thumb) -->
            <div
              class="absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 translate-x-1/2 rounded-full transition-all duration-150 z-40 border shadow-[0_2.5px_6px_rgba(0,0,0,0.15)]"
              :class="[progressThumbClass, isDraggingProgress && !isProgressHidden ? 'opacity-100 scale-100' : progressVisualState.thumbClass]"
            ></div>

            <!-- 拖拽时间提示气泡的外层定位容器 (与白色滑块平级) -->
            <div 
              class="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-0 h-0 overflow-visible pointer-events-none z-50"
            >
              <!-- 内层负责 Vue transition 精致动画，物理定位通过 left-[-42px] 与 transform 解耦 -->
              <transition name="fade-scale">
                <div
                  v-if="isDraggingProgress && !isProgressHidden"
                  class="absolute bottom-4 left-[-42px] w-[84px] px-2 py-0.5 rounded-md bg-zinc-900/95 text-white text-[10px] font-semibold font-mono tracking-wider whitespace-nowrap shadow-lg border border-white/10 backdrop-blur-sm pointer-events-none select-none flex items-center justify-center text-center"
                >
                  {{ currentTimeStr }}/{{ totalTimeStr }}
                  <!-- 气泡下方的微型三角指针 -->
                  <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] border-x-4 border-t-4 border-x-transparent border-t-zinc-900/95"></div>
                </div>
              </transition>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="flex items-center w-1/3 min-w-[200px]" @contextmenu="handleContextMenu">
      <div 
        ref="footerCoverRef"
        data-footer-cover
        @click="handleOpenDetail"
        class="group relative w-12 h-12 rounded-lg flex-shrink-0 cursor-pointer active:scale-95 z-10"
      >
      </div>

      <div 
        class="ml-3 overflow-hidden flex-1 relative h-10 transition-transform duration-500" 
        :class="showPlayerDetail ? '-translate-x-[60px]' : 'translate-x-[0px]'"
      >
        <!-- State A: Default View (Title & Artist) -->
        <div 
          class="absolute inset-0 flex flex-col justify-center transition-all duration-500"
          :class="showPlayerDetail ? 'opacity-0 translate-y-4 pointer-events-none' : 'opacity-100 translate-y-0 text-gray-800 dark:text-white'"
        >
          <div class="flex items-center">
            <div class="text-sm font-bold tracking-wide truncate pr-2 cursor-default">
              {{ currentSong ? (currentSong.title || currentSong.name.replace(/\.[^/.]+$/, "")) : '听我想听的音乐' }}
            </div>
            <button 
               v-if="currentSong" 
               @click="toggleFavorite(currentSong)"
               class="focus:outline-none transition-transform active:scale-95"
               :title="isFavorite(currentSong) ? '取消收藏' : '添加到收藏'"
            >
              <svg v-if="isFavorite(currentSong)" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-[#EC4141]" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" />
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" 
                class="h-4 w-4 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white transition-colors" 
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>
          </div>
          <div class="text-[11px] font-medium mt-0.5 cursor-default truncate text-gray-500 dark:text-gray-400">
            {{ isCurrentRemoteDownloadActive ? remoteDownloadText : (currentSong ? currentSong.artist : 'My Music') }}
          </div>
        </div>

        <!-- State B: Player Detail View (Progress) -->
        <div 
          class="absolute inset-0 flex flex-col justify-center transition-all duration-500"
          :class="showPlayerDetail ? 'opacity-100 translate-y-0 text-white/90' : 'opacity-0 -translate-y-4 pointer-events-none'"
        >
          <div class="text-[12px] font-semibold tabular-nums cursor-default tracking-wide">
            {{ currentTimeStr }} <span class="opacity-50 mx-1">/</span> {{ totalTimeStr }}
          </div>
        </div>
      </div>
    </div>

    <div 
      class="flex items-center justify-center flex-1 gap-6 transition-opacity duration-700"
      :class="{ 'opacity-0 pointer-events-none': isIdle }"
    >
      <button
        v-if="showPlayerDetail"
        @mousedown.stop
        @click.stop="toggleLyricsPlayerSettings"
        class="flex items-center justify-center text-base font-semibold tracking-[0.02em] transition-colors"
        :class="showLyricsPlayerSettingsPanel
          ? 'text-white'
          : 'text-white/60 hover:text-white'"
        title="歌词样式"
      >
        A
      </button>

      <button @click="toggleMode" class="transition-colors" 
        :class="showPlayerDetail ? 'text-white/80 hover:text-white' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white'"
        :title="['列表循环', '单曲循环', '随机播放'][playMode]">
        <svg v-if="playMode === 0" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        <svg v-else-if="playMode === 1" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /><text x="12" y="16" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1</text></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
      </button>

      <button @click="prevSong" 
        class="transition-colors hover:scale-110 transform duration-200"
        :class="showPlayerDetail ? 'text-white/80 hover:text-white' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white'"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg>
      </button>

      <button @click="togglePlay" 
        class="flex items-center justify-center transition-all active:scale-95 shrink-0 w-11 h-11 rounded-full border"
        :class="showPlayerDetail 
          ? 'text-white bg-white/10 hover:bg-white/20 border-white/5' 
          : 'text-gray-800 dark:text-white bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 border-black/5 dark:border-white/5'"
      >
        <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 fill-current" viewBox="0 0 24 24"><path d="M8.3 5v14l11-7z" /></svg>
      </button>

      <button @click="nextSong" 
        class="transition-colors hover:scale-110 transform duration-200"
        :class="showPlayerDetail ? 'text-white/80 hover:text-white' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white'"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
      </button>

      <button @click="togglePlaylist" 
        class="transition-colors hover:scale-110 transform duration-200"
        :class="showPlaylist ? 'text-[#EC4141]' : (showPlayerDetail ? 'text-white/80 hover:text-white' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white')"
        title="播放队列"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
      </button>
    </div>

    <div 
      class="flex items-center justify-end w-1/3 min-w-[150px] gap-2 pr-2 transition-opacity duration-700"
      :class="{ 'opacity-0 pointer-events-none': isIdle }"
    > 
      <div 
        class="relative flex items-center justify-center h-full z-[70]"
        @mouseenter="handleVolumeEnter"
        @mouseleave="handleVolumeLeave"
        @wheel.prevent.stop="handleVolumeWheel"
      >
        <!-- 音量滑块弹窗 -->
        <div 
          v-if="showVolumeSlider || isDraggingVolume"
          class="absolute bottom-full left-1/2 -translate-x-1/2 pb-3 z-[70]"
        >
          <!-- 透明桥接层：防止鼠标从图标移动到滑块时断触 -->
          <div class="absolute top-full left-0 w-full h-4"></div>
          
          <div class="w-9 h-32 backdrop-blur-md shadow-2xl rounded-2xl border flex flex-col items-center justify-between py-3 transition-colors"
            :class="showPlayerDetail ? 'bg-black/90 border-white/5' : 'bg-white/90 dark:bg-black/90 border-gray-100 dark:border-white/5'"
          >
            <div class="text-[10px] font-bold select-none transition-colors"
              :class="showPlayerDetail ? 'text-white/60' : 'text-gray-500 dark:text-white/60'"
            >{{ volume }}%</div>
            <div ref="volumeBarRef" class="relative flex-1 w-1.5 rounded-full cursor-pointer my-1 transition-colors [touch-action:none]" 
                 :class="showPlayerDetail ? 'bg-white/20' : 'bg-gray-200 dark:bg-white/20'"
                 @pointerdown="startDrag">
               <div class="absolute bottom-0 w-full bg-[#EC4141] rounded-full" :style="{ height: volume + '%' }"></div>
               <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-sm cursor-grab active:cursor-grabbing" :style="{ bottom: `calc(${volume}% - 7px)` }"></div>
            </div>
          </div>
        </div>
        <button @click="toggleMute" 
          class="transition-colors flex items-center justify-center shrink-0 w-8 h-8 rounded-full"
          :class="showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'"
          title="音量"
        > 
          <!-- 静音 -->
          <svg v-if="volume === 0" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
          <!-- 弱音量 -->
          <svg v-else-if="volume > 0 && volume < 30" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg>
          <!-- 中音量 -->
          <svg v-else-if="volume >= 30 && volume < 70" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          <!-- 大音量 -->
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
        </button>
      </div>

      <button
        v-if="showPlayerDetail"
        @click="toggleProgressVisibility"
        :class="['transition-colors w-8 h-8 flex items-center justify-center rounded-full', isProgressHidden ? 'text-[#EC4141] bg-[#EC4141]/10' : 'text-white/60 hover:text-white hover:bg-white/10']"
        :title="isProgressHidden ? '显示进度条' : '隐藏进度条'"
      >
        <EyeOff v-if="isProgressHidden" class="h-4 w-4" :stroke-width="2.2" />
        <Eye v-else class="h-4 w-4" :stroke-width="2.2" />
      </button>

      <button
        v-if="showPlayerDetail"
        @click="toggleVisualizer"
        :class="['transition-colors w-8 h-8 flex items-center justify-center rounded-full', isVisualizerEnabled ? 'text-[#EC4141] bg-[#EC4141]/10' : 'text-white/60 hover:text-white hover:bg-white/10']"
        :title="isVisualizerEnabled ? '关闭可视化' : '开启可视化'"
      >
        <AudioLines class="h-4 w-4" :stroke-width="2.2" />
      </button>
      
      <button 
        @click="toggleLyrics"
        :class="['text-[14px] font-bold transition-colors w-8 h-8 flex items-center justify-center rounded-full', showDesktopLyrics ? 'text-[#EC4141] bg-[#EC4141]/10' : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')]"
        title="桌面歌词"
      >
        词
      </button>

      <!-- 均衡器按钮与弹出面板 -->
      <div v-if="settings.audio.showEqualizerInFooter !== false" class="relative flex items-center justify-center h-full z-[70]">
        <button 
          ref="eqButtonRef"
          @click="toggleEqPanel"
          :class="['transition-colors w-8 h-8 flex items-center justify-center rounded-full', showEqPanel ? 'text-[#EC4141] bg-[#EC4141]/10' : (showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10')]"
          title="均衡器 (EQ)"
        >
          <SlidersHorizontal class="h-4 w-4" :stroke-width="2.2" />
        </button>

        <transition name="fade-scale">
          <div 
            v-if="showEqPanel"
            ref="eqPanelRef"
            class="absolute bottom-full right-[-10px] pb-4.5 z-[80] filter drop-shadow-[0_8px_20px_rgba(0,0,0,0.15)]"
          >
            <!-- 极富流动感、平滑贝塞尔圆弧的气泡指引尾巴 -->
            <svg width="32" height="10" viewBox="0 0 32 10" class="absolute bottom-[9px] right-[10px] text-[#FFFFFF] dark:text-[#1E1E1E] fill-current z-[81] overflow-visible">
              <path d="M0,0 C8,0 12,8 16,10 C20,8 24,0 32,0 Z" />
              <path d="M0,0 C8,0 12,8 16,10 C20,8 24,0 32,0" fill="none" class="stroke-gray-100 dark:stroke-gray-800" stroke-width="1" />
            </svg>
            
            <EqualizerPanel />
          </div>
        </transition>
      </div>

      <button @click="togglePin"
        class="transition-colors w-8 h-8 flex items-center justify-center rounded-full"
        :class="showPlayerDetail ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-700 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'"
        :title="isPinned ? '取消固定 (当前已常驻)' : '固定状态栏 (当前离开后消失)'"
      >
        <!-- 已固定：完整图钉 -->
        <svg v-if="isPinned" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
        <!-- 未固定：带取消斜线的图钉 -->
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-.82"/><path d="M12 17v5"/><path d="M15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0-1.16.37"/></svg>
      </button>
    </div>
        <FooterContextMenu 

          :visible="showContextMenu" 

          :x="contextMenuX" 

          :y="contextMenuY" 

          :song="currentSong"

          @close="showContextMenu = false"

        />

      </footer>

    </template>

<style scoped>
/* 拖拽气泡进入与离开的动画过渡 */
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: opacity 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.85);
}
</style>
