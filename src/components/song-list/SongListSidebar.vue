<script setup lang="ts">
import { usePlayer, dragSession } from '../../composables/player';
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core'; // 🟢 1. 引入转换工具
import FolderContextMenu from '../overlays/FolderContextMenu.vue';
import ModernModal from '../common/ModernModal.vue'; 
import { useToast } from '../../composables/toast';

const { 
  currentViewMode, localMusicTab, currentArtistFilter, currentAlbumFilter,
  artistList, albumList, folderList, currentFolderFilter,
  isLocalMusic, isFolderMode,
  playSong, openInFinder, createPlaylist, removeFolder,
  getSongsInFolder, moveFilesToFolder,
  refreshFolder,
  addSongsToQueue,
  reorderWatchedFolders, // 🟢 引入排序函数
  updateArtistOrder,
  updateAlbumOrder
} = usePlayer();

const sidebarImageCache = ref<Map<string, string>>(new Map());
const dragOverId = ref<string | null>(null);
const dragPosition = ref<'top' | 'bottom' | null>(null);

// --- Custom Drag & Drop for Folders/Artists/Albums ---
let mouseDownInfo: { x: number, y: number, index: number, item: any, type: 'folder' | 'artist' | 'album' } | null = null;

const handleMouseDown = (e: MouseEvent, index: number, item: any, type: 'folder' | 'artist' | 'album') => {
  if (e.button !== 0) return;
  mouseDownInfo = { x: e.clientX, y: e.clientY, index, item, type };
};

const handleGlobalMouseMove = (e: MouseEvent) => {
  if (mouseDownInfo && !dragSession.active) {
    const dist = Math.sqrt(Math.pow(e.clientX - mouseDownInfo.x, 2) + Math.pow(e.clientY - mouseDownInfo.y, 2));
    if (dist > 5) {
      dragSession.active = true;
      dragSession.type = mouseDownInfo.type;
      
      if (mouseDownInfo.type === 'folder') {
        dragSession.data = { index: mouseDownInfo.index, path: mouseDownInfo.item.path, name: mouseDownInfo.item.name };
      } else {
        dragSession.data = { index: mouseDownInfo.index, name: mouseDownInfo.item.name };
      }
    }
  }
};

const handleGlobalMouseUp = () => {
  if (!dragSession.active) {
    mouseDownInfo = null;
    return;
  }

  // Handle Drop based on Type
  if (dragSession.type === 'folder') {
    handleDropLogic(folderList.value, 'path', reorderWatchedFolders);
  } else if (dragSession.type === 'artist') {
    handleDropLogic(artistList.value, 'name', (from, to) => {
        const list = [...artistList.value];
        const [removed] = list.splice(from, 1);
        list.splice(to, 0, removed);
        updateArtistOrder(list.map(a => a.name));
    });
  } else if (dragSession.type === 'album') {
    handleDropLogic(albumList.value, 'name', (from, to) => {
        const list = [...albumList.value];
        const [removed] = list.splice(from, 1);
        list.splice(to, 0, removed);
        updateAlbumOrder(list.map(a => a.name));
    });
  }
  
  // Reset
  mouseDownInfo = null;
  if (['folder', 'artist', 'album'].includes(dragSession.type)) {
     dragSession.active = false;
     dragSession.type = 'song';
     dragSession.data = null;
     dragOverId.value = null;
     dragPosition.value = null;
  }
};

const handleDropLogic = (list: any[], key: string, callback: (from: number, to: number) => void) => {
    if (dragOverId.value && mouseDownInfo) {
      const fromIndex = mouseDownInfo.index;
      const targetIndex = list.findIndex(i => i[key] === dragOverId.value);
      
      if (targetIndex !== -1) {
        let toIndex = targetIndex;
        if (dragPosition.value === 'bottom') {
          toIndex++;
        }
        if (fromIndex < toIndex) {
          toIndex--;
        }
        
        if (fromIndex !== toIndex) {
          callback(fromIndex, toIndex);
        }
      }
    }
};

const handleItemMouseMove = (e: MouseEvent, id: string, type: 'folder' | 'artist' | 'album') => {
  if (dragSession.active && dragSession.type === type) {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    
    dragOverId.value = id;
    dragPosition.value = e.clientY < mid ? 'top' : 'bottom';
  }
};

