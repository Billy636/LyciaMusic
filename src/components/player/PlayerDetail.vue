<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { useLyrics } from '../../composables/lyrics';
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window'; 
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';

const { 
  currentSong, // 不解构 currentCover
  isPlaying, volume, currentTime, playMode, showPlaylist,
  togglePlay, nextSong, prevSong, handleVolume, toggleMute, toggleMode, togglePlaylist, formatDuration,
  isFavorite, toggleFavorite,
  showPlayerDetail, togglePlayerDetail,
  seekTo, openAddToPlaylistDialog,
  playAt 
} = usePlayer();

const { parsedLyrics, currentLyricIndex, showDesktopLyrics } = useLyrics();
const lyricsContainerRef = ref<HTMLElement | null>(null);

const bigCoverUrl = ref(''); // 全屏大图 URL

// 🎵 监听歌曲，获取高清大图 (Asset 协议)
watch(currentSong, async (newSong) => {
  if (newSong && newSong.path) {
    try {
      // 调用 get_song_cover 获取大图路径
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


// --- 窗口控制 ---
const appWindow = getCurrentWindow();
const minimize = () => appWindow.minimize();
const toggleMaximize = async () => { const isMax = await appWindow.isMaximized(); isMax ? appWindow.unmaximize() : appWindow.maximize(); };
const closeApp = () => appWindow.close();

// --- 歌词滚动优化 ---
watch(currentLyricIndex, (newIndex) => {
  if (!lyricsContainerRef.value || !showPlayerDetail.value || newIndex === -1) return;
  
  nextTick(() => {
    const activeEl = lyricsContainerRef.value?.querySelector(`[data-index="${newIndex}"]`) as HTMLElement;
    const container = lyricsContainerRef.value;
    
    if (activeEl && container) {
      const containerHeight = container.clientHeight;
      const elOffset = activeEl.offsetTop;
      const elHeight = activeEl.clientHeight;
      // 保持位置在 40% 处
      const targetScroll = elOffset - (containerHeight * 0.65) + (elHeight / 2);

      container.scrollTo({
        top: targetScroll,
        behavior: 'smooth' 
      });
    }
  });
});

watch(showPlayerDetail, (val) => {
  if (val) {
    nextTick(() => {
      if (currentLyricIndex.value !== -1) {
        const activeEl = lyricsContainerRef.value?.querySelector(`[data-index="${currentLyricIndex.value}"]`) as HTMLElement;
        const container = lyricsContainerRef.value;
        if (activeEl && container) {
           const targetScroll = activeEl.offsetTop - (container.clientHeight * 0.65);
           container.scrollTo({ top: targetScroll });
        }
      }
    });
  }
});

const toggleLyrics = () => { showDesktopLyrics.value = !showDesktopLyrics.value; };

// --- 进度条拖拽 ---
const isDraggingProgress = ref(false);
const progressBarRef = ref<HTMLElement | null>(null);
const dragTime = ref(0); 
const displayProgress = computed(() => {
  if (!currentSong.value) return 0;
  const time = isDraggingProgress.value ? dragTime.value : currentTime.value;
  return (time / currentSong.value.duration) * 100;
});
const startProgressDrag = (e: MouseEvent) => { isDraggingProgress.value = true; updateProgressFromEvent(e); };
const stopProgressDrag = async () => { if (isDraggingProgress.value) { await seekTo(dragTime.value); isDraggingProgress.value = false; } };
const updateProgressFromEvent = (e: MouseEvent) => {
  if (!progressBarRef.value || !currentSong.value) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  dragTime.value = (offsetX / rect.width) * currentSong.value.duration;
};

// --- 音量拖拽 ---
const isDraggingVolume = ref(false);
const volumeBarRef = ref<HTMLElement | null>(null);
const updateVolume = (clientY: number) => { if (!volumeBarRef.value) return; const rect = volumeBarRef.value.getBoundingClientRect(); const height = rect.height; const distance = rect.bottom - clientY; const percent = Math.max(0, Math.min(1, distance / height)); const newVol = Math.round(percent * 100); handleVolume({ target: { value: newVol.toString() } } as any); };
const startDrag = (e: MouseEvent) => { isDraggingVolume.value = true; updateVolume(e.clientY); };
const onMouseMove = (e: MouseEvent) => { 
  if (isDraggingVolume.value) { e.preventDefault(); updateVolume(e.clientY); }
  if (isDraggingProgress.value) { e.preventDefault(); updateProgressFromEvent(e); } 
};
const stopDrag = () => { isDraggingVolume.value = false; stopProgressDrag(); };

onMounted(() => { window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', stopDrag); });
onUnmounted(() => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', stopDrag); });

</script>

<template>
  <transition name="expand-up">
    <div v-if="showPlayerDetail" class="fixed inset-0 z-[100] bg-[#fafafa] flex flex-col overflow-hidden font-sans select-none">
      
      <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-3xl z-10"></div>
        <img :src="bigCoverUrl || ''" class="w-full h-full object-cover opacity-60 filter blur-[60px] scale-125" />
      </div>

      <div class="relative z-50 h-16 flex items-center justify-between px-4">
        <div class="absolute inset-0" data-tauri-drag-region></div>

        <div class="flex items-center relative z-10">
          <button @click="togglePlayerDetail" class="p-2 hover:bg-white/10 rounded-lg transition text-white/80 hover:text-white" title="收起详情页">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </button>
        </div>
        <div class="flex-1 h-full"></div>
        <div class="flex items-center gap-2 relative z-10">
          <button @click="minimize" class="p-2 hover:bg-white/10 rounded-lg transition text-white/80 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14" /></svg></button>
          <button @click="toggleMaximize" class="p-2 hover:bg-white/10 rounded-lg transition text-white/80 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg></button>
          <button @click="closeApp" class="p-2 hover:bg-red-500 rounded-lg transition text-white/80 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
        </div>
      </div>

      <div class="relative z-20 flex-1 flex items-center gap-16 px-16 pb-4 min-h-0">
        <div class="w-[320px] flex-shrink-0 flex flex-col items-center">
          <div class="w-[320px] h-[320px] relative flex items-center justify-center">
            <div class="absolute top-[-60px] left-[150px] w-20 h-32 z-30 transition-transform duration-500 origin-top-left pointer-events-none" :class="isPlaying ? 'rotate-0' : '-rotate-30'">
               <div class="w-1.5 h-20 bg-gray-300 absolute left-1/2 rounded-full border border-gray-400"></div>
               <div class="w-4 h-6 bg-gray-200 absolute bottom-0 left-1/2 -translate-x-1/2 rounded shadow-md"></div>
            </div>
            <div class="w-full h-full rounded-full bg-black flex items-center justify-center shadow-2xl border-4 border-gray-800/30" :class="isPlaying ? 'animate-spin-slow' : ''" :style="{ animationPlayState: isPlaying ? 'running' : 'paused' }">
              <div class="w-52 h-52 rounded-full overflow-hidden border-[6px] border-black">
                <img v-if="bigCoverUrl" :src="bigCoverUrl" class="w-full h-full object-cover" />
                <div v-else class="w-full h-full bg-gray-800 flex items-center justify-center text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex-1 h-[550px] flex flex-col items-start text-left min-w-0">
          <div class="mb-6 w-full mt-16">
            <h1 class="text-3xl font-bold text-white mb-2 drop-shadow-md truncate">{{ currentSong?.title || currentSong?.name }}</h1>
            <div class="flex items-center gap-3 text-gray-300 text-sm">
              <span class="truncate max-w-[200px]" title="专辑">专辑：{{ currentSong?.album || '未知' }}</span>
              <span class="w-[1px] h-3 bg-gray-500"></span>
              <span class="truncate max-w-[200px]" title="歌手">歌手：{{ currentSong?.artist || '未知' }}</span>
            </div>
          </div>
          
          <div ref="lyricsContainerRef" class="flex-1 w-full overflow-y-auto custom-scrollbar mask-gradient pr-4">
            <div class="py-[200px] space-y-8">
              <div 
                v-for="(line, index) in parsedLyrics" 
                :key="index" 
                :data-index="index"
                class="transition-all duration-300 cursor-pointer origin-left hover:text-white hover:scale-105"
                :class="index === currentLyricIndex ? 'text-3xl font-bold text-white active-lyric' : 'text-base text-gray-400'"
                @click="playAt(line.time)" 
              >
                <div>{{ line.text }}</div>
                <div v-if="line.translation" class="text-sm mt-1 opacity-80 font-normal">{{ line.translation }}</div>
              </div>
              
              <div v-if="parsedLyrics.length === 0" class="text-gray-400 mt-20">暂无歌词</div>
            </div>
          </div>
        </div>
      </div>

      <div class="relative z-50 px-8 pb-6 flex flex-col gap-2">
        
        <div 
          ref="progressBarRef"
          class="w-full h-4 flex items-center cursor-pointer group/progress relative"
          @mousedown="startProgressDrag"
        >
           <div class="absolute w-full h-[2px] bg-white/10 group-hover/progress:h-[4px] rounded-full transition-all duration-200"></div>
           <div 
             class="absolute h-[2px] group-hover/progress:h-[4px] bg-gradient-to-r from-white/20 to-white rounded-full transition-all duration-200 pointer-events-none"
             :style="{ width: displayProgress + '%' }"
           ></div>
           <div 
             class="absolute w-3 h-3 bg-white rounded-full shadow-lg transform scale-0 group-hover/progress:scale-100 transition-transform duration-200 origin-center pointer-events-none"
             :style="{ left: displayProgress + '%' }"
             style="transform: translate(-50%, 0) scale(var(--tw-scale-x));"
           ></div>
        </div>

        <div class="flex items-center justify-between">
          
          <div class="flex items-center w-1/4 gap-4">
             <button v-if="currentSong" @click="toggleFavorite(currentSong)" class="text-white/60 hover:text-white transition transform active:scale-90">
               <svg v-if="isFavorite(currentSong)" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#EC4141]" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" /></svg>
               <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
             </button>
             
             <button v-if="currentSong" @click="openAddToPlaylistDialog(currentSong.path)" class="text-white/60 hover:text-white transition transform active:scale-90" title="添加到歌单">
               <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
             </button>

             <div class="text-sm font-medium text-gray-400 font-mono tracking-wider ml-2">
               {{ isDraggingProgress ? formatDuration(dragTime) : formatDuration(currentTime) }} / {{ currentSong ? formatDuration(currentSong.duration) : '--:--' }}
             </div>
          </div>

          <div class="flex items-center gap-8">
              <button @click="toggleMode" class="text-white/70 hover:text-white transition" :title="['列表循环', '单曲循环', '随机播放'][playMode]">
                <svg v-if="playMode === 0" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                <svg v-else-if="playMode === 1" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /><text x="12" y="16" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1</text></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
              </button>

              <button @click="prevSong" class="text-white/80 hover:text-white transition transform active:scale-90"><svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg></button>
              
              <button @click="togglePlay" class="w-14 h-14 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition transform active:scale-95 shadow-lg backdrop-blur-sm border border-white/10">
                <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 text-white ml-1" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              </button>

              <button @click="nextSong" class="text-white/80 hover:text-white transition transform active:scale-90"><svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg></button>

              <button @click="toggleLyrics" :class="['text-sm font-bold transition-colors', showDesktopLyrics ? 'text-[#EC4141]' : 'text-white/70 hover:text-white']" title="桌面歌词">词</button>
          </div>

          <div class="flex items-center w-1/4 justify-end gap-5">
             <div class="relative group flex items-center justify-center">
                <div class="absolute bottom-full left-1/2 -translate-x-1/2 pb-3 hidden group-hover:block hover:block z-50">
                  <div class="w-8 h-28 bg-black/80 backdrop-blur rounded-full flex flex-col items-center justify-between py-3 shadow-xl">
                    <div ref="volumeBarRef" class="relative flex-1 w-1 bg-white/30 rounded-full cursor-pointer my-1" @mousedown="startDrag">
                       <div class="absolute bottom-0 w-full bg-[#EC4141] rounded-full" :style="{ height: volume + '%' }"></div>
                       <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow-sm cursor-grab active:cursor-grabbing" :style="{ bottom: `calc(${volume}% - 6px)` }"></div>
                    </div>
                  </div>
                </div>
                <button @click="toggleMute" class="text-white/60 hover:text-white transition"> 
                  <svg v-if="volume === 0" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path stroke-linecap="round" stroke-linejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                </button>
             </div>
             <button @click="togglePlaylist" class="text-white/60 hover:text-white transition" :class="showPlaylist ? 'text-[#EC4141]' : ''">
               <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
             </button>
          </div>

        </div>
      </div>

    </div>
  </transition>
</template>

<style scoped>
.expand-up-enter-active,
.expand-up-leave-active {
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  /* 40px left, 40px from bottom - aligned with the footer cover */
  transform-origin: 40px calc(100% - 40px);
  will-change: transform, opacity;
}

.expand-up-enter-from,
.expand-up-leave-to {
  transform: translate3d(0, 100%, 0) scale(0.3);
  opacity: 0;
  border-radius: 100%;
}

/* 歌词容器遮罩：让顶部和底部边缘平滑消失 */
.mask-gradient {
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 15%,
    black 85%,
    transparent 100%
  );
}

.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.animate-spin-slow {
  animation: spin-slow 20s linear infinite;
}
</style>