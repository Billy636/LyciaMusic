<script setup lang="ts">
import { usePlayer, dragSession } from '../composables/player';
import { useRouter } from 'vue-router';
import { ref, onMounted, onUnmounted } from 'vue';

const { artistList, viewArtist, artistSortMode, updateArtistOrder } = usePlayer();
const router = useRouter();

const showSortMenu = ref(false);
const dragOverName = ref<string | null>(null);

const handleArtistClick = (artistName: string) => {
  viewArtist(artistName); 
  router.push('/');       
};

const handleSortChange = (mode: 'count' | 'name' | 'custom') => {
  artistSortMode.value = mode;
  showSortMenu.value = false;
};

// --- Custom Drag & Drop for Artists ---
let mouseDownInfo: { x: number, y: number, index: number, artist: any } | null = null;

const handleMouseDown = (e: MouseEvent, index: number, artist: any) => {
  if (e.button !== 0) return;
  mouseDownInfo = { x: e.clientX, y: e.clientY, index, artist };
};

const handleGlobalMouseMove = (e: MouseEvent) => {
  if (mouseDownInfo && !dragSession.active) {
    const dist = Math.sqrt(Math.pow(e.clientX - mouseDownInfo.x, 2) + Math.pow(e.clientY - mouseDownInfo.y, 2));
    if (dist > 5) {
      dragSession.active = true;
      dragSession.type = 'artist';
      dragSession.data = { index: mouseDownInfo.index, name: mouseDownInfo.artist.name };
    }
  }
};

const handleGlobalMouseUp = () => {
  if (dragSession.active && dragSession.type === 'artist') {
    if (dragOverName.value && mouseDownInfo) {
      const fromIndex = mouseDownInfo.index;
      const toIndex = artistList.value.findIndex(a => a.name === dragOverName.value);
      
      if (toIndex !== -1 && fromIndex !== toIndex) {
        const list = [...artistList.value];
        const [removed] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, removed);
        
        const newOrder = list.map(a => a.name);
        updateArtistOrder(newOrder);
      }
    }
  }
  
  // Reset
  mouseDownInfo = null;
  if (dragSession.type === 'artist') {
     dragSession.active = false;
     dragSession.type = 'song';
     dragSession.data = null;
     dragOverName.value = null;
  }
};

const handleItemMouseMove = (e: MouseEvent, artistName: string) => {
  if (dragSession.active && dragSession.type === 'artist') {
    dragOverName.value = artistName;
  }
};

// Global click to close menu
const closeMenu = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.relative.z-50')) {
    showSortMenu.value = false;
  }
};

onMounted(() => {
  window.addEventListener('mousemove', handleGlobalMouseMove);
  window.addEventListener('mouseup', handleGlobalMouseUp);
  window.addEventListener('click', closeMenu);
});

onUnmounted(() => {
  window.removeEventListener('mousemove', handleGlobalMouseMove);
  window.removeEventListener('mouseup', handleGlobalMouseUp);
  window.removeEventListener('click', closeMenu);
});
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-transparent">
    <header class="h-20 flex items-end justify-between px-8 pb-4 border-b border-gray-100 dark:border-white/5 shrink-0 z-10 relative">
      <div class="flex items-end">
        <h1 class="text-3xl font-bold text-gray-800 dark:text-white">👤 歌手列表</h1>
        <span class="text-sm text-gray-400 dark:text-gray-500 ml-3 mb-1">共 {{ artistList.length }} 位</span>
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
            <button @click="handleSortChange('name')" class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between" :class="artistSortMode === 'name' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'">
              <span>按名称排序 (A-Z)</span>
              <svg v-if="artistSortMode === 'name'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            </button>
            <button @click="handleSortChange('count')" class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between" :class="artistSortMode === 'count' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'">
              <span>按数量排序 (多->少)</span>
              <svg v-if="artistSortMode === 'count'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            </button>
            <button class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between cursor-default" :class="artistSortMode === 'custom' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'">
              <span>自定义排序 (拖拽触发)</span>
              <svg v-if="artistSortMode === 'custom'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            </button>
          </div>
        </div>
      </div>
    </header>

    <section class="flex-1 overflow-y-auto p-8 custom-scrollbar relative z-0">
      <!-- Grid 布局 -->
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        <div 
          v-for="(artist, index) in artistList" 
          :key="artist.name"
          @mousedown="handleMouseDown($event, index, artist)"
          @mousemove="handleItemMouseMove($event, artist.name)"
          @click="handleArtistClick(artist.name)"
          class="group cursor-pointer bg-black/5 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 border border-transparent hover:border-gray-200 dark:hover:border-white/20 hover:shadow-lg rounded-xl p-4 transition-all duration-300 flex flex-col items-center text-center relative select-none"
          :class="[
            (dragSession.active && dragSession.type === 'artist' && dragSession.data?.name === artist.name) ? 'opacity-50' : '',
            {'ring-2 ring-[#EC4141] bg-red-50 dark:bg-red-900/20': dragSession.active && dragSession.type === 'artist' && dragOverName === artist.name && dragSession.data?.name !== artist.name}
          ]"
        >
          <!-- 头像占位符 (圆形) -->
          <div class="w-24 h-24 mb-4 rounded-full bg-gray-200 dark:bg-white/10 flex items-center justify-center text-3xl group-hover:scale-105 transition-transform overflow-hidden shadow-inner">
             👤
          </div>
          
          <h3 class="font-bold text-gray-800 dark:text-gray-200 truncate w-full mb-1 group-hover:text-[#EC4141] transition-colors">
            {{ artist.name }}
          </h3>
          <span class="text-xs text-gray-400 dark:text-gray-500 bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-full">
            {{ artist.count }} 首歌曲
          </span>
        </div>
      </div>
    </section>
  </div>
</template>