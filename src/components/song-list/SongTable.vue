<script setup lang="ts">
import { ref, computed, watch, reactive, onMounted, onUnmounted } from 'vue';
import { Song, usePlayer, dragSession } from '../../composables/player';
import { invoke } from '@tauri-apps/api/core';

const props = defineProps<{
  songs: Song[];
  isBatchMode: boolean;
  selectedPaths: Set<string>;
}>();

// 新增 'drag-start' 事件，将控制权交还给父组件
const emit = defineEmits<{
  (e: 'play', song: Song): void;
  (e: 'contextmenu', event: MouseEvent, song: Song): void;
  (e: 'update:selectedPaths', newSet: Set<string>): void;
  (e: 'drag-start', payload: { event: MouseEvent; song: Song; index: number }): void; 
}>();

const { isFavorite, toggleFavorite, formatDuration, currentViewMode } = usePlayer();

// --- 虚拟滚动逻辑 ---
const ROW_HEIGHT = 60;
const containerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const containerHeight = ref(600);
const listBodyRef = ref<HTMLElement | null>(null);

const updateContainerHeight = () => {
  if (containerRef.value) containerHeight.value = containerRef.value.clientHeight;
};

const virtualData = computed(() => {
  const total = props.songs.length;
  const start = Math.floor(scrollTop.value / ROW_HEIGHT);
  const visibleCount = Math.ceil(containerHeight.value / ROW_HEIGHT);
  const buffer = 5;
  const renderStart = Math.max(0, start - buffer);
  const renderEnd = Math.min(total, start + visibleCount + buffer);
  
  return {
    items: props.songs.slice(renderStart, renderEnd).map((song, index) => ({
      ...song,
      virtualIndex: renderStart + index
    })),
    paddingTop: renderStart * ROW_HEIGHT,
    paddingBottom: (total - renderEnd) * ROW_HEIGHT,
  };
});

const onScroll = (e: Event) => {
  scrollTop.value = (e.target as HTMLElement).scrollTop;
};

// --- 图片按需加载与缓存 ---
const coverCache = reactive(new Map<string, string>());
const loadingSet = new Set<string>();
const loadCoverDebounced = (() => {
  let timer: any = null;
  return (items: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      items.forEach(async (song) => {
        if (coverCache.has(song.path) || loadingSet.has(song.path)) return;
        loadingSet.add(song.path);
        try {
          const dataUrl = await invoke<string>('get_song_cover_thumbnail', { path: song.path });
          coverCache.set(song.path, dataUrl || '');
        } catch { coverCache.set(song.path, ''); } 
        finally { loadingSet.delete(song.path); }
      });
    }, 20);
  };
})();

watch(() => virtualData.value.items, (newItems) => loadCoverDebounced(newItems), { immediate: true });

// --- 鼠标按下处理 ---
// 这里我们只负责捕获点击，具体的逻辑（是选择还是拖拽）交给父组件判断
const handleMouseDown = (e: MouseEvent, song: Song, index: number) => {
  if (e.button !== 0) return;
  emit('drag-start', { event: e, song, index });
};

// --- 交互辅助 ---
const toggleSelectAll = () => {
  if (props.selectedPaths.size === props.songs.length) props.selectedPaths.clear();
  else props.songs.forEach(s => props.selectedPaths.add(s.path));
};

const showDragIcon = computed(() => ['folder', 'playlist', 'all'].includes(currentViewMode.value));

onMounted(() => {
  window.addEventListener('resize', updateContainerHeight);
  if (containerRef.value) updateContainerHeight();
});
onUnmounted(() => {
  window.removeEventListener('resize', updateContainerHeight);
});
</script>

