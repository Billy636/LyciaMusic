<script setup lang="ts">
import { dragSession } from '../../composables/player';
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';

const ghostX = ref(0);
const ghostY = ref(0);
const ghostCover = ref('');

watch(() => dragSession.songs, async (newSongs) => {
  if (newSongs.length > 0) {
    try {
      // 获取缩略图路径
      const path = await invoke<string>('get_song_cover_thumbnail', { path: newSongs[0].path });
      // 转换为 Asset URL
      if (path) {
        ghostCover.value = convertFileSrc(path);
      } else {
        ghostCover.value = '';
      }
    } catch (e) {
      ghostCover.value = '';
    }
  } else {
    ghostCover.value = '';
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
</script>

<template>
  <teleport to="body">
    <transition name="fade">
      <div 
        v-if="dragSession.active && dragSession.songs.length > 0"
        class="fixed z-[9999] pointer-events-none p-3 bg-white/90 dark:bg-[#1a1a1a]/90 backdrop-blur-md rounded-lg shadow-2xl border border-white/20 dark:border-white/10 flex items-center gap-3 select-none transition-transform"
        :style="ghostStyle"
      >
        <div class="w-12 h-12 rounded bg-gray-200/50 dark:bg-white/10 flex items-center justify-center overflow-hidden shrink-0 shadow-sm relative">
          <img v-if="ghostCover" :src="ghostCover" class="w-full h-full object-cover" />
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <div class="absolute inset-0 bg-black/5"></div>
        </div>
        <div class="flex flex-col min-w-0">
          <span class="text-sm font-bold text-gray-900 dark:text-white truncate max-w-[200px] drop-shadow-sm">{{ dragSession.songs[0].title || dragSession.songs[0].name }}</span>
          <span class="text-xs text-gray-500 dark:text-white/60 truncate max-w-[200px]">{{ dragSession.songs[0].artist }}</span>
        </div>
        <div v-if="dragSession.songs.length > 1" class="absolute -top-2 -right-2 w-6 h-6 bg-[#EC4141] text-white rounded-full flex items-center justify-center text-xs font-bold shadow-md border-2 border-white dark:border-[#222]">
           {{ dragSession.songs.length }}
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