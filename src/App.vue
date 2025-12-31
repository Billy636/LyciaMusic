<script setup lang="ts">
import { usePlayer } from './composables/player';
import Sidebar from './components/layout/Sidebar.vue';
import TitleBar from './components/layout/TitleBar.vue'; 
import PlayerFooter from './components/layout/PlayerFooter.vue';
import GlobalBackground from './components/layout/GlobalBackground.vue';
import { watch, computed, defineAsyncComponent } from 'vue';

// 使用异步组件按需加载非首屏组件
const PlayQueueSidebar = defineAsyncComponent(() => import('./components/player/PlayQueueSidebar.vue'));
const PlayerDetail = defineAsyncComponent(() => import('./components/player/PlayerDetail.vue')); 
const AddToPlaylistModal = defineAsyncComponent(() => import('./components/overlays/AddToPlaylistModal.vue')); 
const Toast = defineAsyncComponent(() => import('./components/common/Toast.vue'));

const { init, showAddToPlaylistModal, playlistAddTargetSongs, addSongsToQueue, settings, playQueue } = usePlayer();
init();

const isFooterVisible = computed(() => playQueue.value.length > 0);

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

      <transition name="footer-slide">
        <PlayerFooter v-if="isFooterVisible" />
      </transition>
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

    

    <style>

    .footer-slide-enter-active,

    .footer-slide-leave-active {

      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

      overflow: hidden;

    }

    

    .footer-slide-enter-from,

    .footer-slide-leave-to {

      transform: translateY(100%);

      max-height: 0 !important;

      opacity: 0;

    }

    

    .footer-slide-enter-to,

    .footer-slide-leave-from {

      transform: translateY(0);

      max-height: 80px !important;

      opacity: 1;

    }

    </style>

    