<template>
  <div 
    ref="containerRef" 
    class="flex-1 overflow-y-auto pl-2.5 pr-3 pb-8 custom-scrollbar" 
    @scroll="onScroll"
  >
    <table class="w-full text-left text-sm text-gray-600 table-fixed relative border-collapse">
      <thead class="select-none border-b border-black/5 z-10">
        <tr class="text-gray-500 text-xs">
          <th class="py-3 font-normal w-12 text-center">
            <input v-if="isBatchMode" type="checkbox" @change="toggleSelectAll" :checked="selectedPaths.size === songs.length && songs.length > 0" class="rounded text-[#EC4141] focus:ring-[#EC4141] cursor-pointer" />
            <span v-else>#</span>
          </th> 
          <th class="py-3 font-normal w-[40%] pl-2">音乐标题</th>
          <th class="py-3 font-normal w-[20%]">歌手</th>
          <th class="py-3 font-normal w-[25%]">专辑</th>
          <th class="py-3 font-normal w-[15%] text-right pr-4">时长</th>
        </tr>
      </thead>
      
      <tbody ref="listBodyRef" class="relative">
        <tr :style="{ height: virtualData.paddingTop + 'px' }"></tr>

        <div 
          v-if="dragSession.sortLineTop !== -1"
          class="sort-line absolute left-0 right-0 z-20 pointer-events-none"
          :style="{ top: dragSession.sortLineTop + 'px' }"
        ></div>

        <tr v-for="song in virtualData.items" :key="song.path" 
          :data-index="song.virtualIndex"
          @mousedown="handleMouseDown($event, song, song.virtualIndex)" 
          @dblclick="!isBatchMode && emit('play', song)"
          @contextmenu.prevent="emit('contextmenu', $event, song)"
          class="group border-b border-black/5 transition-colors hover:bg-black/5 select-none cursor-default" 
          :style="{ height: ROW_HEIGHT + 'px' }"
          :class="{
            'bg-red-500/10': selectedPaths.has(song.path),
            'opacity-40': dragSession.active && dragSession.songs[0]?.path === song.path
          }"
        >
          <td class="py-0 h-full w-12 p-0">
             <div class="h-full w-full flex items-center justify-center relative">
               <div v-if="isBatchMode" class="flex items-center justify-center w-full h-full">
                 <input type="checkbox" :checked="selectedPaths.has(song.path)" class="rounded text-[#EC4141] focus:ring-[#EC4141] pointer-events-none" />
               </div>
               <div v-else class="w-full h-full flex items-center justify-center">
                 <span class="text-xs font-mono text-gray-400 group-hover:hidden flex items-center justify-center w-full h-full">
                    {{ song.virtualIndex + 1 < 10 ? '0' + (song.virtualIndex + 1) : song.virtualIndex + 1 }}
                 </span>
                 <div class="hidden group-hover:flex items-center justify-center w-full h-full">
                    <span v-if="showDragIcon" class="text-gray-500 active:text-[#EC4141] cursor-grab flex items-center justify-center">
                       <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16" />
                       </svg>
                    </span>
                    <span v-else class="text-gray-500 flex items-center justify-center">
                       <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                       </svg>
                    </span>
                 </div>
               </div>
             </div>
          </td>
          
          <td class="py-3 pr-4 overflow-hidden pl-2">
            <div class="flex items-center h-full">
              <div class="w-9 h-9 rounded bg-gray-200/50 flex items-center justify-center mr-3 shrink-0 overflow-hidden text-gray-400 relative border border-black/5">
                <img 
                  v-if="coverCache.get(song.path)"
                  :src="coverCache.get(song.path)" 
                  class="w-full h-full object-cover transition-opacity duration-300"
                  alt="Cover"
                />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-40 absolute inset-0 m-auto -z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <span class="text-gray-900 font-medium truncate">
                {{ song.title || song.name.replace(/\.[^/.]+$/, "") }}
              </span>
            </div>
          </td>
          
          <td class="py-3 pr-4 truncate text-gray-700">{{ song.artist }}</td>
          <td class="py-3 pr-4 truncate text-gray-500 text-xs italic">{{ song.album }}</td>
          <td class="py-3 pr-4 text-right font-mono text-xs text-gray-500">
            <div class="flex items-center justify-end gap-3" :class="{'opacity-20 pointer-events-none': dragSession.active}">
              <button v-if="!isBatchMode" @click.stop="toggleFavorite(song)" class="focus:outline-none">
                <svg v-if="isFavorite(song)" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-[#EC4141]" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" /></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
              </button>
              <span class="w-10">{{ formatDuration(song.duration) }}</span>
            </div>
          </td>
        </tr>

        <tr :style="{ height: virtualData.paddingBottom + 'px' }"></tr>
      </tbody>
    </table>
    
    <div v-if="songs.length === 0" class="py-20 text-center select-none text-gray-500">列表为空</div>
  </div>
</template>

<style scoped>
.sort-line {
  height: 2px;
  background: radial-gradient(ellipse at center, rgba(236,65,65,0.7) 0%, rgba(236,65,65,0) 80%);
  box-shadow: 0 1px 2px rgba(236,65,65,0.2);
}
</style>