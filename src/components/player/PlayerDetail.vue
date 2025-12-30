<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { getCurrentWindow } from '@tauri-apps/api/window'; 
import LyricsView from './LyricsView.vue';
import QueueList from './QueueList.vue';
import PlayerDetailBackground from './PlayerDetailBackground.vue';
import PlayerDetailLeft from './PlayerDetailLeft.vue';

const { 
  showPlayerDetail, togglePlayerDetail, showQueue
} = usePlayer();

// --- 窗口控制 ---
const appWindow = getCurrentWindow();
const minimize = () => appWindow.minimize();
const toggleMaximize = async () => { const isMax = await appWindow.isMaximized(); isMax ? appWindow.unmaximize() : appWindow.maximize(); };
const closeApp = () => appWindow.close();
</script>

<template>
  <transition name="expand-up">
    <div v-if="showPlayerDetail" class="fixed inset-0 z-[100] bg-[#0a0a0a] flex flex-col overflow-hidden font-sans select-none text-white">
      
      <!-- 沉浸式背景层 -->
      <PlayerDetailBackground />

      <!-- 顶栏：窗口控制 & 收起按钮 -->
      <div class="relative z-[60] h-16 flex items-center justify-between px-6">
        <div class="absolute inset-0" data-tauri-drag-region></div>

        <div class="flex items-center relative z-10">
          <button @click="togglePlayerDetail" class="p-2 hover:bg-white/10 rounded-lg transition text-white/60 hover:text-white" title="收起详情页">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </button>
        </div>

        <div class="flex items-center gap-2 relative z-10">
          <button @click="minimize" class="p-2 hover:bg-white/10 rounded-lg transition text-white/60 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14" /></svg></button>
          <button @click="toggleMaximize" class="p-2 hover:bg-white/10 rounded-lg transition text-white/60 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg></button>
          <button @click="closeApp" class="p-2 hover:bg-red-500 rounded-lg transition text-white/60 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
        </div>
      </div>

      <!-- 主内容区域：双栏布局 (45:55) -->
      <div class="relative z-50 flex-1 flex min-h-0 overflow-hidden">
        <!-- 左侧：静态信息区 (45%) -->
        <div class="w-[45%] h-full flex items-center justify-center pl-16 pr-8">
          <PlayerDetailLeft />
        </div>

        <!-- 右侧：歌词滚动区 (55%) -->
        <div class="w-[55%] h-full flex flex-col pr-16 pl-8 py-12">
          <transition name="fade-scale" mode="out-in">
            <QueueList v-if="showQueue" />
            <LyricsView v-else />
          </transition>
        </div>
      </div>

    </div>
  </transition>
</template>

<style scoped>
.expand-up-enter-active,
.expand-up-leave-active {
  transition: all 0.5s cubic-bezier(0.3, 0, 0.2, 1);
  will-change: transform, opacity;
}

.expand-up-enter-from,
.expand-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>