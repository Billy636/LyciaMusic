//负责显示“添加到歌单”的弹窗。
<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import ModernInputModal from '../common/ModernInputModal.vue';

const props = defineProps<{
  visible: boolean,
  selectedCount: number
}>();

const emit = defineEmits(['close', 'add']);

const { playlists, createPlaylist } = usePlayer();
const playlistCoverCache = ref<Map<string, string>>(new Map());

const loadPlaylistCover = async (id: string, path: string) => {
  if (!path || playlistCoverCache.value.has(id)) return;
  try {
    const filePath = await invoke<string>('get_song_cover_thumbnail', { path });
    if (filePath) {
       playlistCoverCache.value.set(id, convertFileSrc(filePath));
    }
  } catch {}
};

watch(() => props.visible, (val) => {
  if (val) {
    playlists.value.forEach(pl => { if (pl.songPaths.length > 0) loadPlaylistCover(pl.id, pl.songPaths[0]); });
  }
});

const showCreateModal = ref(false);
const handleCreateClick = () => {
  showCreateModal.value = true;
};

const handleConfirmCreate = (name: string) => {
  if (name) {
    createPlaylist(name);
    setTimeout(() => {
      const newPl = playlists.value[playlists.value.length - 1];
      if (newPl) emit('add', newPl.id);
    }, 100);
  }
};
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm" @click.self="emit('close')">
      <div class="bg-white rounded-xl shadow-2xl w-80 overflow-hidden animate-in fade-in zoom-in duration-200">
        <div class="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
          <h3 class="font-bold text-gray-800 text-sm">收藏到歌单</h3>
          <button @click="emit('close')" class="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
          <div @click="handleCreateClick" class="flex items-center p-2 rounded-lg hover:bg-gray-50 cursor-pointer mb-1 group">
            <div class="w-10 h-10 bg-gray-100 rounded flex items-center justify-center mr-3 group-hover:bg-gray-200 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            </div>
            <span class="text-sm text-gray-600">创建新歌单</span>
          </div>
          <div v-for="pl in playlists" :key="pl.id" @click="emit('add', pl.id)" class="flex items-center p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
            <div class="w-10 h-10 bg-gray-100 rounded flex items-center justify-center mr-3 overflow-hidden border border-gray-100">
              <img v-if="playlistCoverCache.get(pl.id)" :src="playlistCoverCache.get(pl.id)" class="w-full h-full object-cover">
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-gray-800 truncate">{{ pl.name }}</div>
              <div class="text-xs text-gray-400">{{ pl.songPaths.length }}首</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <ModernInputModal
      v-model:visible="showCreateModal"
      title="创建并添加到歌单"
      placeholder="请输入歌单名称"
      confirm-text="创建"
      @confirm="handleConfirmCreate"
    />
  </Teleport>
</template>