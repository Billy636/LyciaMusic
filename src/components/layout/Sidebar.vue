<script setup lang="ts">
import { ref, watch, } from 'vue';
import { usePlayer, dragSession } from '../../composables/player';
import { useRouter } from 'vue-router';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';

import ModernModal from '../common/ModernModal.vue';
import ModernInputModal from '../common/ModernInputModal.vue';
import PlaylistContextMenu from '../overlays/PlaylistContextMenu.vue';

const { 
  playlists, 
  songList, 
  switchViewToAll, 
  switchToFolderView, 
  switchToRecent, 
  createPlaylist, 
  deletePlaylist, 
  viewPlaylist,   
  currentViewMode, 
  filterCondition,
  playSong,
  addSongsToQueue,
  getSongsFromPlaylist,
  clearQueue,
  settings
} = usePlayer();

const router = useRouter();

const isPlaylistOpen = ref(true);

// --- Context Menu & Selection State ---
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const targetPlaylist = ref<{id: string, name: string} | null>(null);
const selectedPlaylistIds = ref<Set<string>>(new Set());
const lastSelectedPlaylistId = ref<string | null>(null);

// --- Create Playlist Modal State ---
const showCreateModal = ref(false);
const handleCreatePlaylist = () => {
  showCreateModal.value = true;
};
const confirmCreatePlaylist = (name: string) => {
  if (name) createPlaylist(name);
};
// ---------------------------------

// --- Delete Modal State ---
const showDeleteModal = ref(false);
const playlistsToDelete = ref<string[]>([]);
const deleteModalContent = ref("");

const handleDeletePlaylist = (id: string, name: string) => {
  playlistsToDelete.value = [id];
  deleteModalContent.value = `确定要删除歌单 '${name}' 吗？此操作不可恢复。`;
  showDeleteModal.value = true;
};

const handleDeletePlaylistBatch = (ids: string[], count: number) => {
  playlistsToDelete.value = ids;
  deleteModalContent.value = `确定要删除选中的 ${count} 个歌单吗？此操作不可恢复。`;
  showDeleteModal.value = true;
};

const confirmDeletePlaylist = () => {
  playlistsToDelete.value.forEach(id => deletePlaylist(id));
  selectedPlaylistIds.value.clear();
  playlistsToDelete.value = [];
  showDeleteModal.value = false;
};
// ------------------------

const handlePlaylistClick = (e: MouseEvent, id: string) => {
  e.stopPropagation();
  // 总是切换视图
  viewPlaylist(id);
  router.push('/');

  // 1. Shift 连选
  if (e.shiftKey && lastSelectedPlaylistId.value) {
    const list = playlists.value;
    const lastIndex = list.findIndex(p => p.id === lastSelectedPlaylistId.value);
    const currentIndex = list.findIndex(p => p.id === id);
    if (lastIndex !== -1 && currentIndex !== -1) {
      const start = Math.min(lastIndex, currentIndex);
      const end = Math.max(lastIndex, currentIndex);
      for (let i = start; i <= end; i++) {
        selectedPlaylistIds.value.add(list[i].id);
      }
    }
  } 
  // 2. Ctrl/Cmd 加选
  else if (e.ctrlKey || e.metaKey) {
    if (selectedPlaylistIds.value.has(id)) {
      selectedPlaylistIds.value.delete(id);
    } else {
      selectedPlaylistIds.value.add(id);
    }
    lastSelectedPlaylistId.value = id;
  } 
  // 3. 普通单选
  else {
    selectedPlaylistIds.value.clear();
    selectedPlaylistIds.value.add(id);
    lastSelectedPlaylistId.value = id;
  }
};

const handleBackgroundClick = () => {
  if (currentViewMode.value === 'playlist' && filterCondition.value) {
    selectedPlaylistIds.value.clear();
    selectedPlaylistIds.value.add(filterCondition.value);
  }
};

