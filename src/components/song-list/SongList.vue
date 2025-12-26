<script setup lang="ts">
import { usePlayer, Song, dragSession } from '../../composables/player';
import { computed, watch, ref, reactive, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { invoke } from '@tauri-apps/api/core';
import SongListHeader from './SongListHeader.vue';
import SongListSidebar from './SongListSidebar.vue';
import AddToPlaylistModal from '../overlays/AddToPlaylistModal.vue';
import SongContextMenu from '../overlays/SongContextMenu.vue';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import FavoritesGrid from '../common/FavoritesGrid.vue';
import DragGhost from '../common/DragGhost.vue';
import MoveToFolderModal from '../overlays/MoveToFolderModal.vue';

const route = useRoute();
const router = useRouter();

const { 
  songList, displaySongList, currentViewMode, 
  favTab, favDetailFilter, 
  playSong, isFavorite, toggleFavorite, formatDuration,
  addSongsToPlaylist, favoritePaths, moveFilesToFolder,
  switchViewToAll, switchToRecent, switchToFavorites,
  recentAlbumList, recentPlaylistList
} = usePlayer();

// --- Virtual Scroll Logic ---
const ROW_HEIGHT = 60; // Fixed row height
const containerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const containerHeight = ref(600); // Initial fallback

const updateContainerHeight = () => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight;
  }
};

const virtualData = computed(() => {
  const total = displaySongList.value.length;
  const start = Math.floor(scrollTop.value / ROW_HEIGHT);
  const visibleCount = Math.ceil(containerHeight.value / ROW_HEIGHT);
  
  // Buffer: render a few items before and after
  const buffer = 5;
  const renderStart = Math.max(0, start - buffer);
  const renderEnd = Math.min(total, start + visibleCount + buffer);
  
  const paddingTop = renderStart * ROW_HEIGHT;
  const paddingBottom = (total - renderEnd) * ROW_HEIGHT;
  
  const items = displaySongList.value.slice(renderStart, renderEnd).map((song, index) => ({
    ...song,
    originalIndex: renderStart + index // Keep track of actual index
  }));

  return { items, paddingTop, paddingBottom };
});

const onScroll = (e: Event) => {
  const target = e.target as HTMLElement;
  scrollTop.value = target.scrollTop;
};

// --- Resize Observer for Auto Height ---
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => updateContainerHeight());
    resizeObserver.observe(containerRef.value);
    updateContainerHeight();
  }
});
onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect();
});

// --- 🟢 核心修改：基于 Base64 的按需加载缓存池 ---
const coverCache = reactive(new Map<string, string>());
const MAX_CACHE_SIZE = 150; // 缓存池稍微加大一点

// 使用 Set 追踪正在加载的，防止重复请求
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
          
          if (dataUrl) {
            if (coverCache.has(song.path)) coverCache.delete(song.path);
            coverCache.set(song.path, dataUrl);
              
            // LRU
            if (coverCache.size > MAX_CACHE_SIZE) {
              const oldestKey = coverCache.keys().next().value;
              if (oldestKey) coverCache.delete(oldestKey);
            }
          } else {
             coverCache.set(song.path, '');
          }
        } catch (e) {
          coverCache.set(song.path, '');
        } finally {
          loadingSet.delete(song.path);
        }
      });
    }, 20); // 20ms 防抖
  };
})();

// 监听虚拟列表变化
watch(() => virtualData.value.items, (newItems) => {
  loadCoverDebounced(newItems);
}, { immediate: true });

// ... (以下逻辑保持不变) ...

const isLocalMusic = computed(() => currentViewMode.value === 'all' && route.path === '/');
const isFavorites = computed(() => route.path === '/favorites');
const isFolderMode = computed(() => currentViewMode.value === 'folder' && route.path === '/');
const isPlaylistMode = computed(() => currentViewMode.value === 'playlist');

