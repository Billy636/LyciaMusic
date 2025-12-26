<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';

const props = defineProps<{
  visible: boolean,
  selectedCount: number
}>();

const emit = defineEmits(['close', 'confirm']);

const { folderList } = usePlayer();
const folderCoverCache = ref<Map<string, string>>(new Map());

const loadFolderCover = async (path: string, firstSongPath: string) => {
  if (!firstSongPath || folderCoverCache.value.has(path)) return;
  try { const cover = await invoke<string>('get_song_cover', { path: firstSongPath }); if (cover) folderCoverCache.value.set(path, cover); } catch {}
};

watch(() => props.visible, (val) => {
  if (val) {
    folderList.value.forEach(f => { if (f.firstSongPath) loadFolderCover(f.path, f.firstSongPath); });
  }
});

</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm" @click.self="emit('close')">
      <div class="bg-white rounded-xl shadow-2xl w-80 overflow-hidden animate-in fade-in zoom-in duration-200">
        <div class="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
          <h3 class="font-bold text-gray-800 text-sm">移动 {{ selectedCount }} 首歌曲到文件夹</h3>
          <button @click="emit('close')" class="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
          <div v-if="folderList.length === 0" class="text-center py-4 text-gray-400 text-sm">暂无文件夹</div>
          
          <div v-for="folder in folderList" :key="folder.path" @click="emit('confirm', folder.path, folder.name)" class="flex items-center p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
            <div class="w-10 h-10 bg-blue-50 rounded flex items-center justify-center mr-3 overflow-hidden border border-blue-100">
              <img v-if="folderCoverCache.get(folder.path)" :src="folderCoverCache.get(folder.path)" class="w-full h-full object-cover">
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-300" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-gray-800 truncate" :title="folder.path">{{ folder.name }}</div>
              <div class="text-xs text-gray-400">{{ folder.count }}首</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
