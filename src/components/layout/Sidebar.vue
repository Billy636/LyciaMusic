<script setup lang="ts">
import { ref, watch } from 'vue';
import { usePlayer, dragSession } from '../../composables/player';
import { useRouter } from 'vue-router';
import { invoke } from '@tauri-apps/api/core';

const { 
  playlists, 
  switchViewToAll, 
  switchToFolderView, 
  switchToRecent, 
  createPlaylist, 
  deletePlaylist, 
  viewPlaylist,   
  currentViewMode, 
  filterCondition 
} = usePlayer();

const router = useRouter();

const isPlaylistOpen = ref(true);
const playlistCoverCache = ref<Map<string, string>>(new Map());

// 🟢 样式调整：hover 改为半透明白/黑，适应磨砂背景
const baseNavClasses = "px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all duration-200 text-sm font-medium";
const activeNavClasses = "bg-black/10 text-black font-semibold shadow-sm"; // 选中态加深一点
const inactiveNavClasses = "text-gray-600 hover:bg-black/5 hover:text-gray-900";

const loadPlaylistCover = async (playlistId: string, firstSongPath: string) => {
  if (!firstSongPath || playlistCoverCache.value.has(playlistId)) return;
  try {
    const dataUrl = await invoke<string>('get_song_cover_thumbnail', { path: firstSongPath });
    if (dataUrl) { playlistCoverCache.value.set(playlistId, dataUrl); }
  } catch (e) {}
};

watch(playlists, (newPlaylists) => {
  newPlaylists.forEach(pl => { if (pl.songPaths.length > 0) { loadPlaylistCover(pl.id, pl.songPaths[0]); } });
}, { immediate: true, deep: true });

const handleCreatePlaylist = () => { const name = window.prompt("请输入新歌单的名称："); if (name) createPlaylist(name); };
const handleDeletePlaylist = (id: string, name: string) => { if (confirm(`确定要删除歌单 "${name}" 吗？此操作不可恢复。`)) deletePlaylist(id); };
const handlePlaylistClick = (id: string) => { viewPlaylist(id); router.push('/'); };
</script>

<template>
  <aside class="w-48 bg-white/40 backdrop-blur-xl flex flex-col border-r border-transparent h-full select-none overflow-hidden relative transition-colors duration-600">
    <!-- Top Drag Region -->
    <div class="h-16 flex items-center px-6 shrink-0 mb-2 cursor-default relative" data-tauri-drag-region>
      <div class="text-xl font-bold text-[#EC4141] italic tracking-tight flex items-center gap-2 pointer-events-none">
        <span class="text-2xl drop-shadow-sm">🤪</span> 
        <span class="drop-shadow-sm">FkMus</span>
      </div>
    </div>

    <nav class="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4">
      
      <ul class="space-y-1 transition-all duration-200" :class="{'opacity-30 grayscale pointer-events-none': dragSession.active}">
        <router-link to="/" custom v-slot="{ navigate }">
          <li @click="() => { navigate(); switchViewToAll(); }" :class="[baseNavClasses, (currentViewMode === 'all' && $route.path === '/') ? activeNavClasses : inactiveNavClasses]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            <span>本地音乐</span>
          </li>
        </router-link>
        
        <router-link to="/favorites" custom v-slot="{ navigate, isActive }">
          <li @click="navigate" :class="[baseNavClasses, isActive ? activeNavClasses : inactiveNavClasses]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            <span>我的收藏</span>
          </li>
        </router-link>

        <router-link to="/recent" custom v-slot="{ navigate }">
          <li @click="() => { navigate(); switchToRecent(); }" :class="[baseNavClasses, (currentViewMode === 'recent' && $route.path === '/recent') ? activeNavClasses : inactiveNavClasses]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>最近播放</span>
          </li>
        </router-link>

        <router-link to="/" custom v-slot="{ navigate }">
          <li @click="() => { navigate(); switchToFolderView(); }" :class="[baseNavClasses, (currentViewMode === 'folder') ? activeNavClasses : inactiveNavClasses]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
            <span>文件夹</span>
          </li>
        </router-link>
      </ul>

      <div class="mt-6">
          <div class="px-4 pr-3 py-2 flex items-center justify-between group">
            <div class="flex items-center gap-1 cursor-pointer text-gray-500 hover:text-gray-700 transition-colors" @click="isPlaylistOpen = !isPlaylistOpen">
              <svg xmlns="http://www.w3.org/2000/svg" :class="['h-3 w-3 transition-transform duration-200', isPlaylistOpen ? 'rotate-90' : '']" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
              <span class="text-xs font-bold tracking-wide">我的歌单</span>
              <span class="text-xs text-gray-400 font-normal ml-0.5">{{ playlists.length }}</span>
            </div>
            <button @click="handleCreatePlaylist" class="text-gray-400 hover:text-gray-600 hover:bg-black/5 rounded p-0.5 transition-colors" title="新建歌单"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg></button>
          </div>
          
          <ul v-show="isPlaylistOpen" class="space-y-0.5 mt-1">
            <router-link to="/" custom v-for="list in playlists" :key="list.id" v-slot="{ navigate }">
              <li 
                @click="() => { navigate(); handlePlaylistClick(list.id); }" 
                :data-playlist-id="list.id"
                :data-playlist-name="list.name"
                class="playlist-drop-target px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all group relative"
                :class="[
                  (currentViewMode === 'playlist' && filterCondition === list.id) ? 'bg-black/10 text-black font-medium' : 'hover:bg-black/5 text-gray-600',
                  (dragSession.active && dragSession.targetPlaylist?.id === list.id) ? '!bg-red-500/10 !ring-2 !ring-[#EC4141] ring-inset' : ''
                ]"
              >
                <div class="w-9 h-9 rounded bg-gray-200/50 border border-gray-100/50 shrink-0 overflow-hidden mr-3 flex items-center justify-center">
                  <img v-if="playlistCoverCache.get(list.id)" :src="playlistCoverCache.get(list.id)" class="w-full h-full object-cover" alt="Cover" />
                  <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                </div>
                <div class="flex-1 min-w-0 flex flex-col justify-center"><span class="text-sm truncate leading-tight mb-0.5">{{ list.name }}</span><span class="text-[10px] text-gray-400 leading-tight">{{ list.songPaths.length }} 首</span></div>
                <button @click.stop="handleDeletePlaylist(list.id, list.name)" class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all p-1" title="删除歌单"><svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
              </li>
            </router-link>
          </ul>
      </div>
    </nav>
  </aside>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(229, 231, 235, 0.5); border-radius: 20px; }
.custom-scrollbar:hover::-webkit-scrollbar-thumb { background-color: rgba(209, 213, 219, 0.8); }
</style>