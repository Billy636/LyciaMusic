<script setup lang="ts">
import { usePlayer, dragSession } from '../../composables/player';
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core'; // 🟢 1. 引入转换工具
import FolderContextMenu from '../overlays/FolderContextMenu.vue';
import ConfirmModal from '../overlays/ConfirmModal.vue'; 

const { 
  currentViewMode, localMusicTab, currentArtistFilter, currentAlbumFilter,
  artistList, albumList, folderList, currentFolderFilter,
  isLocalMusic, isFolderMode,
  playSong, openInFinder, createPlaylist, removeFolder,
  getSongsInFolder, tempQueue, moveFilesToFolder,
  refreshFolder
} = usePlayer();

const sidebarImageCache = ref<Map<string, string>>(new Map());

// 🟢 2. 修改加载逻辑：路径 -> Asset URL
const loadSidebarCover = async (path: string) => {
  if (!path || sidebarImageCache.value.has(path)) return;
  try { 
    // 后端现在返回的是绝对路径 (例如 C:\Users\...\covers\xxx.jpg)
    const filePath = await invoke<string>('get_song_cover_thumbnail', { path }); 
    if (filePath && filePath.length > 0) {
      // 必须转换为 asset:// 链接，浏览器才能加载
      const assetUrl = convertFileSrc(filePath);
      sidebarImageCache.value.set(path, assetUrl); 
    }
  } catch {}
};

watch([artistList, albumList, folderList, currentViewMode, localMusicTab], () => {
  let list: any[] = [];
  if (currentViewMode.value === 'all') {
    list = localMusicTab.value === 'artist' ? artistList.value : (localMusicTab.value === 'album' ? albumList.value : []);
  } else if (currentViewMode.value === 'folder') {
    list = folderList.value;
  }
  list.forEach(item => { if (item.firstSongPath) loadSidebarCover(item.firstSongPath); });
}, { immediate: true, deep: true });

const showMenu = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const targetFolder = ref<{ name: string, path: string } | null>(null);

const handleContextMenu = (e: MouseEvent, folder: { name: string, path: string }) => { 
  e.preventDefault(); 
  targetFolder.value = folder; 
  menuX.value = e.clientX; 
  menuY.value = e.clientY; 
  showMenu.value = true; 
};

const playFolder = () => { if (targetFolder.value) { const s = getSongsInFolder(targetFolder.value.path); if (s.length > 0) { playSong(s[0]); currentFolderFilter.value = targetFolder.value.path; } showMenu.value = false; } };
const addToQueue = () => { if (targetFolder.value) { getSongsInFolder(targetFolder.value.path).forEach(s => tempQueue.value.push(s)); showMenu.value = false; } };
const createPlaylistFromFolder = () => { if (targetFolder.value) { const s = getSongsInFolder(targetFolder.value.path); if (s.length > 0) createPlaylist(targetFolder.value.name, s.map(song => song.path)); showMenu.value = false; } };
const openFolder = () => { if (targetFolder.value) { openInFinder(targetFolder.value.path); showMenu.value = false; } };
const removeFolderItem = () => { if (targetFolder.value) { removeFolder(targetFolder.value.path); showMenu.value = false; } };

const handleRefreshFolder = async () => {
  if (targetFolder.value) {
    try {
      await refreshFolder(targetFolder.value.path);
      showMenu.value = false;
    } catch (e) {
      alert("刷新失败: " + e);
    }
  }
};

// --- 模拟拖拽逻辑 ---
const showMoveConfirm = ref(false);
const dragPendingFiles = ref<string[]>([]);
const moveTarget = ref<{ name: string, path: string } | null>(null);

const handleDropEvent = () => {
  if (dragSession.targetFolder && dragSession.targetFolder.path !== currentFolderFilter.value) {
    dragPendingFiles.value = dragSession.songs.map(s => s.path);
    moveTarget.value = { ...dragSession.targetFolder };
    showMoveConfirm.value = true;
  }
};

const executeMove = async () => {
  if (moveTarget.value && dragPendingFiles.value.length > 0) {
    try {
      await moveFilesToFolder(dragPendingFiles.value, moveTarget.value.path);
      dragPendingFiles.value = [];
      showMoveConfirm.value = false;
    } catch (e) {
      alert("移动失败: " + e);
    }
  }
};

onMounted(() => {
  window.addEventListener('custom-drop-trigger', handleDropEvent);
});
onUnmounted(() => {
  window.removeEventListener('custom-drop-trigger', handleDropEvent);
});

</script>