const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());
const lastSelectedIndex = ref<number>(-1); 
const isSelectionDragging = ref(false); 
const dragSelectAction = ref<'select' | 'deselect' | null>(null);

const showAddToPlaylistModal = ref(false);
const showMoveToFolderModal = ref(false);
const toastMessage = ref('');
const showToast = ref(false);
const showConfirm = ref(false);
const confirmMessage = ref('');
const confirmAction = ref<() => void>(() => {});

const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetSong = ref<Song | null>(null);

// ❌ 已删除旧的 getCoverUrl 函数

watch(isBatchMode, (newVal) => {
  if (!newVal) {
    selectedPaths.value.clear();
    lastSelectedIndex.value = -1;
    isSelectionDragging.value = false;
    dragSelectAction.value = null;
  }
});

const handleBatchSelect = (event: MouseEvent, song: Song, index: number) => {
  if (!isBatchMode.value) return;
  if (event.shiftKey && lastSelectedIndex.value !== -1) {
    const start = Math.min(lastSelectedIndex.value, index);
    const end = Math.max(lastSelectedIndex.value, index);
    for (let i = start; i <= end; i++) {
      if (displaySongList.value[i]) selectedPaths.value.add(displaySongList.value[i].path);
    }
  } else {
    if (selectedPaths.value.has(song.path)) selectedPaths.value.delete(song.path);
    else selectedPaths.value.add(song.path);
    lastSelectedIndex.value = index;
  }
};

const handleRowMouseEnter = (song: Song, index: number) => {
  if (isBatchMode.value && isSelectionDragging.value && dragSelectAction.value) {
    if (dragSelectAction.value === 'select') selectedPaths.value.add(song.path);
    else selectedPaths.value.delete(song.path);
    lastSelectedIndex.value = index;
  }
};

const toggleSelectAll = () => { if (selectedPaths.value.size === displaySongList.value.length) selectedPaths.value.clear(); else displaySongList.value.forEach(s => selectedPaths.value.add(s.path)); };
const handleBatchPlay = () => { const selected = displaySongList.value.filter(s => selectedPaths.value.has(s.path)); if (selected.length > 0) playSong(selected[0]); };
const handleAddToPlaylist = (playlistId: string) => { const songsToAdd = isBatchMode.value ? Array.from(selectedPaths.value) : (contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : []); const addedCount = addSongsToPlaylist(playlistId, songsToAdd); showAddToPlaylistModal.value = false; toastMessage.value = addedCount === 0 ? "歌单内歌曲重复" : "已加入歌单"; showToast.value = true; setTimeout(() => showToast.value = false, 2000); };
const executeBatchDelete = () => { if (isLocalMusic.value) { const newPathSet = new Set(selectedPaths.value); songList.value = songList.value.filter(s => !newPathSet.has(s.path)); } else if (isFavorites.value) { const newPathSet = new Set(selectedPaths.value); favoritePaths.value = favoritePaths.value.filter(p => !newPathSet.has(p)); } selectedPaths.value.clear(); showConfirm.value = false; };
const requestBatchDelete = () => { if (selectedPaths.value.size === 0) return; confirmMessage.value = `确定要移除选中的 ${selectedPaths.value.size} 首歌曲吗？`; confirmAction.value = executeBatchDelete; showConfirm.value = true; };

const handleBatchMove = () => {
  if (selectedPaths.value.size === 0) return;
  showMoveToFolderModal.value = true;
};

const confirmBatchMove = async (targetFolder: string, folderName: string) => {
  try {
    const paths = Array.from(selectedPaths.value);
    const count = await moveFilesToFolder(paths, targetFolder);
    toastMessage.value = `已成功移动 ${count} 首歌曲到 "${folderName}"`;
    showToast.value = true;
    setTimeout(() => showToast.value = false, 3000);
    showMoveToFolderModal.value = false;
    selectedPaths.value.clear();
  } catch (e) {
    alert("移动失败: " + e);
  }
};

