<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'; // 🟢 引入 watch
import { useRoute } from 'vue-router';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core'; // 🟢 1. 引入资源转换工具
import ConfirmModal from '../overlays/ConfirmModal.vue';

defineProps<{
  isBatchMode: boolean
}>();

const emit = defineEmits(['update:isBatchMode', 'batchPlay', 'openAddToPlaylist', 'batchDelete', 'batchMove']);

const route = useRoute();

const { 
  currentViewMode, localMusicTab, favTab, favDetailFilter, recentTab, 
  currentFolderFilter, 
  switchLocalTab, switchFavTab,
  handleScan, clearLocalMusic, clearFavorites, removeFolder, clearHistory,
  playSong, displaySongList,
  playlists, filterCondition, playlistCover,
  addFoldersFromStructure,
  refreshFolder
} = usePlayer();

const isLocalMusic = computed(() => currentViewMode.value === 'all' && route.path === '/');
const isFavorites = computed(() => route.path === '/favorites');
const isFolderMode = computed(() => currentViewMode.value === 'folder' && route.path === '/');
const isRecentPlayed = computed(() => route.path === '/recent');

const detailInfo = computed(() => {
  if (currentViewMode.value === 'playlist') {
    const pl = playlists.value.find(p => p.id === filterCondition.value);
    if (pl) return { type: '歌单', name: pl.name, count: pl.songPaths.length, creator: '我的音乐', date: '2025-01-01' };
  }
  if (isFavorites.value && favDetailFilter.value?.type === 'artist') {
    return { type: '歌手', name: favDetailFilter.value.name, count: displaySongList.value.length, creator: '收藏的歌手', date: '' };
  }
  if (isFavorites.value && favDetailFilter.value?.type === 'album') {
    return { type: '专辑', name: favDetailFilter.value.name, count: displaySongList.value.length, creator: '收藏的专辑', date: '' };
  }
  return null;
});

// 🟢 2. 高清封面加载逻辑
const headerCover = ref('');

const updateHeaderCover = async () => {
  // 只有在详情页模式且列表不为空时才尝试加载
  if (detailInfo.value && displaySongList.value.length > 0) {
    const firstSongPath = displaySongList.value[0].path;
    try {
      // 🔥 请求高清封面 (get_song_cover) 而不是缩略图
      const filePath = await invoke<string>('get_song_cover', { path: firstSongPath });
      if (filePath && filePath.length > 0) {
        headerCover.value = convertFileSrc(filePath);
      } else {
        headerCover.value = '';
      }
    } catch (e) {
      headerCover.value = '';
    }
  } else {
    // 如果没有歌，或者不是详情页，重置封面
    headerCover.value = '';
  }
};

// 监听列表变化，实时更新封面（比如切歌单、切文件夹时）
watch(() => displaySongList.value, updateHeaderCover, { immediate: true });
// 监听详情信息变化
watch(() => detailInfo.value, updateHeaderCover);


const showHeaderMenu = ref(false);
const handleHeaderMenuClick = () => showHeaderMenu.value = !showHeaderMenu.value;

const showConfirm = ref(false);
const confirmMessage = ref('');
const confirmAction = ref<() => void>(() => {});

const requestClearList = () => {
  if (isLocalMusic.value) {
    confirmMessage.value = "确定要清空本地音乐列表吗？这不会删除本地文件。";
    confirmAction.value = clearLocalMusic;
  } else if (isFolderMode.value && currentFolderFilter.value) {
    confirmMessage.value = `确定要移除文件夹 "${currentFolderFilter.value}" 吗？这不会删除本地文件。`;
    confirmAction.value = () => removeFolder(currentFolderFilter.value);
  } else if (isFavorites.value) {
    confirmMessage.value = "确定要清空收藏列表吗？";
    confirmAction.value = clearFavorites;
  } else if (isRecentPlayed.value) {
    confirmMessage.value = "确定要清空最近播放记录吗？";
    confirmAction.value = clearHistory;
  }
  showConfirm.value = true;
  showHeaderMenu.value = false; 
};

const handleRefreshClick = async () => {
  if (isFolderMode.value && currentFolderFilter.value) {
    try {
      await refreshFolder(currentFolderFilter.value);
      showHeaderMenu.value = false;
    } catch (e) {
      alert("刷新失败: " + e);
    }
  }
};

const handleConfirm = () => {
  confirmAction.value();
  showConfirm.value = false;
};

const handleGlobalClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('#header-action-menu') && !target.closest('.header-menu-trigger')) {
    showHeaderMenu.value = false;
  }
};

