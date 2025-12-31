<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { useLyrics } from '../../composables/lyrics';
import DesktopLyrics from "../player/DesktopLyrics.vue";
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';

const { 
  currentSong, // 注意：我们这里不解构 currentCover，因为我们要自己获取
  isPlaying, volume, currentTime, playMode, showPlaylist,
  togglePlay, nextSong, prevSong, handleVolume, toggleMute, toggleMode, togglePlaylist,
  isFavorite, toggleFavorite,
  togglePlayerDetail, seekTo,
  settings
} = usePlayer();

const { showDesktopLyrics } = useLyrics();
const localCoverUrl = ref(''); // 本地封面 URL (Asset 协议)

const toggleLyrics = () => { showDesktopLyrics.value = !showDesktopLyrics.value; };

// 🎵 动态模糊计算
const footerBlurStyle = computed(() => {
  if (settings.value.theme.dynamicBgType !== 'none') return 'blur(20px) saturate(180%)';
  if (settings.value.theme.mode === 'custom') {
    const b = settings.value.theme.customBackground.blur;
    return b <= 0 ? 'none' : `blur(${b}px) saturate(180%)`;
  }
  return 'blur(20px) saturate(180%)';
});

// 🎵 监听歌曲变化，自动获取缩略图 (高性能)
watch(currentSong, async (newSong) => {
  if (newSong && newSong.path) {
    try {
      // 获取小图 (Thumbnail)
      const path = await invoke<string>('get_song_cover_thumbnail', { path: newSong.path });
      if (path) {
        localCoverUrl.value = convertFileSrc(path);
      } else {
        localCoverUrl.value = '';
      }
    } catch (e) {
      localCoverUrl.value = '';
    }
  } else {
    localCoverUrl.value = '';
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

const stopProgressDrag = async () => { 
  if (isDraggingProgress.value) { 
    await seekTo(dragTime.value); 
    isDraggingProgress.value = false; 
  } 
};

const updateProgressFromEvent = (e: MouseEvent) => {
  if (!progressBarRef.value || !currentSong.value) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  dragTime.value = (offsetX / rect.width) * currentSong.value.duration;
};

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

const startDrag = (e: MouseEvent) => { isDraggingVolume.value = true; updateVolume(e.clientY); };

const onGlobalMouseMove = (e: MouseEvent) => {
  if (isDraggingVolume.value) { e.preventDefault(); updateVolume(e.clientY); }
  if (isDraggingProgress.value) { e.preventDefault(); updateProgressFromEvent(e); }
};

const onGlobalMouseUp = () => {
  isDraggingVolume.value = false;
  stopProgressDrag();
};

// --- 音量滑块显示逻辑 ---
const showVolumeSlider = ref(false);
let volumeTimer: any = null;

const handleVolumeEnter = () => {
  if (volumeTimer) clearTimeout(volumeTimer);
  showVolumeSlider.value = true;
};

const handleVolumeLeave = () => {
  volumeTimer = setTimeout(() => {
    if (!isDraggingVolume.value) {
      showVolumeSlider.value = false;
    }
  }, 300);
};

onMounted(() => { 
  window.addEventListener('mousemove', onGlobalMouseMove); 
  window.addEventListener('mouseup', onGlobalMouseUp); 
});
onUnmounted(() => { 
  window.removeEventListener('mousemove', onGlobalMouseMove); 
  window.removeEventListener('mouseup', onGlobalMouseUp); 
});
</script>

<template>
  <footer 
    class="h-20 bg-transparent flex items-center justify-between px-4 z-50 relative select-none transition-colors duration-500"
    :style="{ backdropFilter: footerBlurStyle }"
  >
    
    <div 
      ref="progressBarRef"
      class="absolute top-[-1px] left-0 w-full h-[3px] hover:h-[5px] cursor-pointer group/progress z-50 transition-all duration-200"
      @mousedown="startProgressDrag"
      style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6));"
    >
       <div class="absolute inset-0 bg-transparent w-full h-full"></div>
       
       <div 
         class="absolute left-0 top-0 h-full bg-black/5 dark:bg-white/10 group-hover/progress:bg-black/15 dark:group-hover/progress:bg-white/20 transition-all duration-200 ease-linear relative rounded-r-full"
         :style="{ width: displayProgress + '%' }"
       >
          <div class="absolute right-[-6px] top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.1)] border border-white/20 opacity-0 group-hover/progress:opacity-100 transition-opacity transform scale-0 group-hover/progress:scale-100"></div>
       </div>
    </div>

    <div class="flex items-center w-1/3 min-w-[200px]">
      <div 
        @click="togglePlayerDetail"
        class="group relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border border-black/5 dark:border-white/5 cursor-pointer transition-transform active:scale-95 shadow-sm"
        title="展开详情页"
      >
        <span v-if="!currentSong" class="w-full h-full flex items-center justify-center bg-gray-100/50 dark:bg-white/5 text-[10px] text-gray-500 dark:text-white/60">CD</span>
        
        <img v-else-if="localCoverUrl" :src="localCoverUrl" class="w-full h-full object-cover group-hover:blur-[1px] transition-all" />
        
        <div v-else class="w-full h-full bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white text-[8px]">DISK</div>
        
        <div class="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </div>
      </div>

      <div class="ml-3 overflow-hidden flex-1" style="text-shadow: 0 1px 2px rgba(0,0,0,0.8);">
        <div class="flex items-center">
          <div class="text-sm font-medium text-gray-800 dark:text-white truncate cursor-pointer hover:underline shadow-sm">
            {{ currentSong ? (currentSong.title || currentSong.name.replace(/\.[^/.]+$/, "")) : '听我想听的音乐' }}
          </div>
          
          <button 
             v-if="currentSong" 
             @click="toggleFavorite(currentSong)"
             class="ml-2 focus:outline-none transition-transform active:scale-95"
             :title="isFavorite(currentSong) ? '取消收藏' : '添加到收藏'"
          >
            <svg v-if="isFavorite(currentSong)" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-[#EC4141]" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>
        </div>
        <div class="text-xs text-gray-500 dark:text-white/60 truncate cursor-pointer hover:text-gray-700 dark:hover:text-white mt-0.5">
          {{ currentSong ? currentSong.artist : 'My Music' }}
        </div>
      </div>
    </div>

    <div class="flex items-center justify-center flex-1 gap-6" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));">
      <button @click="toggleMode" class="text-gray-500 dark:text-white/60 hover:text-[#EC4141] dark:hover:text-[#EC4141] transition-colors" :title="['列表循环', '单曲循环', '随机播放'][playMode]">
        <svg v-if="playMode === 0" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        <svg v-else-if="playMode === 1" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /><text x="12" y="16" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1</text></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
      </button>

      <button @click="prevSong" class="text-gray-700 dark:text-white/80 hover:text-[#EC4141] transition-colors hover:scale-110 transform duration-200">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg>
      </button>

      <button @click="togglePlay" class="w-12 h-12 bg-transparent text-gray-800 dark:text-white hover:text-[#EC4141] dark:hover:text-[#EC4141] flex items-center justify-center transition-all hover:scale-110 active:scale-95">
        <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 fill-current ml-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
      </button>

      <button @click="nextSong" class="text-gray-700 dark:text-white/80 hover:text-[#EC4141] transition-colors hover:scale-110 transform duration-200">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
      </button>

      <button 
        @click="toggleLyrics"
        :class="['text-sm font-bold transition-colors', showDesktopLyrics ? 'text-[#EC4141]' : 'text-gray-400 dark:text-white/60 hover:text-gray-600 dark:hover:text-white']"
      >
        词
      </button>
    </div>

    <div class="flex items-center justify-end w-1/3 min-w-[150px] space-x-5 pr-2" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));"> 
      <div 
        class="relative flex items-center justify-center h-full z-[70]"
        @mouseenter="handleVolumeEnter"
        @mouseleave="handleVolumeLeave"
      >
        <!-- 音量滑块弹窗 -->
        <div 
          v-if="showVolumeSlider || isDraggingVolume"
          class="absolute bottom-full left-1/2 -translate-x-1/2 pb-3 z-[70]"
        >
          <!-- 透明桥接层：防止鼠标从图标移动到滑块时断触 -->
          <div class="absolute top-full left-0 w-full h-4"></div>
          
          <div class="w-9 h-32 bg-white/90 dark:bg-black/90 backdrop-blur-md shadow-2xl rounded-2xl border border-gray-100 dark:border-white/5 flex flex-col items-center justify-between py-3">
            <div class="text-[10px] text-gray-500 dark:text-white/60 font-bold select-none">{{ volume }}%</div>
            <div ref="volumeBarRef" class="relative flex-1 w-1.5 bg-gray-200 dark:bg-white/20 rounded-full cursor-pointer my-1" @mousedown="startDrag">
               <div class="absolute bottom-0 w-full bg-[#EC4141] rounded-full" :style="{ height: volume + '%' }"></div>
               <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-sm cursor-grab active:cursor-grabbing" :style="{ bottom: `calc(${volume}% - 7px)` }"></div>
            </div>
          </div>
        </div>
        <button @click="toggleMute" class="text-gray-500 dark:text-white/60 hover:text-gray-800 dark:hover:text-white p-2 rounded-full hover:bg-gray-100/50 dark:hover:bg-white/5 transition-colors"> 
          <svg v-if="volume === 0" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
        </button>
      </div>
      <button @click="togglePlaylist" class="text-gray-500 dark:text-white/60 hover:text-gray-800 dark:hover:text-white relative" :class="showPlaylist ? 'text-[#EC4141]' : ''">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
    </div>

    <DesktopLyrics />
  </footer>
</template>