let isMouseDown = false;
let startX = 0;
let startY = 0;
const listBodyRef = ref<HTMLElement | null>(null);

const handleMouseDown = (e: MouseEvent, song: Song, index: number) => {
  if (e.button !== 0) return; 
  isMouseDown = true;
  startX = e.clientX;
  startY = e.clientY;

  if (isBatchMode.value) {
    const tr = e.currentTarget as HTMLElement;
    const rect = tr.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    if (percent < 0.6) {
      isSelectionDragging.value = true;
      handleBatchSelect(e, song, index);
      if (selectedPaths.value.has(song.path)) dragSelectAction.value = 'select';
      else dragSelectAction.value = 'deselect';
    } else {
      isSelectionDragging.value = false;
      if (!selectedPaths.value.has(song.path)) {
         selectedPaths.value.add(song.path);
      }
      dragSession.songs = displaySongList.value.filter(s => selectedPaths.value.has(s.path));
    }
  } else {
    if (isFolderMode.value || isPlaylistMode.value || isLocalMusic.value) {
      dragSession.songs = [song]; 
    }
  }
};

const onGlobalMouseMove = (e: MouseEvent) => {
  if (!isMouseDown) return;
  if (isBatchMode.value && isSelectionDragging.value) return; 

  if (!dragSession.active) {
    const dist = Math.sqrt(Math.pow(e.clientX - startX, 2) + Math.pow(e.clientY - startY, 2));
    if (dist > 5) {
      dragSession.active = true;
    }
  }

  if (dragSession.active) {
    dragSession.mouseX = e.clientX;
    dragSession.mouseY = e.clientY;
    
    const target = document.elementFromPoint(e.clientX, e.clientY);
    
    const folderEl = target?.closest('.folder-drop-target');
    if (folderEl) {
      const path = folderEl.getAttribute('data-folder-path');
      const name = folderEl.getAttribute('data-folder-name');
      if (path && name) {
        dragSession.targetFolder = { path, name };
        dragSession.targetPlaylist = null;
        dragSession.sortLineTop = -1; 
        return; 
      }
    } else {
      dragSession.targetFolder = null;
    }

    const playlistEl = target?.closest('.playlist-drop-target');
    if (playlistEl) {
      const id = playlistEl.getAttribute('data-playlist-id');
      const name = playlistEl.getAttribute('data-playlist-name');
      if (id && name) {
        dragSession.targetPlaylist = { id, name };
        dragSession.targetFolder = null;
        dragSession.sortLineTop = -1;
        return;
      }
    } else {
      dragSession.targetPlaylist = null;
    }

    if (!dragSession.targetFolder && !dragSession.targetPlaylist) {
      const row = target?.closest('tr');
      if (row && listBodyRef.value && listBodyRef.value.contains(row)) {
        const rect = row.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;
        const rowIndex = parseInt(row.getAttribute('data-index') || '0');
        const rowOffsetTop = (row as HTMLElement).offsetTop;
        const rowHeight = (row as HTMLElement).offsetHeight;

        if (relativeY < rect.height / 2) {
          dragSession.insertIndex = rowIndex;
          dragSession.sortLineTop = rowOffsetTop;
        } else {
          dragSession.insertIndex = rowIndex + 1;
          dragSession.sortLineTop = rowOffsetTop + rowHeight;
        }
      } else {
        dragSession.sortLineTop = -1;
        dragSession.insertIndex = -1;
      }
    }
  }
};

