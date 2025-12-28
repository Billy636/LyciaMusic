<script setup lang="ts">
import { usePlayer } from './composables/player';
import Sidebar from './components/layout/Sidebar.vue';
import TitleBar from './components/layout/TitleBar.vue'; 
import PlayerFooter from './components/layout/PlayerFooter.vue';
import GlobalBackground from './components/layout/GlobalBackground.vue';
import { watch } from 'vue';

// ✅ 页面 (Views) - 路径正确
import Playlist from './views/Playlist.vue';

// 🔴 修正点 1: PlayerDetail 移到了 player 文件夹
import PlayerDetail from './components/player/PlayerDetail.vue'; 

// 🔴 修正点 2: AddToPlaylistModal 移到了 overlays 文件夹
import AddToPlaylistModal from './components/overlays/AddToPlaylistModal.vue'; 

const { init, showAddToPlaylistModal, playlistAddTargetSongs, addSongsToPlaylist, settings } = usePlayer();
init();

// --- 主题切换逻辑 ---
const applyTheme = () => {
  if (settings.value.theme.mode === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};

// 监听设置变化
watch(settings, () => {
  applyTheme();
}, { deep: true });

// 初始化应用
applyTheme();

const handleGlobalAdd = (playlistId: string) => {
  addSongsToPlaylist(playlistId, playlistAddTargetSongs.value);
  showAddToPlaylistModal.value = false;
};
</script>

<template>
  <div class="flex flex-col h-screen w-full text-gray-800 dark:text-gray-200 relative overflow-hidden font-sans">
    
    <GlobalBackground />

    <div class="flex flex-1 overflow-hidden relative z-0">
      <Sidebar />
      
      <div class="flex-1 flex flex-col min-w-0 bg-white/30 dark:bg-black/30 backdrop-blur-2xl transition-colors duration-500">
        <TitleBar />
        <main class="flex-1 overflow-hidden relative">
          <router-view /> 
        </main>
      </div>
      
    </div>

    <Playlist />
    
    <PlayerFooter />

    <PlayerDetail />

    <AddToPlaylistModal 
      :visible="showAddToPlaylistModal" 
      :selectedCount="playlistAddTargetSongs.length" 
      @close="showAddToPlaylistModal = false" 
      @add="handleGlobalAdd"
    />
    
  </div>
</template>