onMounted(() => window.addEventListener('click', handleGlobalClick));
onUnmounted(() => window.removeEventListener('click', handleGlobalClick));

const handlePlayAll = () => { if (displaySongList.value.length > 0) playSong(displaySongList.value[0]); };
const handleShufflePlay = () => { 
  const list = displaySongList.value; 
  if (list.length > 0) playSong(list[Math.floor(Math.random() * list.length)]); 
};
</script>

<template>
  <div :class="['px-6 shrink-0 select-none flex flex-col', detailInfo ? 'pt-3 pb-4 h-48 justify-between' : 'pt-1 pb-3 h-14 justify-center']">
    
    <div v-if="isBatchMode" class="flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-200">
      <div class="flex items-center gap-3">
        <button @click="emit('batchPlay')" class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 py-1.5 rounded-full text-sm transition flex items-center gap-1 active:scale-95 shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg></button>
        <button class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg> 添加到播放列表</button>
        <button @click="emit('openAddToPlaylist')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg> 收藏到歌单</button>
        
        <button v-if="isFolderMode" @click="emit('batchMove')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg> 移动到文件夹</button>
        
        <button @click="emit('batchDelete')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> 删除</button>
      </div>
      <div class="flex items-center gap-4">
        <button @click="emit('update:isBatchMode', false)" class="text-[#EC4141] hover:bg-red-50 px-3 py-1 rounded transition">完成</button>
      </div>
    </div>

    <div v-else-if="detailInfo" class="flex gap-8 h-full">
        <div class="w-48 h-48 bg-gray-50 rounded-xl border border-gray-100 shadow-sm flex items-center justify-center shrink-0 overflow-hidden group relative select-none">
          <img v-if="headerCover || playlistCover" :src="headerCover || playlistCover" class="w-full h-full object-cover animate-in fade-in duration-300" alt="Cover" />
          <div v-else class="flex flex-col items-center justify-center h-full w-full">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-24 h-24 text-indigo-500 mb-2 drop-shadow-md"><path fill-rule="evenodd" d="M19.952 1.651a.75.75 0 01.298.599V16.303a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V6.994l-9 2.572v9.737a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V9.017c0-.528.246-1.032.67-1.371l10.038-5.996z" clip-rule="evenodd" /></svg>
             <span class="text-xs text-gray-400 font-medium">封面图</span>
          </div>
        </div>
        
        <div class="flex flex-col justify-between flex-1 py-2">
          <div>
            <div class="flex items-center gap-3 mb-2">
               <span class="border border-[#EC4141] text-[#EC4141] text-xs px-1 rounded">{{ detailInfo.type }}</span>
               <h1 class="text-2xl font-bold text-gray-800 truncate">{{ detailInfo.name }}</h1>
            </div>
            <div class="flex items-center gap-2 mb-4">
               <div class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] text-gray-500">{{ detailInfo.creator.charAt(0) }}</div>
               <span class="text-xs text-blue-500 hover:underline cursor-pointer">{{ detailInfo.creator }}</span>
               <span v-if="detailInfo.date" class="text-xs text-gray-400">{{ detailInfo.date }} 创建</span>
            </div>
          </div>
          <div class="flex items-center gap-3">
             <button @click="handlePlayAll" class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-6 py-2 rounded-full text-sm font-medium transition shadow-sm hover:shadow-md flex items-center gap-2 active:scale-95"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>播放全部</button>
             <button @click="handleShufflePlay" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 active:scale-95 border border-gray-200"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>随机播放</button>
             <button @click="emit('update:isBatchMode', true)" title="批量操作" class="bg-gray-100 hover:bg-gray-200 text-gray-600 w-10 h-10 flex items-center justify-center rounded-full transition border border-gray-200 active:scale-95"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg></button>
          </div>
        </div>
    </div>

    <div v-else class="flex items-center justify-between">
        
        <div class="flex items-center gap-6 text-base font-medium pb-1">
           <template v-if="isLocalMusic">
             <button @click="switchLocalTab('default')" :class="localMusicTab === 'default' ? 'text-gray-900 font-bold text-xl relative after:content-[\'\'] after:absolute after:-bottom-2 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-1 after:bg-[#EC4141] after:rounded-full' : 'text-gray-400 hover:text-gray-600'">歌曲</button>
             <button @click="switchLocalTab('artist')" :class="localMusicTab === 'artist' ? 'text-gray-900 font-bold text-xl relative after:content-[\'\'] after:absolute after:-bottom-2 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-1 after:bg-[#EC4141] after:rounded-full' : 'text-gray-400 hover:text-gray-600'">歌手</button>
             <button @click="switchLocalTab('album')" :class="localMusicTab === 'album' ? 'text-gray-900 font-bold text-xl relative after:content-[\'\'] after:absolute after:-bottom-2 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-1 after:bg-[#EC4141] after:rounded-full' : 'text-gray-400 hover:text-gray-600'">专辑</button>
           </template>
           <template v-else-if="isFavorites && !favDetailFilter">
             <button @click="switchFavTab('songs')" :class="favTab === 'songs' ? 'text-gray-900 font-bold text-xl relative after:content-[\'\'] after:absolute after:-bottom-2 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-1 after:bg-[#EC4141] after:rounded-full' : 'text-gray-400 hover:text-gray-600'">歌曲</button>
             <button @click="switchFavTab('artists')" :class="favTab === 'artists' ? 'text-gray-900 font-bold text-xl relative after:content-[\'\'] after:absolute after:-bottom-2 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-1 after:bg-[#EC4141] after:rounded-full' : 'text-gray-400 hover:text-gray-600'">歌手</button>
             <button @click="switchFavTab('albums')" :class="favTab === 'albums' ? 'text-gray-900 font-bold text-xl relative after:content-[\'\'] after:absolute after:-bottom-2 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-1 after:bg-[#EC4141] after:rounded-full' : 'text-gray-400 hover:text-gray-600'">专辑</button>
           </template>
           <template v-else-if="isFolderMode">
             <span class="text-gray-900 font-bold text-xl">文件夹</span>
           </template>
           <template v-else-if="isRecentPlayed">
             <button @click="recentTab='songs'" :class="recentTab === 'songs' ? 'text-gray-900 font-bold text-xl relative after:content-[\'\'] after:absolute after:-bottom-2 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-1 after:bg-[#EC4141] after:rounded-full' : 'text-gray-400 hover:text-gray-600'">单曲</button>
             <button @click="recentTab='playlists'" :class="recentTab === 'playlists' ? 'text-gray-900 font-bold text-xl relative after:content-[\'\'] after:absolute after:-bottom-2 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-1 after:bg-[#EC4141] after:rounded-full' : 'text-gray-400 hover:text-gray-600'">歌单</button>
             <button @click="recentTab='albums'" :class="recentTab === 'albums' ? 'text-gray-900 font-bold text-xl relative after:content-[\'\'] after:absolute after:-bottom-2 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-1 after:bg-[#EC4141] after:rounded-full' : 'text-gray-400 hover:text-gray-600'">专辑</button>
           </template>
        </div>

        <div class="flex items-center gap-3" v-if="!favDetailFilter || (favDetailFilter && (favTab==='artists'||favTab==='albums'))">
          <button @click="handlePlayAll" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-1.5 rounded-full text-sm transition flex items-center gap-1 active:scale-95 border border-gray-200">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg> 播放全部
          </button>
          
          <div class="relative">
             <button @click.stop="handleHeaderMenuClick" class="header-menu-trigger bg-gray-100 hover:bg-gray-200 text-gray-600 w-9 h-9 flex items-center justify-center rounded-full transition border border-gray-200 active:scale-95">
               <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" /></svg>
             </button>
             
             <div v-if="showHeaderMenu" id="header-action-menu" class="absolute right-0 top-full mt-2 w-52 bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-20 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
               
               <div v-if="isFolderMode" @click="addFoldersFromStructure" class="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm text-gray-700 flex items-center">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                 自动添加
               </div>
               
               <div v-if="isFolderMode" @click="handleScan" class="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm text-gray-700 flex items-center">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                 手动添加
               </div>

               <div v-if="isFolderMode && currentFolderFilter" @click="handleRefreshClick" class="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm text-gray-700 flex items-center">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                 刷新文件夹
               </div>

               <div @click="emit('update:isBatchMode', true)" class="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm text-gray-700 flex items-center">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                 批量操作
               </div>
               
               <div class="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm text-gray-700 flex items-center">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
                 全部添加至播放列表
               </div>
               
               <div class="border-t border-gray-100 my-1"></div>
               
               <div @click="requestClearList" class="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm text-[#EC4141] flex items-center">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                 清空当前列表
               </div>
             </div>
          </div>
        </div>
    </div>

    <ConfirmModal 
      :visible="showConfirm" 
      title="my-cloud-music" 
      :content="confirmMessage" 
      @confirm="handleConfirm" 
      @cancel="showConfirm = false" 
    />

  </div>
</template>