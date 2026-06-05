<script setup lang="ts">
import { ref, watch } from 'vue';
import { artistHeaderCache } from '../../caches/imageCaches';
import { useCoverCache } from '../../composables/useCoverCache';
import { type ArtistTabId, getOrderedArtistTabs, saveTabsOrder } from '../../utils/artistTabsOrder';

const props = defineProps<{
  artistName: string;
  isBatchMode: boolean;
  selectedCount?: number;
  activeTab: ArtistTabId;
  songs?: any[];
}>();

const emit = defineEmits([
  'update:isBatchMode', 
  'update:activeTab',
  'playAll', 
  'batchPlay', 
  'addToPlaylist', 
  'batchDelete',
  'batchMove'
]);

const tabs = ref(getOrderedArtistTabs());
const draggedTabId = ref<ArtistTabId | null>(null);
const suppressClick = ref<boolean>(false);

const handleTabClick = (id: ArtistTabId) => {
  if (suppressClick.value) return;
  emit('update:activeTab', id);
};

const startX = ref(0);
const startY = ref(0);
const isDragging = ref(false);
const targetInsertIndex = ref<number | null>(null);
let pressTimer: number | null = null;

const onPointerDown = (tabId: ArtistTabId, event: PointerEvent) => {
  if (event.button !== 0) return;
  
  draggedTabId.value = tabId;
  startX.value = event.clientX;
  startY.value = event.clientY;
  isDragging.value = false;
  targetInsertIndex.value = null;
  
  // 阻止默认机制避免触屏手势干扰
  event.preventDefault();
  
  // 300ms 定时长按判定
  pressTimer = window.setTimeout(() => {
    isDragging.value = true;
    suppressClick.value = true;
    document.body.style.cursor = 'grabbing';
  }, 300);
  
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
};

const onPointerMove = (event: PointerEvent) => {
  if (draggedTabId.value === null) return;
  
  const clientX = event.clientX;
  const clientY = event.clientY;
  
  const distanceX = Math.abs(clientX - startX.value);
  const distanceY = Math.abs(clientY - startY.value);
  
  // 长按触发前如果移动位移超过了 6px，取消长按判定，退回普通状态
  if (!isDragging.value && (distanceX > 6 || distanceY > 6)) {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    onPointerUp();
    return;
  }
  
  if (isDragging.value) {
    const elements = document.elementsFromPoint(clientX, clientY);
    let hoveredTabId: ArtistTabId | null = null;
    let hoveredElement: HTMLElement | null = null;
    
    for (const el of elements) {
      const tabIdAttr = el.getAttribute('data-artist-tab-id');
      if (tabIdAttr && (tabIdAttr === 'songs' || tabIdAttr === 'albums' || tabIdAttr === 'details')) {
        hoveredTabId = tabIdAttr as ArtistTabId;
        hoveredElement = el as HTMLElement;
        break;
      }
    }
    
    if (hoveredTabId !== null && hoveredElement !== null) {
      const rect = hoveredElement.getBoundingClientRect();
      const index = tabs.value.findIndex(t => t.id === hoveredTabId);
      
      if (index !== -1) {
        // 根据 clientX 是否超过元素宽度的中点来动态确定插入在该元素左侧还是右侧
        if (clientX < rect.left + rect.width / 2) {
          targetInsertIndex.value = index;
        } else {
          targetInsertIndex.value = index + 1;
        }
      }
    } else {
      targetInsertIndex.value = null;
    }
  }
};

const onPointerUp = () => {
  if (pressTimer !== null) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
  
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  
  document.body.style.cursor = '';
  
  if (draggedTabId.value === null) return;
  
  if (isDragging.value && targetInsertIndex.value !== null) {
    const sourceIndex = tabs.value.findIndex(t => t.id === draggedTabId.value);
    let insertIndex = targetInsertIndex.value;
    
    if (sourceIndex !== -1 && sourceIndex !== insertIndex) {
      const [movedTab] = tabs.value.splice(sourceIndex, 1);
      
      // 插入点在被拖拽元素右侧时的微调修正
      if (insertIndex > sourceIndex) {
        insertIndex--;
      }
      
      tabs.value.splice(insertIndex, 0, movedTab);
      saveTabsOrder(tabs.value.map(t => t.id));
    }
  }
  
  draggedTabId.value = null;
  isDragging.value = false;
  targetInsertIndex.value = null;
  
  setTimeout(() => {
    suppressClick.value = false;
  }, 50);
};

const coverUrl = ref<string>('');
const isLoading = ref<boolean>(false);
const { loadCover, peekCoverUrl } = useCoverCache();
let coverRequestId = 0;

watch([() => props.artistName, () => props.songs], async ([artistName, newSongs]) => {
  const requestId = ++coverRequestId;

  if (!newSongs || newSongs.length === 0) {
    if (requestId !== coverRequestId) return;
    coverUrl.value = '';
    isLoading.value = false;
    return;
  }

  const firstSongPath = newSongs[0]?.path;
  if (!firstSongPath) {
    if (requestId !== coverRequestId) return;
    coverUrl.value = '';
    isLoading.value = false;
    return;
  }

  const cachedHeaderCover = artistHeaderCache.get(artistName);
  if (cachedHeaderCover) {
    coverUrl.value = cachedHeaderCover;
    isLoading.value = false;
    return;
  }

  const cachedThumbnail = peekCoverUrl(firstSongPath);
  if (cachedThumbnail) {
    coverUrl.value = cachedThumbnail;
    artistHeaderCache.set(artistName, cachedThumbnail);
    isLoading.value = false;
    return;
  }

  isLoading.value = true;
  try {
    const resolvedCover = await loadCover(firstSongPath);
    if (requestId !== coverRequestId) return;

    if (resolvedCover) {
      coverUrl.value = resolvedCover;
      artistHeaderCache.set(artistName, resolvedCover);
    } else {
      coverUrl.value = '';
    }
  } catch {
    if (requestId !== coverRequestId) return;
    coverUrl.value = '';
  } finally {
    if (requestId === coverRequestId) {
      isLoading.value = false;
    }
  }
}, { immediate: true });

