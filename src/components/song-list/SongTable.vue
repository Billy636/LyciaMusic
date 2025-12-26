<script setup lang="ts">
import { usePlayer, Song } from '../../composables/player';
import { reactive, ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';

// 接收父组件传来的歌曲列表
const props = defineProps({
  songs: {
    type: Array as () => Song[],
    required: true
  }
});

const { 
  currentSong, playSong, formatDuration, isFavorite, toggleFavorite,
  playlists, addToPlaylist, removeFromPlaylist, createPlaylist,
  moveFile, settings, generateOrganizedPath, currentViewMode, filterCondition
} = usePlayer();

// --- 虚拟滚动逻辑 (Virtual Scrolling) ---
const itemHeight = 60; // 固定行高 60px
const containerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const containerHeight = ref(800); // 默认高度，mounted后更新

const updateContainerHeight = () => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight;
  }
};

const virtualList = computed(() => {
  const total = props.songs.length;
  const start = Math.floor(scrollTop.value / itemHeight);
  // 多渲染几个作为缓冲 (buffer)
  const visibleCount = Math.ceil(containerHeight.value / itemHeight);
  const end = Math.min(total, start + visibleCount + 5);
  
  const bufferStart = Math.max(0, start - 5);
  
  return {
    items: props.songs.slice(bufferStart, end).map((song, index) => ({
      ...song,
      virtualIndex: bufferStart + index, // 真实的索引
      top: (bufferStart + index) * itemHeight
    })),
    totalHeight: total * itemHeight
  };
});

const onScroll = (e: Event) => {
  scrollTop.value = (e.target as HTMLElement).scrollTop;
  closeContextMenu(); // 滚动时关闭菜单
};

// 监听窗口大小变化
onMounted(() => {
  window.addEventListener('resize', updateContainerHeight);
  if (containerRef.value) updateContainerHeight();
});
onUnmounted(() => {
  window.removeEventListener('resize', updateContainerHeight);
});

// --- 右键菜单逻辑 ---
const contextMenu = reactive({ visible: false, x: 0, y: 0, song: null as Song | null });
const showContextMenu = (e: MouseEvent, song: Song) => {
  e.preventDefault(); e.stopPropagation(); contextMenu.song = song;
  const menuWidth = 200; const menuHeight = 300; let x = e.clientX; let y = e.clientY;
  if (x + menuWidth > window.innerWidth) x -= menuWidth; if (y + menuHeight > window.innerHeight) y -= menuHeight;
  contextMenu.x = x; contextMenu.y = y; contextMenu.visible = false;
  nextTick(() => { contextMenu.visible = true; });
};
const closeContextMenu = () => { contextMenu.visible = false; };
const handleAddToPlaylist = (playlistId: string) => { if (contextMenu.song) { addToPlaylist(playlistId, contextMenu.song.path); closeContextMenu(); } };
const handleRemoveFromPlaylist = () => { if (contextMenu.song && currentViewMode.value === 'playlist') { removeFromPlaylist(filterCondition.value, contextMenu.song.path); closeContextMenu(); } };
const handleCreateAndAdd = () => { const name = window.prompt("请输入新歌单名称："); if (name && name.trim() && contextMenu.song) { createPlaylist(name); setTimeout(() => { const newPl = playlists.value[playlists.value.length - 1]; if (newPl) addToPlaylist(newPl.id, contextMenu.song!.path); }, 100); closeContextMenu(); } };
const handleGlobalMouseDown = (e: MouseEvent) => { const menuEl = document.getElementById('music-context-menu'); if (menuEl && !menuEl.contains(e.target as Node)) { closeContextMenu(); } };

