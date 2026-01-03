<script setup lang="ts">
import { usePlayer, dragSession } from '../composables/player';
import { useRouter } from 'vue-router';
import { ref, onMounted, onUnmounted } from 'vue';

const { albumList, viewAlbum, albumSortMode, updateAlbumOrder } = usePlayer();
const router = useRouter();

const showSortMenu = ref(false);
const dragOverName = ref<string | null>(null);

const handleAlbumClick = (albumName: string) => {
  viewAlbum(albumName);
  router.push('/');
};

const handleSortChange = (mode: 'count' | 'name' | 'custom') => {
  albumSortMode.value = mode;
  showSortMenu.value = false;
};

// --- Custom Drag & Drop for Albums ---
let mouseDownInfo: { x: number, y: number, index: number, album: any } | null = null;

const handleMouseDown = (e: MouseEvent, index: number, album: any) => {
  if (e.button !== 0) return;
  mouseDownInfo = { x: e.clientX, y: e.clientY, index, album };
};

const handleGlobalMouseMove = (e: MouseEvent) => {
  if (mouseDownInfo && !dragSession.active) {
    const dist = Math.sqrt(Math.pow(e.clientX - mouseDownInfo.x, 2) + Math.pow(e.clientY - mouseDownInfo.y, 2));
    if (dist > 5) {
      dragSession.active = true;
      dragSession.type = 'album';
      dragSession.data = { index: mouseDownInfo.index, name: mouseDownInfo.album.name };
    }
  }
};

const handleGlobalMouseUp = () => {
  if (dragSession.active && dragSession.type === 'album') {
    if (dragOverName.value && mouseDownInfo) {
      const fromIndex = mouseDownInfo.index;
      const toIndex = albumList.value.findIndex(a => a.name === dragOverName.value);
      
      if (toIndex !== -1 && fromIndex !== toIndex) {
        const list = [...albumList.value];
        const [removed] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, removed);
        
        const newOrder = list.map(a => a.name);
        updateAlbumOrder(newOrder);
      }
    }
  }
  
  // Reset
  mouseDownInfo = null;
  if (dragSession.type === 'album') {
     dragSession.active = false;
     dragSession.type = 'song';
     dragSession.data = null;
     dragOverName.value = null;
  }
};

const handleItemMouseMove = (e: MouseEvent, albumName: string) => {
  if (dragSession.active && dragSession.type === 'album') {
    dragOverName.value = albumName;
  }
};

onMounted(() => {
  window.addEventListener('mousemove', handleGlobalMouseMove);
  window.addEventListener('mouseup', handleGlobalMouseUp);
});

onUnmounted(() => {
  window.removeEventListener('mousemove', handleGlobalMouseMove);
  window.removeEventListener('mouseup', handleGlobalMouseUp);
});
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-transparent" @click="showSortMenu = false">
    <header class="h-20 flex items-end justify-between px-8 pb-4 border-b border-gray-100 dark:border-white/5 shrink-0 z-10 relative">
      <div class="flex items-end">
        <h1 class="text-3xl font-bold text-gray-800 dark:text-white">💿 专辑列表</h1>
        <span class="text-sm text-gray-400 dark:text-gray-500 ml-3 mb-1">共 {{ albumList.length }} 张</span>
      </div>

      <!-- Sort Menu -->
      <div class="relative z-50">
        <button @click.stop="showSortMenu = !showSortMenu" class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 transition-colors" title="排序">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
          </svg>
        </button>
        
        <div v-if="showSortMenu" class="absolute right-0 top-full mt-2 w-48 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-xl shadow-xl border border-gray-100 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">
          <div class="py-1">
            <button @click="handleSortChange('name')" class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between" :class="albumSortMode === 'name' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'">
              <span>按名称排序 (A-Z)</span>
              <svg v-if="albumSortMode === 'name'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            </button>
            <button @click="handleSortChange('count')" class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between" :class="albumSortMode === 'count' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'">
              <span>按数量排序 (多->少)</span>
              <svg v-if="albumSortMode === 'count'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            </button>
            <button class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between cursor-default" :class="albumSortMode === 'custom' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'">
              <span>自定义排序 (拖拽触发)</span>
              <svg v-if="albumSortMode === 'custom'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            </button>
          </div>
        </div>
      </div>
    </header>

    <section class="flex-1 overflow-y-auto p-8 custom-scrollbar relative z-0">
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        <div 
          v-for="(album, index) in albumList" 
          :key="album.name"
          @mousedown="handleMouseDown($event, index, album)"
          @mousemove="handleItemMouseMove($event, album.name)"
          @click="handleAlbumClick(album.name)"
          class="group cursor-pointer bg-black/5 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 border border-transparent hover:border-gray-200 dark:hover:border-white/20 hover:shadow-xl rounded-lg p-4 transition-all duration-300 flex flex-col relative select-none"
          :class="[
            (dragSession.active && dragSession.type === 'album' && dragSession.data?.name === album.name) ? 'opacity-50' : '',
            {'ring-2 ring-[#EC4141] bg-red-50 dark:bg-red-900/20': dragSession.active && dragSession.type === 'album' && dragOverName === album.name && dragSession.data?.name !== album.name}
          ]"
        >
          <!-- 专辑封面占位符 (方形) -->
          <div class="aspect-square w-full mb-4 rounded-md bg-gradient-to-br from-gray-200 to-gray-300 dark:from-white/10 dark:to-white/20 flex items-center justify-center text-3xl shadow-sm group-hover:shadow-md transition-shadow relative overflow-hidden">
             <div class="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors"></div>
             💿
          </div>
          
          <h3 class="font-bold text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors">
            {{ album.name }}
          </h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1">
            {{ album.artist }}
          </p>
          <span class="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
            {{ album.count }} 首歌曲
          </span>
        </div>
      </div>
    </section>
  </div>
</template>