<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { albumHeaderCache } from '../../caches/imageCaches';
import { useCoverCache } from '../../composables/useCoverCache';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import SortModeIcon from '../common/SortModeIcon.vue';

const props = defineProps<{
  albumName: string;
  albumArtist: string;
  isBatchMode: boolean;
  selectedCount?: number;
  songs?: Array<{ path: string }>;
  songPaths?: string[];
}>();

const emit = defineEmits([
  'update:isBatchMode',
  'playAll',
  'batchPlay',
  'addToPlaylist',
  'batchDelete',
  'batchMove'
]);

const {
  albumDetailSortMode,
  setAlbumDetailSortMode,
} = usePlayerViewState();

const sortLabelMap = {
  track_number: '音轨号',
  title: '歌曲名',
  artist: '歌手',
  added_at: '添加时间',
  file_modified_at: '修改时间',
} as const;

const showSortMenu = ref(false);
const sortMenuX = ref(0);
const sortMenuY = ref(0);
const sortMenuIsRightAligned = ref(false);

const coverUrl = ref('');
const isLoading = ref(false);
const artistName = computed(() => props.albumArtist || '未知歌手');
const albumCacheKey = computed(() => `${props.albumName}::${props.albumArtist || '未知歌手'}`);
const { loadCover, peekCoverUrl } = useCoverCache();
let coverRequestId = 0;

const handleSortClick = (e: MouseEvent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const windowWidth = window.innerWidth;

  if (rect.left > windowWidth / 2) {
    sortMenuIsRightAligned.value = true;
    sortMenuX.value = windowWidth - rect.right;
  } else {
    sortMenuIsRightAligned.value = false;
    sortMenuX.value = rect.left;
  }

  sortMenuY.value = rect.bottom + 8;
  showSortMenu.value = !showSortMenu.value;
};

const handleGlobalClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.sort-menu-trigger')) {
    showSortMenu.value = false;
  }
};

onMounted(() => window.addEventListener('click', handleGlobalClick));
onUnmounted(() => window.removeEventListener('click', handleGlobalClick));