const gradients = [
  'from-pink-500 to-rose-500',
  'from-purple-500 to-indigo-500',
  'from-cyan-500 to-blue-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
  'from-fuchsia-500 to-pink-500',
  'from-blue-400 to-indigo-500',
  'from-violet-500 to-purple-500',
];

const getGradientForArtist = (name: string) => {
  if (!name) return gradients[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
};

const handlePlayAll = () => {
  emit('playAll');
};
</script>

<template>
  <div class="px-8 shrink-0 select-none flex flex-col pt-6 pb-0 h-auto justify-start border-b border-black/5 dark:border-white/5 relative z-10 w-full bg-transparent">
    
    <!-- 批量操作模式 -->
    <div v-if="isBatchMode" class="flex items-center justify-between mb-4 animate-in fade-in slide-in-from-top-1 duration-200">
      <div class="flex items-center gap-3">
        <button @click="emit('batchPlay')" class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 py-1.5 rounded-full text-sm transition flex items-center gap-1 active:scale-95 shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
        </button>
        <button @click="emit('addToPlaylist')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg> 收藏到歌单
        </button>
        <button @click="emit('batchDelete')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> 删除
        </button>
      </div>
      <div class="flex items-center gap-4">
        <button @click="emit('update:isBatchMode', false)" class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1 rounded transition">完成</button>
      </div>
    </div>

    <!-- 正常模式: 歌手详情展示区 -->
    <div v-else class="flex gap-6 h-auto mt-2 mb-6">
      <!-- 封面图 (圆形) -->
      <div class="w-36 h-36 rounded-full shadow-sm flex items-center justify-center shrink-0 overflow-hidden group relative select-none bg-gray-100 dark:bg-white/5 border-4 border-white/50 dark:border-white/5">
        <div v-if="isLoading" class="w-full h-full bg-gray-200 dark:bg-white/10 animate-pulse"></div>
        <img v-else-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover select-none animate-in fade-in duration-300" draggable="false" :alt="artistName"/>
        <div v-else class="w-full h-full flex items-center justify-center text-4xl font-bold text-white bg-gradient-to-br animate-in fade-in duration-300" :class="getGradientForArtist(artistName)">
          {{ artistName.charAt(0).toUpperCase() }}
        </div>
      </div>
      
      <!-- 文本信息与操作 -->
      <div class="h-36 flex flex-col justify-start pt-2 pb-1 flex-1 min-w-0">
        <!-- 歌手名字 -->
        <div class="mb-4">
          <h1 class="text-[32px] font-bold text-gray-900 dark:text-white truncate max-w-[600px] leading-tight">
            {{ artistName }}
          </h1>
        </div>

        <!-- 操作按钮组 -->
        <div class="flex items-center gap-3 mt-2">
           <button 
             @click="handlePlayAll" 
             class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-6 py-2 rounded-full text-[15px] font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
           >
             <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M9 5.5v13l10-6.5-10-6.5Z" />
             </svg>
             播放全部
           </button>
           
           <!-- 批量操作 -->
           <button 
             @click="emit('update:isBatchMode', true)" 
             title="批量操作" 
             class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-5 py-2 rounded-full text-[15px] font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
           >
             <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
             </svg>
             管理
           </button>
        </div>
      </div>
    </div>

    <!-- 标签页导航 (Tabs) -->
    <TransitionGroup 
      name="tabs-list" 
      tag="div" 
      class="flex gap-8 text-[15px] font-medium mt-auto w-full select-none touch-none"
    >
      <div 
        v-for="(tab, index) in tabs" 
        :key="tab.id"
        class="relative flex items-center shrink-0"
      >
        <!-- 插入指示线 (左侧) -->
        <div 
          v-if="isDragging && targetInsertIndex === index" 
          class="absolute left-[-16px] w-[3px] h-5 bg-[#EC4141] rounded-full animate-pulse transition-all z-20 pointer-events-none"
        ></div>

        <button 
          :data-artist-tab-id="tab.id"
          class="pb-1.5 transition-all relative cursor-pointer select-none touch-none no-user-drag"
          :class="[
            activeTab === tab.id 
              ? 'text-gray-900 dark:text-white font-bold' 
              : 'text-black/60 dark:text-white/60 hover:text-black/90 dark:hover:text-white/90',
            draggedTabId === tab.id ? 'opacity-60 scale-95 cursor-grabbing' : ''
          ]"
          @pointerdown="onPointerDown(tab.id, $event)"
          @click="handleTabClick(tab.id)"
        >
          <span class="pointer-events-none">{{ tab.name }}</span>
          <div 
            v-if="activeTab === tab.id" 
            class="absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 h-[3px] bg-[#EC4141] rounded-t-full pointer-events-none"
          ></div>
        </button>

        <!-- 插入指示线 (右侧，仅针对最后一个元素的右侧插入) -->
        <div 
          v-if="isDragging && targetInsertIndex === tabs.length && index === tabs.length - 1" 
          class="absolute right-[-16px] w-[3px] h-5 bg-[#EC4141] rounded-full animate-pulse transition-all z-20 pointer-events-none"
        ></div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.tabs-list-move {
  transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.no-user-drag {
  -webkit-user-drag: none;
  user-drag: none;
}
</style>
