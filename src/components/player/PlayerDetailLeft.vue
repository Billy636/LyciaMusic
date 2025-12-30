<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { usePlayer } from '../../composables/player';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

const { 
  currentSong, isPlaying, currentTime, playMode, volume,
  togglePlay, nextSong, prevSong, toggleMute, toggleMode,
  formatDuration, isFavorite, toggleFavorite,
  seekTo, openAddToPlaylistDialog,
  dominantColors, handleVolume,
  showQueue, toggleQueue
} = usePlayer();

const bigCoverUrl = ref('');

// 获取高清大图
watch(currentSong, async (newSong) => {
  if (newSong && newSong.path) {
    try {
      const path = await invoke<string>('get_song_cover', { path: newSong.path });
      if (path) {
        bigCoverUrl.value = convertFileSrc(path);
      } else {
        bigCoverUrl.value = '';
      }
    } catch (e) {
      bigCoverUrl.value = '';
    }
  } else {
    bigCoverUrl.value = '';
  }
}, { immediate: true });

// --- 进度条拖拽逻辑 ---
const isDraggingProgress = ref(false);
const progressBarRef = ref<HTMLElement | null>(null);
const dragTime = ref(0); 

const displayProgress = computed(() => {
  if (!currentSong.value) return 0;
  const time = isDraggingProgress.value ? dragTime.value : currentTime.value;
  return (time / currentSong.value.duration) * 100;
});

const startProgressDrag = (e: MouseEvent) => {
  isDraggingProgress.value = true;
  updateProgressFromEvent(e);
};

const updateProgressFromEvent = (e: MouseEvent) => {
  if (!progressBarRef.value || !currentSong.value) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  dragTime.value = (offsetX / rect.width) * currentSong.value.duration;
};

const stopProgressDrag = async () => {
  if (isDraggingProgress.value) {
    await seekTo(dragTime.value);
    isDraggingProgress.value = false;
  }
};

const onMouseMove = (e: MouseEvent) => {
  if (isDraggingProgress.value) {
    e.preventDefault();
    updateProgressFromEvent(e);
  }
};

const onMouseUp = () => {
  stopProgressDrag();
};

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
});

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
});

// 计算剩余时间
const remainingTime = computed(() => {
  if (!currentSong.value) return '-0:00';
  const time = isDraggingProgress.value ? dragTime.value : currentTime.value;
  const diff = currentSong.value.duration - time;
  return `-${formatDuration(diff)}`;
});
</script>