// --- 整理逻辑 ---
const showOrganizerModal = ref(false); const organizerTarget = ref<Song | null>(null); const targetPath = ref(""); 
const openOrganizer = async () => { if (!contextMenu.song) return; organizerTarget.value = contextMenu.song; closeContextMenu(); if (settings.value.enableAutoOrganize) { targetPath.value = generateOrganizedPath(contextMenu.song); showOrganizerModal.value = true; } else { await selectAndMoveDirectly(); } };
const selectAndMoveDirectly = async () => { try { const selected = await open({ directory: true, multiple: false, title: "选择移动到的文件夹" }); if (selected && typeof selected === 'string' && organizerTarget.value) { const sep = selected.includes('/') ? '/' : '\\'; const filename = organizerTarget.value.name; const finalPath = `${selected}${sep}${filename}`; await moveFile(organizerTarget.value, finalPath); } } catch (err) { console.error(err); } };
const confirmAutoMove = async () => { if (!organizerTarget.value || !targetPath.value) return; const success = await moveFile(organizerTarget.value, targetPath.value); if (success) { showOrganizerModal.value = false; } };

onMounted(() => { window.addEventListener('mousedown', handleGlobalMouseDown); });
onUnmounted(() => { window.removeEventListener('mousedown', handleGlobalMouseDown); });
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-white">
    <div class="flex items-center text-xs text-gray-400 border-b border-gray-100 bg-white z-10 select-none pr-2">
      <div class="py-3 w-12 text-center shrink-0">#</div>
      <div class="py-3 w-[40%] pl-2">音乐标题</div>
      <div class="py-3 w-[20%]">歌手</div>
      <div class="py-3 w-[25%]">专辑</div>
      <div class="py-3 flex-1 text-right pr-4">时长</div>
    </div>

    <div 
      ref="containerRef" 
      class="flex-1 overflow-y-auto overflow-x-hidden relative"
      @scroll="onScroll"
    >
      <div :style="{ height: virtualList.totalHeight + 'px' }" class="w-full relative">
        <div v-if="songs.length === 0" class="absolute inset-0 flex flex-col items-center justify-center opacity-60">
           <span class="text-4xl mb-4">🎵</span>
           <p class="text-lg text-gray-600">列表为空</p>
        </div>

        <div 
          v-for="song in virtualList.items" 
          :key="song.path"
          class="absolute w-full flex items-center group cursor-pointer transition-colors hover:bg-gray-50 border-b border-gray-50 box-border"
          :class="currentSong?.path === song.path ? 'bg-gray-100' : 'bg-white'"
          :style="{ 
            height: itemHeight + 'px', 
            top: song.top + 'px',
            transform: 'translateZ(0)'
          }"
          @dblclick="playSong(song)"
          @contextmenu="showContextMenu($event, song)"
        >
           <div class="w-12 flex items-center justify-center shrink-0 h-full">
              <span class="text-xs font-mono text-gray-300 group-hover:hidden" :class="{'!hidden': currentSong?.path === song.path}">
                {{ song.virtualIndex + 1 < 10 ? '0' + (song.virtualIndex + 1) : song.virtualIndex + 1 }}
              </span>
              <span v-if="currentSong?.path === song.path" class="text-[#EC4141]">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 animate-pulse" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
              </span>
              <span v-else class="hidden group-hover:block text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
              </span>
           </div>

           <div class="w-[40%] flex items-center pr-4 overflow-hidden pl-2">
              <div class="w-9 h-9 rounded bg-gray-200/50 flex items-center justify-center mr-3 shrink-0 overflow-hidden text-gray-400 relative border border-black/5">
                <img 
                  v-if="song.cover"
                  :src="convertFileSrc(song.cover)" 
                  loading="lazy"
                  class="w-full h-full object-cover transition-opacity duration-300"
                  alt="Cover"
                />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-40 absolute inset-0 m-auto -z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>

              <div class="min-w-0 flex-1 flex flex-col justify-center">
                <div class="flex items-center truncate">
                   <span class="no-select truncate text-sm" :class="currentSong?.path === song.path ? 'text-[#EC4141] font-medium' : 'text-gray-900'">
                     {{ song.name.replace(/\.[^/.]+$/, "") }}
                   </span>
                   <span v-if="song.year" class="ml-2 text-[10px] border border-gray-200 text-gray-400 px-1 rounded no-select shrink-0">{{ song.year.substring(0,4) }}</span>
                </div>
              </div>
           </div>

           <div class="w-[20%] truncate text-gray-600 text-sm no-select pr-4">{{ song.artist }}</div>

           <div class="w-[25%] truncate text-gray-400 text-xs italic no-select pr-4">{{ song.album }}</div>

           <div class="flex-1 text-right font-mono text-xs text-gray-400 no-select pr-4 flex items-center justify-end">
              <button @click.stop="toggleFavorite(song)" class="opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 mr-3" :class="{'!opacity-100': isFavorite(song)}">
                <svg v-if="isFavorite(song)" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-[#EC4141]" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" /></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-300 hover:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
              </button>
              <span class="w-10">{{ formatDuration(song.duration) }}</span>
           </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="contextMenu.visible" id="music-context-menu" class="fixed z-[9999] bg-white border border-gray-200 shadow-xl rounded-lg py-1 w-52 text-sm text-gray-700 select-none overflow-hidden" :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }" @contextmenu.prevent @mousedown.stop>
        <div class="px-3 py-2 border-b border-gray-100 bg-gray-50 flex flex-col"><span class="text-xs text-gray-400 block">操作对象</span><span class="font-medium truncate block text-gray-800">{{ contextMenu.song?.name }}</span></div>
        <div class="px-3 py-2 hover:bg-gray-100 cursor-pointer flex items-center" @click="contextMenu.song && playSong(contextMenu.song); closeContextMenu()"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>立即播放</div>
        <div class="border-t border-gray-100 mt-1 pt-1">
          <div class="px-3 py-1 text-xs text-gray-400 font-bold">添加到歌单</div>
          <div class="max-h-40 overflow-y-auto custom-scrollbar"><div v-for="pl in playlists" :key="pl.id" @click="handleAddToPlaylist(pl.id)" class="px-3 py-2 hover:bg-gray-100 cursor-pointer flex items-center truncate"><span class="mr-3 text-gray-400">#</span> {{ pl.name }}</div></div>
          <div @click="handleCreateAndAdd" class="px-3 py-2 hover:bg-gray-100 cursor-pointer text-[#EC4141] flex items-center border-t border-gray-50"><span class="mr-3">+</span> 新建歌单...</div>
        </div>
        <div class="border-t border-gray-100 mt-1 pt-1"><div @click="openOrganizer" class="px-3 py-2 hover:bg-gray-100 cursor-pointer text-gray-600 flex items-center"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>整理文件...</div></div>
        <div v-if="currentViewMode === 'playlist'" class="border-t border-gray-100 mt-1 pt-1"><div @click="handleRemoveFromPlaylist" class="px-3 py-2 hover:bg-red-50 cursor-pointer text-red-500 flex items-center"><span class="mr-3">×</span> 从歌单中移除</div></div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showOrganizerModal" class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div class="bg-white rounded-xl shadow-2xl w-[550px] overflow-hidden animate-in fade-in zoom-in duration-200">
          <div class="bg-gray-50 px-6 py-4 border-b border-gray-100 flex justify-between items-center"><h3 class="font-bold text-gray-800">📂 自动归档确认</h3><button @click="showOrganizerModal = false" class="text-gray-400 hover:text-gray-600">×</button></div>
          <div class="p-6 space-y-5">
            <div class="bg-blue-50 border border-blue-100 p-3 rounded-lg text-sm text-blue-700 flex justify-between items-center"><div>正在整理：<span class="font-bold">{{ organizerTarget?.name }}</span></div><div class="text-xs bg-blue-100 px-2 py-1 rounded text-blue-800">自动模式</div></div>
            <div><label class="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">自动生成的路径</label><div class="bg-gray-800 text-green-400 font-mono text-xs p-3 rounded-lg break-all shadow-inner">{{ targetPath }}</div><div class="text-right mt-1"><router-link to="/settings" class="text-xs text-[#EC4141] hover:underline">修改整理规则</router-link></div></div>
          </div>
          <div class="px-6 py-4 bg-gray-50 flex justify-end space-x-3 border-t border-gray-100"><button @click="showOrganizerModal = false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded transition">取消</button><button @click="confirmAutoMove" class="px-5 py-2 text-sm bg-[#EC4141] hover:bg-[#d13b3b] text-white rounded shadow transition flex items-center"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>确认移动</button></div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.no-select { user-select: none; }
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 6px;
}
::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.2);
}
</style>