const onGlobalMouseUp = () => {
  isMouseDown = false;
  isSelectionDragging.value = false;
  dragSelectAction.value = null;

  if (dragSession.active) {
    if (dragSession.targetFolder) {
      window.dispatchEvent(new CustomEvent('custom-drop-trigger'));
    } else if (dragSession.targetPlaylist) {
      const paths = dragSession.songs.map(s => s.path);
      const count = addSongsToPlaylist(dragSession.targetPlaylist.id, paths);
      toastMessage.value = count > 0 ? `已添加 ${count} 首歌曲到 ${dragSession.targetPlaylist.name}` : '歌曲已存在于歌单';
      showToast.value = true;
      setTimeout(() => showToast.value = false, 2000);
    } else if (dragSession.insertIndex !== -1 && dragSession.songs.length > 0) {
      const sourcePath = dragSession.songs[0].path;
      const sourceIndex = songList.value.findIndex(s => s.path === sourcePath);
      if (sourceIndex !== -1) {
        const [movedSong] = songList.value.splice(sourceIndex, 1);
        let targetIndex = dragSession.insertIndex;
        if (sourceIndex < targetIndex) targetIndex -= 1;
        songList.value.splice(targetIndex, 0, movedSong);
      }
    }
    dragSession.active = false;
    dragSession.sortLineTop = -1;
    dragSession.insertIndex = -1;
    setTimeout(() => { 
      dragSession.targetFolder = null; 
      dragSession.targetPlaylist = null;
    }, 100);
  }
};

onMounted(() => {
  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('mouseup', onGlobalMouseUp);
});
onUnmounted(() => {
  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
});

const handleContextMenu = (e: MouseEvent, song: Song) => { if (isBatchMode.value) return; contextMenuTargetSong.value = song; contextMenuX.value = e.clientX; const menuHeight = 250; if (e.clientY + menuHeight > window.innerHeight) contextMenuY.value = e.clientY - menuHeight; else contextMenuY.value = e.clientY; showContextMenu.value = true; };
const openAddToPlaylistFromMenu = () => { showAddToPlaylistModal.value = true; };
const enterFavDetail = (type: 'artist' | 'album', name: string) => { router.push({ query: { type, name } }); };

watch(() => route.path, (path) => { if (path === '/favorites') switchToFavorites(); else if (path === '/recent') switchToRecent(); else if (path === '/') { if (currentViewMode.value !== 'folder' && currentViewMode.value !== 'playlist') switchViewToAll(); } }, { immediate: true });
watch(() => route.query, (q) => { if (isFavorites.value && q.type && q.name) { favDetailFilter.value = { type: q.type as 'artist' | 'album', name: q.name as string }; } else if (isFavorites.value) favDetailFilter.value = null; }, { immediate: true });
const sidebarImageCache = ref<Map<string, string>>(new Map());
const loadSidebarCover = async (path: string) => { if (!path || sidebarImageCache.value.has(path)) return; try { const cover = await invoke<string>('get_song_cover', { path }); if (cover) sidebarImageCache.value.set(path, cover); } catch {} };
watch([recentAlbumList, recentPlaylistList], () => { recentAlbumList.value.forEach(item => { if (item.firstSongPath) loadSidebarCover(item.firstSongPath); }); recentPlaylistList.value.forEach(item => { if (item.firstSongPath) loadSidebarCover(item.firstSongPath); }); }, { immediate: true, deep: true });

</script>

