<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onUnmounted } from 'vue';
import type { Song } from '../../types';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { useCoverCache } from '../../composables/useCoverCache';
import SortModeIcon from '../common/SortModeIcon.vue';
import { usePlaylistSort } from '../../features/collections/usePlaylistSort';
import { useCollectionsStore } from '../../features/collections/store';
import { playlistSortLabel } from '../../features/collections/playlistSort';
import PlaylistSourcePanel from '../playlists/PlaylistSourcePanel.vue';
import { unresolvedCount } from '../../features/playlistImport/types';
import { usePlaylistImportDialog } from '../../features/playlistImport/dialog';

const { playlistSortMode, setPlaylistSortMode, currentViewMode, filterCondition } = usePlayerViewState();
const { playlists } = useLibraryCollections();
const { followsDefault } = usePlaylistSort();
const collectionsStore = useCollectionsStore();
const currentPlaylist = computed(() => playlists.value.find(p => p.id === filterCondition.value));
const pendingCount = computed(() => unresolvedCount(currentPlaylist.value?.importData));
const importDialog = usePlaylistImportDialog();
const defaultSortLabel = computed(() => playlistSortLabel(collectionsStore.playlistSortMode));
const sortTitle = computed(() => `排序：${playlistSortLabel(playlistSortMode.value)} · ${followsDefault.value ? '跟随默认' : '当前歌单'}`);
const sortTrigger = ref<HTMLButtonElement | null>(null);
const sortMenu = ref<HTMLElement | null>(null);
const sortMenuMaxHeight = ref(320);
const closeSortMenu = () => { showSortMenu.value = false; };
const finishSortSelection = () => {
  closeSortMenu();
  sortTrigger.value?.focus({ preventScroll: true });
};
const handleMenuKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    finishSortSelection();
  } else if (event.key === 'Tab') closeSortMenu();
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const items = Array.from(sortMenu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  }
};

const showSortMenu = ref(false);
const sortMenuX = ref(0);
const sortMenuY = ref(0);
const sortMenuIsRightAligned = ref(false);

const handleSortClick = (e: MouseEvent | KeyboardEvent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const windowWidth = window.innerWidth;
  
  if (rect.left > windowWidth / 2) {
    sortMenuIsRightAligned.value = true;
    sortMenuX.value = windowWidth - rect.right;
  } else {
    sortMenuIsRightAligned.value = false;
    sortMenuX.value = rect.left;
  }
  
  const below = window.innerHeight - rect.bottom - 16;
  const above = rect.top - 16;
  const downward = below >= 320 || below >= above;
  sortMenuMaxHeight.value = Math.max(0, downward ? below : above);
  sortMenuY.value = downward ? rect.bottom + 8 : Math.max(8, rect.top - 8 - Math.min(320, above));
  if (sortMenuIsRightAligned.value) sortMenuX.value = Math.max(8, sortMenuX.value);
  else sortMenuX.value = Math.max(8, Math.min(sortMenuX.value, windowWidth - 228));
  showSortMenu.value = !showSortMenu.value;
  if (showSortMenu.value) void nextTick(() => {
    sortMenu.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  });
};

const handleGlobalClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.sort-menu-trigger')) {
    showSortMenu.value = false;
  }
};

onMounted(() => {
  window.addEventListener('click', handleGlobalClick);
  window.addEventListener('resize', closeSortMenu);
});
onUnmounted(() => {
  window.removeEventListener('click', handleGlobalClick);
  window.removeEventListener('resize', closeSortMenu);
});
watch([currentViewMode, filterCondition], closeSortMenu);

const props = defineProps<{
  title: string;
  subtitle?: string;
  songs: Song[];
  isBatchMode: boolean;
  selectedCount: number;
  showRename?: boolean;
}>();

const emit = defineEmits([
  'update:isBatchMode',
  'playAll',
  'batchPlay',
  'batchDelete',
  'openAddToPlaylist',
  'rename'
]);

const headerCover = ref('');
let coverRequestId = 0;
let headerCoverPath = '';
let headerCoverResetVersion = -1;
const { loadCover, peekCoverUrl, coverCacheResetVersion, coverCacheResumeVersion } = useCoverCache();