<template>
  <div class="flex flex-col items-center justify-between h-full w-full max-w-[540px] py-12 select-none">
    
    <!-- Block A: Album Art -->
    <div class="w-full flex justify-center items-center flex-1 min-h-0 mb-14">
      <div 
        class="relative aspect-square w-[90%] max-w-[480px] rounded-2xl overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
        :class="isPlaying ? 'scale-100' : 'scale-[0.88] opacity-80'"
        :style="{ 
          boxShadow: isPlaying 
            ? `0 30px 60px -12px rgba(0,0,0,0.6), 0 18px 36px -18px rgba(0,0,0,0.7), 0 0 80px -20px ${dominantColors[0]}44` 
            : `0 10px 20px -5px rgba(0,0,0,0.4)`
        }"
      >
        <img v-if="bigCoverUrl" :src="bigCoverUrl" class="w-full h-full object-cover select-none" draggable="false" />
        <div v-else class="w-full h-full bg-white/5 flex items-center justify-center text-white/10">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-32 w-32" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
        </div>
      </div>
    </div>

    <!-- Block B: Metadata & Actions -->
    <div class="w-full px-4 mb-4">
      <div class="flex items-end justify-between gap-4">
        <div class="flex flex-col min-w-0">
          <h1 class="text-[24px] font-bold text-white truncate leading-tight tracking-tight">{{ currentSong?.title || currentSong?.name || '未知歌曲' }}</h1>
          <p class="text-[17px] font-medium text-white/45 truncate leading-tight mt-1.5">{{ currentSong?.artist || '未知歌手' }}</p>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0 mb-1">
          <button 
            @click="currentSong && toggleFavorite(currentSong)" 
            class="p-2.5 rounded-full hover:bg-white/10 transition active:scale-90"
            :class="currentSong && isFavorite(currentSong) ? 'text-red-500' : 'text-white/60'"
          >
            <svg v-if="currentSong && isFavorite(currentSong)" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
          </button>
          <button 
            @click="currentSong && openAddToPlaylistDialog(currentSong.path)" 
            class="p-2.5 rounded-full hover:bg-white/10 transition text-white/60 active:scale-90"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Block C: Progress Section -->
    <div class="w-full px-4 mb-8">
      <div 
        ref="progressBarRef"
        class="w-full h-4 flex items-center cursor-pointer group/progress relative mb-1.5"
        @mousedown="startProgressDrag"
      >
        <div class="absolute w-full h-1 bg-white/15 rounded-full overflow-hidden">
          <div 
            class="h-full bg-white ease-linear"
            :class="isDraggingProgress ? 'transition-none' : 'transition-all duration-100'"
            :style="{ width: displayProgress + '%' }"
          ></div>
        </div>
        <!-- Thumb -->
        <div 
          class="absolute w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)] transition-transform group-hover/progress:scale-[2.5]"
          :style="{ left: `calc(${displayProgress}% - 3px)` }"
        ></div>
      </div>
      <div class="flex justify-between items-center px-0.5">
        <span class="text-[11px] font-semibold text-white/40 tabular-nums">{{ formatDuration(isDraggingProgress ? dragTime : currentTime) }}</span>
        
        <!-- Quality Label -->
        <div class="flex items-center gap-1 bg-white/10 px-1.5 py-0.5 rounded-[3px] text-[9px] font-bold text-white/50 tracking-tight">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="mr-0.5"><path d="M12 2v10"/><path d="m16 8-4 4-4-4"/><path d="M4 20h16"/></svg>
          HI-RES LOSSLESS
        </div>

        <span class="text-[11px] font-semibold text-white/40 tabular-nums">{{ remainingTime }}</span>
      </div>
    </div>

    <!-- Block D: Transport Controls -->
    <div class="w-full px-4 mb-6">
      <div class="flex items-center justify-between max-w-[420px] mx-auto">
        <!-- Shuffle Button -->
        <button 
          @click="playMode = (playMode === 2 ? 0 : 2)" 
          class="p-2 transition active:scale-90"
          :class="playMode === 2 ? 'text-red-400' : 'text-white/30'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
        </button>

        <div class="flex items-center gap-6">
          <button @click="prevSong" class="text-white hover:text-white/80 transition active:scale-90">
            <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          
          <button @click="togglePlay" class="w-20 h-20 bg-transparent text-white rounded-full flex items-center justify-center transition hover:scale-110 active:scale-90">
            <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="currentColor" class="ml-1"><path d="M8 5v14l11-7z"/></svg>
          </button>

          <button @click="nextSong" class="text-white hover:text-white/80 transition active:scale-90">
            <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6z"/></svg>
          </button>
        </div>

        <!-- Repeat Button -->
        <button 
          @click="playMode = (playMode === 1 ? 0 : 1)" 
          class="p-2 transition active:scale-90"
          :class="playMode === 1 || playMode === 0 ? 'text-red-400' : 'text-white/30'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
            <text v-if="playMode === 1" x="12" y="15" font-size="8" font-weight="bold" fill="currentColor" text-anchor="middle">1</text>
          </svg>
        </button>
      </div>
    </div>

    <!-- Block E: Footer Controls -->
    <div class="w-full px-8">
      <div class="flex items-center justify-between gap-6">
        
        <!-- Volume Control -->
        <div class="flex items-center gap-4 flex-1">
          <button @click="toggleMute" class="text-white/40 hover:text-white transition">
            <svg v-if="volume === 0" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path></svg>
          </button>
          
          <div class="flex-1 h-1.5 bg-white/15 rounded-full relative group/volume">
            <input 
              type="range" 
              :value="volume" 
              @input="handleVolume"
              min="0" 
              max="100" 
              class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div 
              class="absolute top-0 left-0 h-full bg-white/60 group-hover/volume:bg-white transition-colors rounded-full"
              :style="{ width: volume + '%' }"
            ></div>
            <!-- Volume Thumb -->
            <div 
              class="absolute w-3 h-3 bg-white rounded-full shadow-md top-1/2 -translate-y-1/2 -translate-x-1/2 opacity-0 group-hover/volume:opacity-100 transition-opacity"
              :style="{ left: volume + '%' }"
            ></div>
          </div>

          <button class="text-white/40 hover:text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          </button>
        </div>

        <!-- Queue Button -->
        <button 
          @click="toggleQueue" 
          class="p-2 rounded-lg transition active:scale-90"
          :class="showQueue ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'"
          title="播放队列"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
        </button>

      </div>
    </div>

  </div>
</template>

<style scoped>
/* 隐藏原生 range 样式，使用自定义样式 */
input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
}

input[type="range"]::-moz-range-thumb {
  width: 12px;
  height: 12px;
}
</style>