<template>
  <div class="flex-1 flex flex-col h-full bg-transparent relative transition-colors duration-500">
    <DragGhost /> 
    <SongListHeader v-model:isBatchMode="isBatchMode" @batchPlay="handleBatchPlay" @openAddToPlaylist="showAddToPlaylistModal = true" @batchDelete="requestBatchDelete" @batchMove="handleBatchMove" />

    <div class="flex-1 flex overflow-hidden relative">
      <SongListSidebar />

      <section ref="containerRef" class="flex-1 overflow-y-auto pl-2.5 pr-3 pb-8 custom-scrollbar" @scroll="onScroll">
        <FavoritesGrid v-if="isFavorites && !favDetailFilter && favTab !== 'songs'" @enterDetail="enterFavDetail"/>

        <table v-else-if="displaySongList.length > 0 || isBatchMode" class="w-full text-left text-sm text-gray-600 table-fixed relative border-collapse">
          <thead class="select-none border-b border-black/5">
            <tr class="text-gray-500 text-xs">
              <th class="py-3 font-normal w-12 text-center">
                <input v-if="isBatchMode" type="checkbox" @change="toggleSelectAll" :checked="selectedPaths.size === displaySongList.length && displaySongList.length > 0" class="rounded text-[#EC4141] focus:ring-[#EC4141] cursor-pointer" />
                <span v-else>#</span>
              </th> 
              <th class="py-3 font-normal w-[40%]">音乐标题</th>
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
              :data-index="song.originalIndex"
              @mousedown="handleMouseDown($event, song, song.originalIndex)" 
              @mouseenter="handleRowMouseEnter(song, song.originalIndex)"
              @dblclick="!isBatchMode && playSong(song)"
              @contextmenu.prevent="handleContextMenu($event, song)"
              class="group border-b border-black/5 transition-colors hover:bg-black/5 select-none cursor-default" 
              :style="{ height: ROW_HEIGHT + 'px' }"
              :class="{
                'bg-red-500/10': selectedPaths.has(song.path),
                'opacity-40': dragSession.active && dragSession.songs[0]?.path === song.path
              }"
            >
              <td class="py-3 flex items-center justify-center h-full">
                 <div v-if="isBatchMode" class="flex items-center justify-center w-full h-full">
                   <input type="checkbox" :checked="selectedPaths.has(song.path)" class="rounded text-[#EC4141] focus:ring-[#EC4141] pointer-events-none" />
                 </div>
                 <div v-else class="w-full text-center">
                   <span class="text-xs font-mono text-gray-400 group-hover:hidden">{{ song.originalIndex + 1 < 10 ? '0' + (song.originalIndex + 1) : song.originalIndex + 1 }}</span>
                   <span v-if="isFolderMode || isPlaylistMode || isLocalMusic" class="hidden group-hover:block text-gray-500 active:text-[#EC4141]">
                     <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
                   </span>
                   <span v-else class="hidden group-hover:block text-gray-500">
                     <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mx-auto" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
                   </span>
                 </div>
              </td>
              
              <td class="py-3 pr-4 overflow-hidden">
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
        <div v-else class="py-20 text-center select-none text-gray-500">列表为空</div>
      </section>
    </div>
    
    <AddToPlaylistModal :visible="showAddToPlaylistModal" :selectedCount="isBatchMode ? selectedPaths.size : 1" @close="showAddToPlaylistModal = false" @add="handleAddToPlaylist"/>
    <MoveToFolderModal :visible="showMoveToFolderModal" :selectedCount="selectedPaths.size" @close="showMoveToFolderModal = false" @confirm="confirmBatchMove" />
    <SongContextMenu :visible="showContextMenu" :x="contextMenuX" :y="contextMenuY" :song="contextMenuTargetSong" :is-playlist-view="isPlaylistMode" @close="showContextMenu = false" @add-to-playlist="openAddToPlaylistFromMenu" />
    <ConfirmModal :visible="showConfirm" title="my-cloud-music" :content="confirmMessage" @confirm="executeBatchDelete" @cancel="showConfirm = false" />

    <Teleport to="body">
      <div v-if="showToast" class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/70 text-white px-6 py-2 rounded-full text-sm shadow-lg z-[10000] animate-in fade-in duration-200">{{ toastMessage }}</div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 方案一：完全隐藏滚动条 */
.custom-scrollbar::-webkit-scrollbar {
  display: none;
  width: 0 !important;
  height: 0 !important;
  -webkit-appearance: none;
  background: transparent;
}
.custom-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.sort-line {
  height: 2px;
  background: radial-gradient(ellipse at center, rgba(236,65,65,0.7) 0%, rgba(236,65,65,0) 80%);
  box-shadow: 0 1px 2px rgba(236,65,65,0.2);
}
</style>