<template>
  <aside v-if="(isLocalMusic && localMusicTab !== 'default') || isFolderMode" class="w-60 h-full border-r border-white/10 overflow-y-auto custom-scrollbar bg-transparent shrink-0 select-none">
    
    <ul v-if="isLocalMusic && localMusicTab === 'artist'" class="p-2 space-y-1">
        <li v-for="item in artistList" :key="item.name" @click="currentArtistFilter = item.name" :class="currentArtistFilter === item.name ? 'bg-white/40 shadow-sm' : 'hover:bg-white/20'" class="flex items-center p-2 rounded-lg cursor-pointer transition-all">
          <div class="w-10 h-10 rounded-full bg-white/30 flex items-center justify-center text-gray-500 font-bold mr-3 shrink-0 overflow-hidden relative">
            <img v-if="sidebarImageCache.get(item.firstSongPath)" :src="sidebarImageCache.get(item.firstSongPath)" class="w-full h-full object-cover" />
            <span v-else>{{ item.name.charAt(0).toUpperCase() }}</span>
          </div>
          <div class="flex-1 min-w-0"><div class="text-sm font-medium text-gray-800 truncate">{{ item.name }}</div><div class="text-xs text-gray-500">{{ item.count }} 首</div></div>
        </li>
    </ul>

    <ul v-if="isLocalMusic && localMusicTab === 'album'" class="p-2 space-y-1">
        <li v-for="item in albumList" :key="item.name" @click="currentAlbumFilter = item.name" :class="currentAlbumFilter === item.name ? 'bg-white/40 shadow-sm' : 'hover:bg-white/20'" class="flex items-center p-2 rounded-lg cursor-pointer transition-all">
          <div class="w-10 h-10 rounded bg-white/30 flex items-center justify-center text-gray-500 mr-3 shrink-0 overflow-hidden relative">
            <img v-if="sidebarImageCache.get(item.firstSongPath)" :src="sidebarImageCache.get(item.firstSongPath)" class="w-full h-full object-cover" />
            <span v-else>💿</span>
          </div>
          <div class="flex-1 min-w-0"><div class="text-sm font-medium text-gray-800 truncate">{{ item.name }}</div><div class="text-xs text-gray-500">{{ item.count }} 首</div></div>
        </li>
    </ul>

    <ul v-if="isFolderMode" class="p-2 space-y-1 transition-all duration-300">
        <li 
          v-for="item in folderList" 
          :key="item.path" 
          :data-folder-path="item.path"
          :data-folder-name="item.name"
          @click="currentFolderFilter = item.path" 
          @contextmenu="handleContextMenu($event, item)" 
          class="folder-drop-target flex items-center p-2 rounded-lg cursor-pointer transition-all"
          :class="[
            currentFolderFilter === item.path ? 'bg-white/40 shadow-sm' : 'hover:bg-white/20',
            (dragSession.active && dragSession.targetFolder?.path === item.path && currentFolderFilter !== item.path) ? 'ring-2 ring-[#EC4141] bg-red-50/50' : ''
          ]"
        >
          <div class="w-10 h-10 rounded bg-blue-50/50 border border-blue-100/50 flex items-center justify-center text-blue-400 mr-3 shrink-0 overflow-hidden relative">
            <img v-if="sidebarImageCache.get(item.firstSongPath)" :src="sidebarImageCache.get(item.firstSongPath)" class="w-full h-full object-cover" />
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-gray-800 truncate" :title="item.path">{{ item.name }}</div>
            <div class="text-xs text-gray-500">{{ item.count }} 首</div>
          </div>
        </li>
        <li v-if="folderList.length === 0" class="text-xs text-gray-400 text-center py-4">暂无文件夹，请点击右上角添加</li>
    </ul>

    <Teleport to="body">
      <FolderContextMenu 
        :visible="showMenu" 
        :x="menuX" 
        :y="menuY" 
        :folder-path="targetFolder?.path || ''" 
        @close="showMenu = false" 
        @play="playFolder" 
        @add-to-queue="addToQueue" 
        @create-playlist="createPlaylistFromFolder" 
        @open-folder="openFolder" 
        @refresh="handleRefreshFolder" 
        @remove="removeFolderItem" 
      />
    </Teleport>

    <ConfirmModal 
      :visible="showMoveConfirm" 
      title="物理移动文件" 
      :content="`确定将这 ${dragPendingFiles.length} 个文件物理移动到文件夹 '${moveTarget?.name}' 吗？`" 
      @confirm="executeMove" 
      @cancel="showMoveConfirm = false" 
    />

  </aside>
</template>