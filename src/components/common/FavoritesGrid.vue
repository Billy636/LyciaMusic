<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';

// 接收父组件传来的“当前 Tab”状态
const { favTab, favArtistList, favAlbumList } = usePlayer();

const emit = defineEmits<{
  (e: 'enterDetail', type: 'artist' | 'album', name: string): void
}>();

// --- 🟢 图片加载逻辑 ---
// 我们创建一个 Map 来缓存已加载的图片 URL：key=path, value=base64
const imageCache = ref<Map<string, string>>(new Map());

// 异步加载图片的辅助函数
const loadCover = async (path: string) => {
  if (imageCache.value.has(path)) return; // 缓存命中，跳过
  try {
    const cover = await invoke<string>('get_song_cover', { path });
    if (cover) {
      imageCache.value.set(path, cover);
    }
  } catch (e) {
    // 加载失败，不做处理，UI会自动显示兜底图标
  }
};

// 监听列表变化，自动触发加载
watch([favArtistList, favAlbumList], () => {
  // 懒加载逻辑：遍历当前列表，去获取封面
  const list = favTab.value === 'artists' ? favArtistList.value : favAlbumList.value;
  list.forEach(item => {
    if (item.firstSongPath) {
      loadCover(item.firstSongPath);
    }
  });
}, { immediate: true, deep: true });

</script>

<template>
  <div class="grid grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 pt-4">
          
    <template v-if="favTab === 'artists'">
      <div 
        v-for="artist in favArtistList" 
        :key="artist.name"
        @click="emit('enterDetail', 'artist', artist.name)"
        class="group cursor-pointer flex flex-col items-center"
      >
        <div class="w-32 h-32 rounded-full border border-gray-100 shadow-sm group-hover:shadow-md transition-all flex items-center justify-center mb-3 select-none overflow-hidden bg-gray-50 relative">
            
            <img 
              v-if="imageCache.get(artist.firstSongPath)" 
              :src="imageCache.get(artist.firstSongPath)" 
              class="w-full h-full object-cover animate-in fade-in duration-300"
              alt="Artist"
            />
            
            <div v-else class="text-4xl text-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 w-full h-full flex items-center justify-center">
              👤
            </div>

        </div>
        <span class="font-bold text-gray-800 text-sm truncate w-full text-center group-hover:text-[#EC4141] transition-colors">{{ artist.name }}</span>
        <span class="text-xs text-gray-400">{{ artist.count }} 首收藏</span>
      </div>
    </template>

    <template v-if="favTab === 'albums'">
      <div 
        v-for="album in favAlbumList" 
        :key="album.name"
        @click="emit('enterDetail', 'album', album.name)"
        class="group cursor-pointer flex flex-col"
      >
        <div class="relative w-full aspect-square mb-3 select-none">
            <div class="absolute top-0 right-0 w-full h-full bg-black rounded-full translate-x-2 shadow-lg opacity-80 group-hover:translate-x-4 transition-transform duration-300 ease-out"></div>
            
            <div class="relative w-full h-full border border-gray-200 rounded shadow-md flex items-center justify-center z-10 overflow-hidden bg-gray-50">
               
               <img 
                 v-if="imageCache.get(album.firstSongPath)" 
                 :src="imageCache.get(album.firstSongPath)" 
                 class="w-full h-full object-cover animate-in fade-in duration-300"
                 alt="Album"
               />

               <div v-else class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-4xl text-gray-300">
                 💿
               </div>

            </div>
        </div>
        <span class="font-bold text-gray-800 text-sm truncate group-hover:text-[#EC4141] transition-colors">{{ album.name }}</span>
        <span class="text-xs text-gray-400 truncate">{{ album.artist }}</span>
      </div>
    </template>
  </div>
</template>