const handlePlaylistContextMenu = (e: MouseEvent, list: {id: string, name: string}) => {
  e.preventDefault();
  e.stopPropagation();
  targetPlaylist.value = list;

  if (!selectedPlaylistIds.value.has(list.id)) {
    selectedPlaylistIds.value.clear();
    selectedPlaylistIds.value.add(list.id);
    lastSelectedPlaylistId.value = list.id;
    viewPlaylist(list.id);
  }

  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

const handleMenuPlay = () => {
  if (targetPlaylist.value) {
    const songs = getSongsFromPlaylist(targetPlaylist.value.id);
    if (songs.length > 0) {
      clearQueue();
      viewPlaylist(targetPlaylist.value.id);
      router.push('/');
      setTimeout(() => {
         playSong(songs[0]);
      }, 50);
    }
    showContextMenu.value = false;
  }
};

const handleMenuAddToQueue = () => {
  if (selectedPlaylistIds.value.size > 1) {
    selectedPlaylistIds.value.forEach(id => {
      const songs = getSongsFromPlaylist(id);
      addSongsToQueue(songs);
    });
  } else if (targetPlaylist.value) {
    const songs = getSongsFromPlaylist(targetPlaylist.value.id);
    addSongsToQueue(songs);
  }
  showContextMenu.value = false;
};

const handleMenuDelete = () => {
  if (selectedPlaylistIds.value.size > 0) {
    const count = selectedPlaylistIds.value.size;
    
    handleDeletePlaylistBatch(Array.from(selectedPlaylistIds.value), count);
  } else if (targetPlaylist.value) {
    handleDeletePlaylist(targetPlaylist.value.id, targetPlaylist.value.name);
  }
  showContextMenu.value = false;
};
// ------------------------

// 缓存 Map
// playlistCoverCache: 存储最终用于显示的图片 URL (asset://...)
// playlistRealFirstSongMap: 存储每个歌单目前计算出的“第一首歌”的路径，用于比对变化
const playlistCoverCache = ref<Map<string, string>>(new Map());
const playlistRealFirstSongMap = new Map<string, string>();

// 样式定义
const baseNavClasses = "px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all duration-200 text-sm font-medium";
const activeNavClasses = "bg-black/10 dark:bg-white/10 text-black dark:text-white font-semibold shadow-sm"; 
const inactiveNavClasses = "text-gray-600 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white";

/**
 * 🟢 核心算法：计算所有歌单的封面
 * 逻辑：直接使用歌单 internal order 的第一首歌作为封面。
 * 这保证了歌单封面只受歌单自身排序影响，不受全局 songList 排序影响。
 */
const calculatePlaylistCovers = async () => {
  // 遍历所有歌单
  for (const pl of playlists.value) {
    if (pl.songPaths.length > 0) {
      // 直接取歌单的第一首歌
      const firstSongPath = pl.songPaths[0];
      await updateCoverIfChanged(pl.id, firstSongPath);
    } else {
      // 歌单为空，清除封面
      if (playlistCoverCache.value.has(pl.id)) {
        playlistCoverCache.value.delete(pl.id);
        playlistRealFirstSongMap.delete(pl.id);
      }
    }
  }
};

// 🟢 加载封面图片 (仅当路径变化时触发)
const updateCoverIfChanged = async (playlistId: string, firstSongPath: string) => {
  // 如果这首歌已经是当前记录的封面歌曲，直接跳过 (防抖/省资源)
  if (playlistRealFirstSongMap.get(playlistId) === firstSongPath && playlistCoverCache.value.has(playlistId)) {
    return;
  }

  // 更新记录
  playlistRealFirstSongMap.set(playlistId, firstSongPath);

  try {
    // 调用后端生成/获取缩略图
    const filePath = await invoke<string>('get_song_cover_thumbnail', { path: firstSongPath });
    
    if (filePath && filePath.length > 0) { 
      const assetUrl = convertFileSrc(filePath);
      playlistCoverCache.value.set(playlistId, assetUrl); 
    } else {
      // 没封面
      playlistCoverCache.value.delete(playlistId);
    }
  } catch (e) {
    playlistCoverCache.value.delete(playlistId);
  }
};

// 🟢 深度监听：无论是全局列表重排，还是歌单增删改，都重新计算
watch([songList, playlists], () => {
  calculatePlaylistCovers();
}, { deep: true, immediate: true });
</script>

<template>
  <aside class="w-48 bg-transparent flex flex-col border-r border-transparent h-full select-none overflow-hidden relative transition-colors duration-600">
    <div class="h-16 flex items-center px-6 shrink-0 mb-2 cursor-default relative" data-tauri-drag-region>
      <div class="flex items-center gap-2 pointer-events-none">
        <h1 class="text-2xl font-bold bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent tracking-tight italic">
          LyciaMusic
        </h1>
      </div>
    </div>

    <nav class="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4" @click="handleBackgroundClick">
      
      <ul class="space-y-1 transition-all duration-200" :class="{'opacity-30 grayscale pointer-events-none': dragSession.active}">
        <router-link to="/" custom v-slot="{ navigate }" v-if="settings.sidebar.showLocalMusic">
          <li @click="() => { navigate(); switchViewToAll(); }" :class="[baseNavClasses, (currentViewMode === 'all' && $route.path === '/') ? activeNavClasses : inactiveNavClasses]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            <span>本地音乐</span>
          </li>
        </router-link>
        
        <router-link to="/favorites" custom v-slot="{ navigate, isActive }" v-if="settings.sidebar.showFavorites">
          <li @click="navigate" :class="[baseNavClasses, isActive ? activeNavClasses : inactiveNavClasses]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            <span>我的收藏</span>
          </li>
        </router-link>

        <router-link to="/recent" custom v-slot="{ navigate }" v-if="settings.sidebar.showRecent">
          <li @click="() => { navigate(); switchToRecent(); }" :class="[baseNavClasses, (currentViewMode === 'recent' && $route.path === '/recent') ? activeNavClasses : inactiveNavClasses]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>最近播放</span>
          </li>
        </router-link>

        <router-link to="/" custom v-slot="{ navigate }" v-if="settings.sidebar.showFolders">
          <li @click="() => { navigate(); switchToFolderView(); }" :class="[baseNavClasses, (currentViewMode === 'folder') ? activeNavClasses : inactiveNavClasses]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
            <span>文件夹</span>
          </li>
        </router-link>
      </ul>

      <div class="mt-6">
          <div class="px-4 pr-3 py-2 flex items-center justify-between group">
            <div class="flex items-center gap-1 cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors" @click.stop="isPlaylistOpen = !isPlaylistOpen">
              <svg xmlns="http://www.w3.org/2000/svg" :class="['h-3 w-3 transition-transform duration-200', isPlaylistOpen ? 'rotate-90' : '']" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
              <span class="text-xs font-bold tracking-wide">我的歌单</span>
              <span class="text-xs text-gray-400 dark:text-gray-500 font-normal ml-0.5">{{ playlists.length }}</span>
            </div>
            <button @click.stop="handleCreatePlaylist" class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded p-0.5 transition-colors" title="新建歌单"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg></button>
          </div>
          
          <ul v-show="isPlaylistOpen" class="space-y-0.5 mt-1">
            <li 
              v-for="list in playlists" 
              :key="list.id"
              @click.stop="handlePlaylistClick($event, list.id)" 
              @contextmenu="handlePlaylistContextMenu($event, list)"
              :data-playlist-id="list.id"
              :data-playlist-name="list.name"
              class="playlist-drop-target px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all group relative"
              :class="[
                selectedPlaylistIds.has(list.id) ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white font-medium shadow-sm' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-600 dark:text-gray-300',
                (dragSession.active && dragSession.targetPlaylist?.id === list.id) ? '!bg-red-500/10 !ring-2 !ring-[#EC4141] ring-inset' : ''
              ]"
            >
              <div class="w-9 h-9 rounded bg-gray-200/50 border border-gray-100/50 shrink-0 overflow-hidden mr-3 flex items-center justify-center">
                <img v-if="playlistCoverCache.get(list.id)" :src="playlistCoverCache.get(list.id)" class="w-full h-full object-cover" alt="Cover" />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
              </div>
              <div class="flex-1 min-w-0 flex flex-col justify-center"><span class="text-sm truncate leading-tight mb-0.5">{{ list.name }}</span><span class="text-[10px] text-gray-400 dark:text-white/40 leading-tight">{{ list.songPaths.length }} 首</span></div>
              <button @click.stop="handleDeletePlaylist(list.id, list.name)" class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-gray-400 dark:text-white/60 hover:text-red-500 transition-all p-1" title="删除歌单"><svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
            </li>
          </ul>
      </div>
    </nav>

    <PlaylistContextMenu
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :playlist-name="targetPlaylist?.name || ''"
      :selected-count="selectedPlaylistIds.size"
      @close="showContextMenu = false"
      @cancel="showContextMenu = false"
      @play="handleMenuPlay"
      @add-to-queue="handleMenuAddToQueue"
      @delete="handleMenuDelete"
    />

    <ModernModal
      v-model:visible="showDeleteModal"
      title="删除歌单"
      :content="deleteModalContent"
      type="danger"
      confirm-text="删除"
      @confirm="confirmDeletePlaylist"
    />
    
    <ModernInputModal
      v-model:visible="showCreateModal"
      title="新建歌单"
      placeholder="请输入歌单名称"
      confirm-text="创建"
      @confirm="confirmCreatePlaylist"
    />
  </aside>
</template>

<style scoped>
</style>