const updateHeaderCover = async () => {
  const requestId = ++coverRequestId;

  const firstSongPath = currentViewMode.value === 'playlist'
    ? playlists.value.find(playlist => playlist.id === filterCondition.value)?.songPaths[0]
    : props.songs[0]?.path;
  if (!firstSongPath) {
    headerCoverPath = '';
    headerCover.value = '';
    return;
  }

  if (headerCoverPath !== firstSongPath || headerCoverResetVersion !== coverCacheResetVersion.value) {
    headerCoverPath = firstSongPath;
    headerCoverResetVersion = coverCacheResetVersion.value;
    headerCover.value = peekCoverUrl(firstSongPath, 'card') || peekCoverUrl(firstSongPath) || '';
  }

  try {
    const cardCover = await loadCover(firstSongPath, 'card');
    if (requestId !== coverRequestId) return;
    if (cardCover) {
      headerCover.value = cardCover;
      return;
    }

    const thumbnailCover = await loadCover(firstSongPath);
    if (requestId !== coverRequestId) return;
    headerCover.value = thumbnailCover || headerCover.value;
  } catch {
    // Keep the current source's placeholder until the next load or window restore.
  }
};

watch([() => props.songs, currentViewMode, filterCondition, coverCacheResetVersion, coverCacheResumeVersion], updateHeaderCover, { immediate: true });

const handlePlayAll = () => {
  emit('playAll');
};
</script>

