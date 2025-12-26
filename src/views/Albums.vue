<script setup lang="ts">
import { usePlayer } from '../composables/player';
import { useRouter } from 'vue-router';

const { albumList, viewAlbum } = usePlayer();
const router = useRouter();

const handleAlbumClick = (albumName: string) => {
  viewAlbum(albumName);
  router.push('/');
};
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-white">
    <header class="h-20 flex items-end px-8 pb-4 border-b border-gray-100">
      <h1 class="text-3xl font-bold text-gray-800">💿 专辑列表</h1>
      <span class="text-sm text-gray-400 ml-3 mb-1">共 {{ albumList.length }} 张</span>
    </header>

    <section class="flex-1 overflow-y-auto p-8">
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        <div 
          v-for="album in albumList" 
          :key="album.name"
          @click="handleAlbumClick(album.name)"
          class="group cursor-pointer bg-gray-50 hover:bg-white border border-transparent hover:border-gray-200 hover:shadow-xl rounded-lg p-4 transition-all duration-300 flex flex-col"
        >
          <!-- 专辑封面占位符 (方形) -->
          <div class="aspect-square w-full mb-4 rounded-md bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-3xl shadow-sm group-hover:shadow-md transition-shadow relative overflow-hidden">
             <div class="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors"></div>
             💿
          </div>
          
          <h3 class="font-bold text-gray-800 truncate w-full group-hover:text-[#EC4141] transition-colors">
            {{ album.name }}
          </h3>
          <p class="text-xs text-gray-500 truncate w-full mt-1">
            {{ album.artist }}
          </p>
          <span class="text-[10px] text-gray-400 mt-2">
            {{ album.count }} 首歌曲
          </span>
        </div>
      </div>
    </section>
  </div>
</template>