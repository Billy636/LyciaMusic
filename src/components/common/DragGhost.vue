<script setup lang="ts">
import { dragSession } from '../../composables/player';
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';

const ghostX = ref(0);
const ghostY = ref(0);
const ghostCover = ref('');

// 🟢 监听拖拽状态和类型
watch([() => dragSession.active, () => dragSession.type], async ([active, type]) => {
  if (active) {
    // 1. 歌曲类型
    if (type === 'song' && dragSession.songs.length > 0) {
      try {
        const path = await invoke<string>('get_song_cover_thumbnail', { path: dragSession.songs[0].path });
        ghostCover.value = path ? convertFileSrc(path) : '';
      } catch (e) {
        ghostCover.value = '';
      }
    } 
    // 2. 专辑类型 (如果有 data.name) - 这里假设 data 包含 name
    else if (type === 'album' && dragSession.data?.name) {
       // 专辑可以尝试获取第一首歌的封面，或者显示默认图标
       // 暂时显示默认图标或尝试获取封面(如果有路径)
       // 如果 data 里有 firstSongPath，可以尝试加载
       ghostCover.value = ''; 
    }
    // 3. 其他类型 (Folder/Playlist/Artist) 暂不需要异步加载图片，使用默认图标
    else {
       ghostCover.value = '';
    }
  }
});

const onMouseMove = (e: MouseEvent) => {
  if (dragSession.active) {
    ghostX.value = e.clientX;
    ghostY.value = e.clientY;
  }
};

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove);
});

const ghostStyle = computed(() => ({
  top: `${ghostY.value + 10}px`,
  left: `${ghostX.value + 10}px`,
}));

// 🟢 计算显示内容
const title = computed(() => {
  if (dragSession.type === 'song' && dragSession.songs.length > 0) return dragSession.songs[0].title || dragSession.songs[0].name;
  if (dragSession.type === 'playlist') return dragSession.data?.name || '未知歌单';
  if (dragSession.type === 'folder') return dragSession.data?.name || '未知文件夹';
  if (dragSession.type === 'artist') return dragSession.data?.name || '未知歌手';
  if (dragSession.type === 'album') return dragSession.data?.name || '未知专辑';
  return '移动中...';
});

const subtitle = computed(() => {
  if (dragSession.type === 'song' && dragSession.songs.length > 0) return dragSession.songs[0].artist;
  if (dragSession.type === 'song' && dragSession.songs.length > 1) return `等 ${dragSession.songs.length} 首歌曲`;
  if (dragSession.type === 'playlist') return '歌单';
  if (dragSession.type === 'folder') return '文件夹';
  if (dragSession.type === 'artist') return '歌手';
  if (dragSession.type === 'album') return '专辑';
  return '';
});

const badgeCount = computed(() => {
  if (dragSession.type === 'song') return dragSession.songs.length;
  return 0;
});
</script>

<template>
  <teleport to="body">
    <transition name="fade">
      <div 
        v-if="dragSession.active"
        class="fixed z-[9999] pointer-events-none p-3 bg-white/90 dark:bg-[#1a1a1a]/90 backdrop-blur-md rounded-lg shadow-2xl border border-white/20 dark:border-white/10 flex items-center gap-3 select-none transition-transform"
        :style="ghostStyle"
      >
        <!-- Icon / Cover Area -->
        <div 
          class="w-12 h-12 bg-gray-200/50 dark:bg-white/10 flex items-center justify-center overflow-hidden shrink-0 shadow-sm relative"
          :class="dragSession.type === 'artist' ? 'rounded-full' : 'rounded'"
        >
          <!-- Song Cover -->
          <img v-if="dragSession.type === 'song' && ghostCover" :src="ghostCover" class="w-full h-full object-cover" />
          
          <!-- Default Icons based on Type -->
          <template v-else>
             <!-- Song Default -->
             <svg v-if="dragSession.type === 'song'" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
             </svg>
             <!-- Playlist Default -->
             <svg v-else-if="dragSession.type === 'playlist'" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
             </svg>
             <!-- Folder Default -->
             <svg v-else-if="dragSession.type === 'folder'" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
             </svg>
             <!-- Artist Default -->
             <div v-else-if="dragSession.type === 'artist'" class="text-2xl">👤</div>
             <!-- Album Default -->
             <div v-else-if="dragSession.type === 'album'" class="text-2xl">💿</div>
          </template>

          <div class="absolute inset-0 bg-black/5"></div>
        </div>

        <div class="flex flex-col min-w-0">
          <span class="text-sm font-bold text-gray-900 dark:text-white truncate max-w-[200px] drop-shadow-sm">{{ title }}</span>
          <span class="text-xs text-gray-500 dark:text-white/60 truncate max-w-[200px]">{{ subtitle }}</span>
        </div>
        
        <div v-if="badgeCount > 1" class="absolute -top-2 -right-2 w-6 h-6 bg-[#EC4141] text-white rounded-full flex items-center justify-center text-xs font-bold shadow-md border-2 border-white dark:border-[#222]">
           {{ badgeCount }}
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>