<template>
  <div class="px-6 shrink-0 select-none flex flex-col pt-2 pb-4 h-auto justify-start">
    
    <!-- 批量操作模式 -->
    <div v-if="isBatchMode" class="flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-200">
      <div class="flex items-center gap-3">
        <button @click="emit('batchPlay')" class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 py-1.5 rounded-full text-sm transition flex items-center gap-1 active:scale-95 shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
        </button>
        <button @click="emit('openAddToPlaylist')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg> 收藏到歌单
        </button>
        <button @click="emit('batchDelete')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> 移除
        </button>
      </div>
      <div class="flex items-center gap-4">
        <button @click="emit('update:isBatchMode', false)" class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1 rounded transition">完成</button>
      </div>
    </div>

    <!-- 详情展示模式 -->
    <div v-else class="flex gap-4 sm:gap-6 h-auto mt-1">
      <!-- 封面图 -->
      <div class="w-24 h-24 sm:w-32 sm:h-32 rounded-2xl shadow-sm flex items-center justify-center shrink-0 overflow-hidden group relative select-none bg-gray-100 dark:bg-white/5">
        <img v-if="headerCover" :src="headerCover" class="w-full h-full object-cover animate-in fade-in duration-300" alt="Cover" />
        <div v-else class="flex flex-col items-center justify-center h-full w-full">
           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-16 h-16 text-indigo-500/50 mb-2 drop-shadow-md"><path fill-rule="evenodd" d="M19.952 1.651a.75.75 0 01.298.599V16.303a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V6.994l-9 2.572v9.737a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V9.017c0-.528.246-1.032.67-1.371l10.038-5.996z" clip-rule="evenodd" /></svg>
        </div>
      </div>
      
      <!-- 文本信息与操作 -->
      <div class="min-h-24 sm:min-h-32 flex flex-col justify-between gap-3 py-1 flex-1 min-w-0">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <h1 class="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-white truncate max-w-[500px]">{{ title }}</h1>
            <button 
              v-if="showRename" 
              @click="emit('rename')" 
              class="text-gray-500 dark:text-white/60 hover:text-gray-800 dark:hover:text-white transition p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 shrink-0"
              title="修改名称"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
          
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span>{{ currentPlaylist?.songPaths.length ?? songs.length }} 首歌曲</span>
            <span v-if="subtitle">{{ subtitle }}</span>
            <button v-if="pendingCount" type="button" class="text-amber-600 dark:text-amber-400 hover:underline" @click="importDialog.open(filterCondition)">{{ pendingCount }} 首待匹配</button>
            <span v-if="currentPlaylist?.importData?.error" class="text-amber-600 dark:text-amber-400" :title="currentPlaylist.importData.error">源文件更新异常</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 sm:gap-3">
           <button @click="handlePlayAll" title="播放全部" class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-5 py-2 rounded-full text-sm font-medium transition flex items-center active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20">
             <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M9 5.5v13l10-6.5-10-6.5Z" />
             </svg>
           </button>
           
           <button @click="emit('update:isBatchMode', true)" title="批量操作" class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-5 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20">
             <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
             </svg>
           </button>

           <!-- 排序方式按钮 -->
           <button 
             @click.stop="handleSortClick"
             ref="sortTrigger"
             :title="sortTitle"
             :aria-label="sortTitle"
             aria-haspopup="menu"
             :aria-expanded="showSortMenu"
             @keydown.down.prevent="handleSortClick"
             class="sort-menu-trigger bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-5 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
             :class="{ 'text-blue-500 border-blue-200 bg-blue-50/50 dark:bg-blue-500/10': playlistSortMode !== 'custom' }"
           >
             <SortModeIcon class="h-5 w-5" />
           </button>

           <PlaylistSourcePanel v-if="currentViewMode === 'playlist'" :key="filterCondition" :playlist-id="filterCondition" />

           <!-- 排序菜单 -->
           <Teleport to="body">
             <div 
               v-if="showSortMenu"
               ref="sortMenu"
               role="menu"
               aria-label="当前歌单排序"
               @click.stop
               @keydown="handleMenuKey"
               class="fixed z-[9999] bg-white dark:bg-[#2b2b2b] rounded-lg shadow-xl border border-gray-100 dark:border-white/10 py-1 w-[220px] max-w-[calc(100vw-16px)] overflow-y-auto isolate animate-in fade-in zoom-in-95 duration-100"
               :style="[ { maxHeight: sortMenuMaxHeight + 'px' }, sortMenuIsRightAligned
                 ? { right: sortMenuX + 'px', top: sortMenuY + 'px' }
                 : { left: sortMenuX + 'px', top: sortMenuY + 'px' } ]"
             >
               <div class="px-3 py-2 text-xs text-gray-400">当前歌单排序</div>
               <button type="button" role="menuitemradio" :aria-checked="followsDefault"
                 class="w-full px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-white/10 focus-visible:outline focus-visible:outline-blue-500"
                 :class="followsDefault ? 'text-blue-500 font-medium' : 'text-gray-600 dark:text-gray-300'"
                 @click="setPlaylistSortMode(null); finishSortSelection()">
                 <span>跟随默认</span><span class="ml-auto text-gray-400 text-[10px]">{{ defaultSortLabel }}</span>
                 <span v-if="followsDefault" aria-hidden="true">✓</span>
               </button>
               <div role="separator" class="my-1 border-t border-gray-100 dark:border-white/10" />
               <button type="button" role="menuitemradio"
                 v-for="mode in (['title', 'name', 'artist', 'added_at', 'custom'] as const)" 
                 :key="mode"
                 :aria-checked="!followsDefault && playlistSortMode.startsWith(mode)"
                 @click="
                   if (mode === 'added_at') {
                     setPlaylistSortMode(!followsDefault && playlistSortMode === 'added_at' ? 'added_at_asc' : 'added_at');
                   } else {
                     setPlaylistSortMode(mode);
                   }
                   finishSortSelection();
                 "
                 class="w-full px-3 py-2 text-xs cursor-pointer flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-blue-500"
                 :class="!followsDefault && playlistSortMode.startsWith(mode) ? 'text-blue-500 font-medium' : 'text-gray-600 dark:text-gray-300'"
               >
                 <span>{{ { title: '\u6b4c\u66f2\u540d', name: '\u6587\u4ef6\u540d', artist: '\u6b4c\u624b', added_at: '\u6dfb\u52a0\u65f6\u95f4', custom: '\u81ea\u5b9a\u4e49' }[mode] }}</span>
                 <span v-if="mode === 'added_at' && playlistSortMode.startsWith(mode)" class="ml-auto mr-2 text-[10px] text-gray-400">{{ playlistSortMode === 'added_at_asc' ? '最早在前' : '最新在前' }}</span>
                 <div v-if="!followsDefault && playlistSortMode.startsWith(mode)" class="flex items-center gap-1.5">
                   <svg v-if="mode === 'added_at'" xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 transition-transform duration-200" :class="{ 'rotate-180': playlistSortMode === 'added_at_asc' }" viewBox="0 0 20 20" fill="currentColor">
                     <path fill-rule="evenodd" d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l2.293-2.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                   </svg>
                   <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                     <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                   </svg>
                 </div>
               </button>
               <div class="px-3 py-2 mt-1 border-t border-gray-100 dark:border-white/10 text-[10px] text-gray-400">仅影响当前歌单</div>
             </div>
           </Teleport>
        </div>
      </div>
    </div>

  </div>
</template>