watch([albumCacheKey, () => props.songPaths, () => props.songs], async ([cacheKey, songPaths, newSongs]) => {
  const requestId = ++coverRequestId;

  const firstSongPath = songPaths?.[0] ?? newSongs?.[0]?.path;
  if (!firstSongPath) {
    coverUrl.value = '';
    isLoading.value = false;
    return;
  }

  const cachedCover = albumHeaderCache.get(cacheKey);
  if (cachedCover) {
    coverUrl.value = cachedCover;
    isLoading.value = false;
    return;
  }

  const cachedThumbnail = peekCoverUrl(firstSongPath);
  if (cachedThumbnail) {
    coverUrl.value = cachedThumbnail;
    albumHeaderCache.set(cacheKey, cachedThumbnail);
    isLoading.value = false;
    return;
  }

  isLoading.value = true;
  try {
    const resolvedCover = await loadCover(firstSongPath);
    if (requestId !== coverRequestId) return;

    if (resolvedCover) {
      coverUrl.value = resolvedCover;
      albumHeaderCache.set(cacheKey, resolvedCover);
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
  'from-blue-500 to-cyan-500',
  'from-purple-500 to-pink-500',
  'from-emerald-400 to-teal-500',
  'from-orange-400 to-rose-400',
  'from-indigo-500 to-purple-500',
  'from-rose-400 to-red-500',
  'from-fuchsia-500 to-pink-500',
  'from-amber-400 to-orange-500',
];

const getGradientForAlbum = (name: string) => {
  if (!name) return gradients[0];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
};
</script>

<template>
  <div class="px-8 shrink-0 select-none flex flex-col pt-6 pb-0 h-auto justify-start border-b border-black/5 dark:border-white/5 relative z-10 w-full bg-transparent">
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

    <div v-else class="flex gap-6 h-auto mt-2 mb-6">
      <div class="w-36 h-36 rounded-lg shadow-sm flex items-center justify-center shrink-0 overflow-hidden group relative select-none bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10">
        <div v-if="isLoading" class="w-full h-full bg-gray-200 dark:bg-white/10 animate-pulse"></div>
        <img v-else-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover select-none animate-in fade-in duration-300" draggable="false" :alt="albumName" />
        <div v-else class="w-full h-full flex items-center justify-center text-4xl font-bold text-white bg-gradient-to-br animate-in fade-in duration-300" :class="getGradientForAlbum(albumName)">
          ♪
        </div>
      </div>

      <div class="h-36 flex flex-col justify-start pt-2 pb-1 flex-1 min-w-0">
        <div class="mb-4">
          <h1 class="text-[32px] font-bold text-gray-900 dark:text-white truncate max-w-[600px] leading-tight flex items-center gap-2">
            <span class="bg-[#EC4141] text-white text-[12px] px-1.5 py-0.5 rounded border border-[#EC4141] font-normal leading-none -mt-1 relative top-[1px]">专辑</span>
            {{ albumName }}
          </h1>
          <p class="text-[14px] text-gray-500 dark:text-gray-400 mt-2 truncate w-full flex items-center gap-2">
            <span>专辑艺人:</span>
            <span class="text-[#507DAF] dark:text-[#6a9adb]">{{ artistName }}</span>
          </p>
        </div>

        <div class="flex items-center gap-3 mt-auto">
          <button @click="emit('playAll')" class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-6 py-2 rounded-full text-[15px] font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 5.5v13l10-6.5-10-6.5Z" />
            </svg>
            播放
          </button>

          <button @click="emit('update:isBatchMode', true)" title="批量操作" class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-5 py-2 rounded-full text-[15px] font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            管理
          </button>

          <button
            @click.stop="handleSortClick"
            title="排序方式"
            class="sort-menu-trigger bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-5 py-2 rounded-full text-[15px] font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          >
            <SortModeIcon class="h-5 w-5" />
            排序
          </button>

          <Teleport to="body">
            <div
              v-if="showSortMenu"
              class="fixed z-[9999] bg-white dark:bg-[#2b2b2b] rounded-lg shadow-xl border border-gray-100 dark:border-white/10 py-1 min-w-[120px] isolate animate-in fade-in zoom-in-95 duration-100"
              :style="sortMenuIsRightAligned
                ? { right: sortMenuX + 'px', top: sortMenuY + 'px' }
                : { left: sortMenuX + 'px', top: sortMenuY + 'px' }"
            >
              <div
                v-for="mode in (['track_number', 'title', 'artist', 'added_at', 'file_modified_at'] as const)"
                :key="mode"
                @click="
                  if (mode === 'track_number') {
                    setAlbumDetailSortMode(albumDetailSortMode === 'track_number' ? 'track_number_desc' : 'track_number');
                  } else if (mode === 'added_at') {
                    setAlbumDetailSortMode(albumDetailSortMode === 'added_at' ? 'added_at_asc' : 'added_at');
                  } else if (mode === 'file_modified_at') {
                    setAlbumDetailSortMode(albumDetailSortMode === 'file_modified_at' ? 'file_modified_at_asc' : 'file_modified_at');
                  } else {
                    setAlbumDetailSortMode(mode);
                  }
                  showSortMenu = false;
                "
                class="px-3 py-2 text-xs cursor-pointer flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                :class="(albumDetailSortMode || '').startsWith(mode) ? 'text-blue-500 font-medium' : 'text-gray-600 dark:text-gray-300'"
              >
                <span>{{ sortLabelMap[mode] }}</span>
                <div v-if="(albumDetailSortMode || '').startsWith(mode)" class="flex items-center gap-1.5">
                  <svg v-if="mode === 'track_number' || mode === 'added_at' || mode === 'file_modified_at'" xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 transition-transform duration-200" :class="{ 'rotate-180': albumDetailSortMode === 'track_number_desc' || albumDetailSortMode === 'added_at_asc' || albumDetailSortMode === 'file_modified_at_asc' }" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l2.293-2.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>
          </Teleport>
        </div>
      </div>
    </div>

    <div class="flex gap-8 text-[15px] font-medium mt-auto w-full">
      <div class="pb-1.5 transition-colors relative text-gray-900 dark:text-white font-bold">
        歌曲
        <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 h-[3px] bg-[#EC4141] rounded-t-full"></div>
      </div>
    </div>
  </div>
</template>
