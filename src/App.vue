<script setup lang="ts">
import { usePlayer } from './composables/player';
import Sidebar from './components/layout/Sidebar.vue';
import TitleBar from './components/layout/TitleBar.vue'; 
import PlayerFooter from './components/layout/PlayerFooter.vue';
import GlobalBackground from './components/layout/GlobalBackground.vue';
import { watch, computed } from 'vue';

// ✅ 播放队列侧边栏
import PlayQueueSidebar from './components/player/PlayQueueSidebar.vue';

// 🔴 修正点 1: PlayerDetail 移到了 player 文件夹
import PlayerDetail from './components/player/PlayerDetail.vue'; 

// 🔴 修正点 2: AddToPlaylistModal 移到了 overlays 文件夹
import AddToPlaylistModal from './components/overlays/AddToPlaylistModal.vue'; 
import Toast from './components/common/Toast.vue';

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

// --- 动态模糊逻辑 ---
const mainBlurStyle = computed(() => {
  const { dynamicBgType, mode, customBackground } = settings.value.theme;
  
  if (dynamicBgType === 'flow' || dynamicBgType === 'blur') {
    return 'blur(40px)';
  }
  
  if (mode === 'custom') {
    const b = customBackground.blur;
    return b <= 0 ? 'none' : `blur(${b}px)`;
  }
  
  return 'none';
});
</script>

<template>
  <div class="flex flex-col h-screen w-full text-gray-800 dark:text-gray-200 relative overflow-hidden font-sans">
    
    <GlobalBackground />

    <div 
      class="flex-1 flex flex-col overflow-hidden relative z-10 transition-colors duration-500"
      :class="[settings.theme.mode === 'custom' ? 'bg-transparent' : 'bg-white/30 dark:bg-black/60']"
      :style="{ backdropFilter: mainBlurStyle }"
    >
      <div class="flex flex-1 overflow-hidden">
        <Sidebar />
        
        <div class="flex-1 flex flex-col min-w-0">
          <TitleBar />
          <main class="flex-1 overflow-hidden relative">
            <router-view /> 
          </main>
        </div>
      </div>

      <PlayerFooter />
    </div>

    <PlayerDetail />

    <PlayQueueSidebar />

    <AddToPlaylistModal 
      :visible="showAddToPlaylistModal" 
      :selectedCount="playlistAddTargetSongs.length" 
      @close="showAddToPlaylistModal = false" 
      @add="handleGlobalAdd"
    />

    <Toast />
    
  </div>
</template>