onMounted(() => {
  window.addEventListener('custom-drop-trigger', handleDropEvent);
  window.addEventListener('mousemove', handleGlobalMouseMove);
  window.addEventListener('mouseup', handleGlobalMouseUp);
});
onUnmounted(() => {
  window.removeEventListener('custom-drop-trigger', handleDropEvent);
  window.removeEventListener('mousemove', handleGlobalMouseMove);
  window.removeEventListener('mouseup', handleGlobalMouseUp);
});
// ------------------------------

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

// 🟢 批量选择逻辑
const selectedFolderPaths = ref<Set<string>>(new Set());
const lastSelectedFolderPath = ref<string | null>(null);

const handleFolderClick = (e: MouseEvent, folder: { name: string, path: string }) => {
  e.stopPropagation(); // 阻止冒泡，防止触发背景点击
  // 总是设为当前过滤条件
  currentFolderFilter.value = folder.path;

  // 1. Shift 连选
  if (e.shiftKey && lastSelectedFolderPath.value) {
    const list = folderList.value;
    const lastIndex = list.findIndex(f => f.path === lastSelectedFolderPath.value);
    const currentIndex = list.findIndex(f => f.path === folder.path);
    
    if (lastIndex !== -1 && currentIndex !== -1) {
      const start = Math.min(lastIndex, currentIndex);
      const end = Math.max(lastIndex, currentIndex);
      // 清空旧选区还是追加？通常 Shift 是追加或重置范围。这里简化为追加范围。
      // 但为了符合直觉，通常 Shift 会重置为锚点到当前的范围。
      // 这里采用简单追加逻辑
      for (let i = start; i <= end; i++) {
        selectedFolderPaths.value.add(list[i].path);
      }
    }
  } 
  // 2. Ctrl/Cmd 加选
  else if (e.ctrlKey || e.metaKey) {
    if (selectedFolderPaths.value.has(folder.path)) {
      selectedFolderPaths.value.delete(folder.path);
    } else {
      selectedFolderPaths.value.add(folder.path);
    }
    lastSelectedFolderPath.value = folder.path;
  } 
  // 3. 普通单选
  else {
    selectedFolderPaths.value.clear();
    selectedFolderPaths.value.add(folder.path);
    lastSelectedFolderPath.value = folder.path;
  }
};

const handleBackgroundClick = () => {
  // 点击空白处，重置为单选当前文件夹（如果存在）
  if (currentFolderFilter.value) {
    selectedFolderPaths.value.clear();
    selectedFolderPaths.value.add(currentFolderFilter.value);
  }
};

const handleContextMenu = (e: MouseEvent, folder: { name: string, path: string }) => { 
  e.preventDefault(); 
  e.stopPropagation(); // 防止冒泡
  targetFolder.value = folder; 
  
  // 如果右键点击的项不在选中集合中，则视为单选该项（符合操作系统习惯）
  if (!selectedFolderPaths.value.has(folder.path)) {
    selectedFolderPaths.value.clear();
    selectedFolderPaths.value.add(folder.path);
    lastSelectedFolderPath.value = folder.path;
    currentFolderFilter.value = folder.path;
  }

  menuX.value = e.clientX; 
  menuY.value = e.clientY; 
  showMenu.value = true; 
};

const handleMenuCancel = () => {
  showMenu.value = false;
  // 右键菜单取消（点击外部），重置为单选当前文件夹
  if (currentFolderFilter.value) {
    selectedFolderPaths.value.clear();
    selectedFolderPaths.value.add(currentFolderFilter.value);
  }
};

const playFolder = () => { if (targetFolder.value) { const s = getSongsInFolder(targetFolder.value.path); if (s.length > 0) { playSong(s[0]); currentFolderFilter.value = targetFolder.value.path; } showMenu.value = false; } };
const addToQueue = () => { if (targetFolder.value) { const s = getSongsInFolder(targetFolder.value.path); addSongsToQueue(s); showMenu.value = false; } };
const createPlaylistFromFolder = () => { if (targetFolder.value) { const s = getSongsInFolder(targetFolder.value.path); if (s.length > 0) createPlaylist(targetFolder.value.name, s.map(song => song.path)); showMenu.value = false; } };
const openFolder = () => { if (targetFolder.value) { openInFinder(targetFolder.value.path); showMenu.value = false; } };

