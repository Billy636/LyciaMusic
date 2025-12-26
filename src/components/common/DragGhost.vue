<script setup lang="ts">
import { dragSession } from '../../composables/playerState';
import { watch, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

const coverUrl = ref('');

// 🟢 监听拖拽激活状态
// 一旦开始拖拽，立刻去后台获取第一首歌的封面，这样看起来更真实
watch(() => dragSession.active, async (active) => {
  if (active && dragSession.songs.length > 0) {
    // 尝试获取第一首歌的封面
    try {
      const cover = await invoke<string>('get_song_cover', { path: dragSession.songs[0].path });
      coverUrl.value = cover;
    } catch {
      coverUrl.value = ''; // 获取失败则置空，显示默认图标
    }
  } else {
    coverUrl.value = '';
  }
});
</script>

<template>
  <Teleport to="body">
    <div 
      v-if="dragSession.active && dragSession.songs.length > 0"
      class="fixed pointer-events-none z-[9999] flex items-center gap-3 px-3 py-2 bg-white/95 backdrop-blur-sm text-gray-800 rounded-lg shadow-2xl border border-gray-200"
      :style="{ 
        left: (dragSession.mouseX + 20) + 'px', 
        top: (dragSession.mouseY + 20) + 'px' 
      }"
    >
      <div class="w-10 h-10 rounded bg-gray-100 flex-shrink-0 overflow-hidden flex items-center justify-center border border-gray-100">
        <img v-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover" />
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
      </div>

      <div class="flex flex-col min-w-[80px] max-w-[200px]">
        <span class="text-sm font-bold truncate leading-tight">{{ dragSession.songs[0].name.replace(/\.[^/.]+$/, "") }}</span>
        <span class="text-xs text-gray-500 truncate">{{ dragSession.songs[0].artist }}</span>
      </div>

      <div v-if="dragSession.songs.length > 1" class="absolute -top-2 -right-2 bg-[#EC4141] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm border border-white">
        +{{ dragSession.songs.length }}
      </div>
    </div>
  </Teleport>
</template>