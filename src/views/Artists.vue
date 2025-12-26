<script setup lang="ts">
import { usePlayer } from '../composables/player';
import { useRouter } from 'vue-router';

const { artistList, viewArtist } = usePlayer();
const router = useRouter();

const handleArtistClick = (artistName: string) => {
  viewArtist(artistName); // 1. 设置过滤条件
  router.push('/');       // 2. 跳转回主页显示歌曲列表
};
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-white">
    <header class="h-20 flex items-end px-8 pb-4 border-b border-gray-100">
      <h1 class="text-3xl font-bold text-gray-800">👤 歌手列表</h1>
      <span class="text-sm text-gray-400 ml-3 mb-1">共 {{ artistList.length }} 位</span>
    </header>

    <section class="flex-1 overflow-y-auto p-8">
      <!-- Grid 布局 -->
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        <div 
          v-for="artist in artistList" 
          :key="artist.name"
          @click="handleArtistClick(artist.name)"
          class="group cursor-pointer bg-gray-50 hover:bg-white border border-transparent hover:border-gray-200 hover:shadow-lg rounded-xl p-4 transition-all duration-300 flex flex-col items-center text-center"
        >
          <!-- 头像占位符 (圆形) -->
          <div class="w-24 h-24 mb-4 rounded-full bg-gray-200 flex items-center justify-center text-3xl group-hover:scale-105 transition-transform overflow-hidden shadow-inner">
             👤
          </div>
          
          <h3 class="font-bold text-gray-800 truncate w-full mb-1 group-hover:text-[#EC4141] transition-colors">
            {{ artist.name }}
          </h3>
          <span class="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {{ artist.count }} 首歌曲
          </span>
        </div>
      </div>
    </section>
  </div>
</template>