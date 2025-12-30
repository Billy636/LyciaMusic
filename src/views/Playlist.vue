<script setup lang="ts">
import { usePlayer } from '../composables/player';

// 🟢 核心修改：解构出 playQueue 和新的操作函数
const { 
  playQueue, // 替换 songList
  currentSong, showPlaylist, togglePlaylist, playSong, formatDuration,
  clearQueue, removeSongFromQueue, // 新增函数
  settings
} = usePlayer();

const handleClear = () => {
  if (confirm("确定要清空播放列表吗？(仅清空正在播放队列)")) {
    clearQueue(); // 🟢 使用 clearQueue，不再操作 songList
  }
};

const handleRemove = (song: any, e: Event) => {
  e.stopPropagation(); // 防止触发播放
  removeSongFromQueue(song);
};
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩层：点击空白处关闭 -->
    <transition name="fade">
      <div v-if="showPlaylist" class="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[2px]" @click="togglePlaylist"></div>
    </transition>

    <transition name="slide-right">
      <div 
        v-if="showPlaylist"
        class="fixed bottom-24 right-0 w-[340px] max-h-[70vh] bg-white/80 rounded-l-2xl shadow-[0_8px_40px_rgba(0,0,0,0.15)] border border-white/40 z-[100] flex flex-col overflow-hidden font-sans select-none"
        :class="[(!settings.theme.enableDynamicBg && settings.theme.mode === 'custom') ? '' : 'backdrop-blur-2xl']"
        @click.stop
      >
        <!-- Header -->
        <div 
          class="px-6 py-4 border-b border-black/5 flex justify-between items-center bg-white/50 z-10"
          :class="[(!settings.theme.enableDynamicBg && settings.theme.mode === 'custom') ? '' : 'backdrop-blur-sm']"
        >
          <div class="flex items-center gap-3">
            <h3 class="font-bold text-gray-800 text-lg tracking-tight">播放列表</h3>
            <span class="text-xs text-gray-500 font-medium bg-gray-200/60 px-2 py-0.5 rounded-full">{{ playQueue.length }}</span>
          </div>
          <button 
            @click="handleClear" 
            class="text-gray-400 hover:text-[#EC4141] text-sm hover:bg-red-50 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 active:scale-95"
            title="清空列表"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            <span>清空</span>
          </button>
        </div>
        
        <!-- List -->
        <div class="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
          <div v-if="playQueue.length === 0" class="h-full flex flex-col items-center justify-center text-gray-400 space-y-2 py-20">
             <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
             <span class="text-sm">播放队列为空</span>
          </div>

          <!-- 🟢 遍历 playQueue -->
          <div 
            v-for="(song, index) in playQueue" 
            :key="song.path + index"
            @click="playSong(song)"
            class="group relative p-2 rounded-xl flex justify-between items-center cursor-pointer transition-all duration-200 border border-transparent"
            :class="[
              currentSong?.path === song.path 
                ? 'bg-[#EC4141]/5 text-[#EC4141] border-[#EC4141]/10 shadow-sm' 
                : 'hover:bg-black/5 text-gray-700 hover:border-black/5'
            ]"
          >
            <!-- Playing Indicator / Index -->
            <div class="w-8 flex justify-center items-center shrink-0">
               <div v-if="currentSong?.path === song.path" class="flex items-end gap-[2px] h-3">
                 <div class="w-[3px] bg-[#EC4141] animate-music-bar-1"></div>
                 <div class="w-[3px] bg-[#EC4141] animate-music-bar-2"></div>
                 <div class="w-[3px] bg-[#EC4141] animate-music-bar-3"></div>
               </div>
               <template v-else>
                 <span class="text-xs text-gray-400 group-hover:hidden font-mono">{{ index + 1 }}</span>
                 <svg xmlns="http://www.w3.org/2000/svg" class="hidden group-hover:block h-3 w-3 text-gray-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
               </template>
            </div>

            <div class="flex-1 min-w-0 pr-4 flex flex-col">
              <span class="text-sm font-medium truncate leading-tight">{{ song.title || song.name.replace(/\.[^/.]+$/, "") }}</span>
              <span 
                 class="text-xs truncate mt-0.5"
                 :class="currentSong?.path === song.path ? 'text-[#EC4141]/70' : 'text-gray-400'"
              >{{ song.artist || 'Unknown Artist' }}</span>
            </div>
            
            <div class="flex items-center gap-3">
               <div class="text-xs font-mono shrink-0 group-hover:hidden" :class="currentSong?.path === song.path ? 'text-[#EC4141]/70' : 'text-gray-400'">
                  {{ formatDuration(song.duration) }}
               </div>
               <!-- 🟢 删除按钮 (Hover显示) -->
               <button 
                 @click="handleRemove(song, $event)"
                 class="hidden group-hover:flex w-6 h-6 items-center justify-center text-gray-400 hover:text-red-500 transition-colors rounded-full hover:bg-black/5 active:scale-90"
                 title="从队列移除"
               >
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
               </button>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes music-bar {
  0%, 100% { height: 4px; }
  50% { height: 12px; }
}

.animate-music-bar-1 { animation: music-bar 0.6s ease-in-out infinite; }
.animate-music-bar-2 { animation: music-bar 0.8s ease-in-out infinite 0.1s; }
.animate-music-bar-3 { animation: music-bar 0.7s ease-in-out infinite 0.2s; }
</style>