// 🟢 批量删除逻辑
const showDeleteConfirm = ref(false);
const foldersToDelete = ref<string[]>([]);

const removeFolderItem = () => { 
  if (selectedFolderPaths.value.size > 0) {
    foldersToDelete.value = Array.from(selectedFolderPaths.value);
    showDeleteConfirm.value = true;
  } else if (targetFolder.value) { 
    foldersToDelete.value = [targetFolder.value.path];
    showDeleteConfirm.value = true;
  }
  showMenu.value = false; 
};

const executeDeleteFolders = () => {
  foldersToDelete.value.forEach(path => removeFolder(path));
  selectedFolderPaths.value.clear();
  foldersToDelete.value = [];
  showDeleteConfirm.value = false;
};

const handleRefreshFolder = async () => {
  if (targetFolder.value) {
    try {
      await refreshFolder(targetFolder.value.path);
      showMenu.value = false;
      useToast().showToast("刷新成功", "success");
    } catch (e) {
      useToast().showToast("刷新失败: " + e, "error");
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
      useToast().showToast("移动成功", "success");
    } catch (e) {
      useToast().showToast("移动失败: " + e, "error");
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
        <li 
          v-for="(item, index) in artistList" 
          :key="item.name" 
          @mousedown="handleMouseDown($event, index, item, 'artist')"
          @mousemove="handleItemMouseMove($event, item.name, 'artist')"
          @click="currentArtistFilter = item.name" 
          :class="[
            currentArtistFilter === item.name ? 'bg-white/40 dark:bg-white/20 shadow-sm' : 'hover:bg-white/20 dark:hover:bg-white/10',
            (dragSession.active && dragSession.type === 'artist' && dragSession.data?.name === item.name) ? 'opacity-50' : '',
            (dragSession.type === 'artist' && dragOverId === item.name && dragPosition === 'top') ? '!border-t-2 !border-t-[#EC4141]' : '',
            (dragSession.type === 'artist' && dragOverId === item.name && dragPosition === 'bottom') ? '!border-b-2 !border-b-[#EC4141]' : ''
          ]"
          class="flex items-center p-2 rounded-lg cursor-pointer transition-all border-t-2 border-transparent border-b-2 select-none"
        >
          <div class="w-10 h-10 rounded-full bg-white/30 dark:bg-white/10 flex items-center justify-center text-gray-500 dark:text-gray-400 font-bold mr-3 shrink-0 overflow-hidden relative">
            <img v-if="sidebarImageCache.get(item.firstSongPath)" :src="sidebarImageCache.get(item.firstSongPath)" class="w-full h-full object-cover" />
            <span v-else>{{ item.name.charAt(0).toUpperCase() }}</span>
          </div>
          <div class="flex-1 min-w-0"><div class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ item.name }}</div><div class="text-xs text-gray-500 dark:text-gray-400">{{ item.count }} 首</div></div>
        </li>
    </ul>

    <ul v-if="isLocalMusic && localMusicTab === 'album'" class="p-2 space-y-1">
        <li 
          v-for="(item, index) in albumList" 
          :key="item.name" 
          @mousedown="handleMouseDown($event, index, item, 'album')"
          @mousemove="handleItemMouseMove($event, item.name, 'album')"
          @click="currentAlbumFilter = item.name" 
          :class="[
            currentAlbumFilter === item.name ? 'bg-white/40 dark:bg-white/20 shadow-sm' : 'hover:bg-white/20 dark:hover:bg-white/10',
            (dragSession.active && dragSession.type === 'album' && dragSession.data?.name === item.name) ? 'opacity-50' : '',
            (dragSession.type === 'album' && dragOverId === item.name && dragPosition === 'top') ? '!border-t-2 !border-t-[#EC4141]' : '',
            (dragSession.type === 'album' && dragOverId === item.name && dragPosition === 'bottom') ? '!border-b-2 !border-b-[#EC4141]' : ''
          ]"
          class="flex items-center p-2 rounded-lg cursor-pointer transition-all border-t-2 border-transparent border-b-2 select-none"
        >
          <div class="w-10 h-10 rounded bg-white/30 dark:bg-white/10 flex items-center justify-center text-gray-500 dark:text-gray-400 mr-3 shrink-0 overflow-hidden relative">
            <img v-if="sidebarImageCache.get(item.firstSongPath)" :src="sidebarImageCache.get(item.firstSongPath)" class="w-full h-full object-cover" />
            <span v-else>💿</span>
          </div>
          <div class="flex-1 min-w-0"><div class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ item.name }}</div><div class="text-xs text-gray-500 dark:text-gray-400">{{ item.count }} 首</div></div>
        </li>
    </ul>

    <ul v-show="isFolderMode" @click="handleBackgroundClick" class="p-2 space-y-1 transition-all duration-300 min-h-full">
        <li 
          v-for="(item, index) in folderList" 
          :key="item.path" 
          @mousedown="handleMouseDown($event, index, item, 'folder')"
          @mousemove="handleItemMouseMove($event, item.path, 'folder')"
          :data-folder-path="item.path"
          :data-folder-name="item.name"
          @click="handleFolderClick($event, item)" 
          @contextmenu="handleContextMenu($event, item)" 
          class="folder-drop-target flex items-center p-2 rounded-lg cursor-pointer transition-all border-t-2 border-transparent border-b-2 select-none"
          :class="[
            selectedFolderPaths.has(item.path) ? 'bg-white/40 dark:bg-white/20 shadow-sm' : 'hover:bg-white/20 dark:hover:bg-white/10',
            (dragSession.active && dragSession.type === 'folder' && dragSession.data?.path === item.path) ? 'opacity-50 bg-gray-100 dark:bg-white/5' : '',
            (dragSession.active && dragSession.targetFolder?.path === item.path && currentFolderFilter !== item.path && dragSession.type === 'song') ? 'ring-2 ring-[#EC4141] bg-red-50/50 dark:bg-red-500/10' : '',
            (dragSession.type === 'folder' && dragOverId === item.path && dragPosition === 'top') ? '!border-t-[#EC4141]' : '',
            (dragSession.type === 'folder' && dragOverId === item.path && dragPosition === 'bottom') ? '!border-b-[#EC4141]' : ''
          ]"
        >
          <div class="w-10 h-10 rounded bg-blue-50/50 dark:bg-blue-500/10 border border-blue-100/50 dark:border-blue-500/20 flex items-center justify-center text-blue-400 dark:text-blue-300 mr-3 shrink-0 overflow-hidden relative">
            <img v-if="sidebarImageCache.get(item.firstSongPath)" :src="sidebarImageCache.get(item.firstSongPath)" class="w-full h-full object-cover" />
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate" :title="item.path">{{ item.name }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ item.count }} 首</div>
          </div>
        </li>
        <li v-if="folderList.length === 0" class="text-xs text-gray-400 dark:text-gray-500 text-center py-4">暂无文件夹，请点击右上角添加</li>
    </ul>

    <FolderContextMenu 
      :visible="showMenu" 
      :x="menuX" 
      :y="menuY" 
      :folder-path="targetFolder?.path || ''" 
      :selected-count="selectedFolderPaths.size"
      @close="showMenu = false" 
      @cancel="handleMenuCancel"
      @play="playFolder" 
      @add-to-queue="addToQueue" 
      @create-playlist="createPlaylistFromFolder" 
      @open-folder="openFolder" 
      @refresh="handleRefreshFolder" 
      @remove="removeFolderItem" 
    />

    <ModernModal 
      v-model:visible="showMoveConfirm" 
      title="物理移动文件" 
      :content="`确定将这 ${dragPendingFiles.length} 个文件物理移动到文件夹 '${moveTarget?.name}' 吗？`" 
      @confirm="executeMove" 
    />

    <ModernModal 
      v-model:visible="showDeleteConfirm" 
      title="移除文件夹" 
      :content="`确定要从列表中移除选中的 ${foldersToDelete.length} 个文件夹吗？`" 
      type="danger"
      confirm-text="移除"
      @confirm="executeDeleteFolders" 
    />

  </aside>
</template>