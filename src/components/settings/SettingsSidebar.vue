<script setup lang="ts">
import { useSettings } from '../../features/settings/useSettings';

const { settings } = useSettings();
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <!-- Interface Layout (Sidebar Visibility) -->
    <section v-if="settings.sidebar" class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        侧边栏管理
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        
        <!-- Local Music (Locked/Checked) -->
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 opacity-70 cursor-not-allowed">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center text-gray-500 shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            </div>
            <div>
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">本地音乐</div>
              <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">核心功能 (不可隐藏)</div>
            </div>
          </div>
          <div class="relative inline-flex h-6 w-11 items-center rounded-full bg-[#EC4141] opacity-50">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white translate-x-6 shadow-sm" />
          </div>
        </div>

        <!-- Artists -->
        <div 
              @click="settings.sidebar.showArtists = !settings.sidebar.showArtists"
          class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0" :class="settings.sidebar.showArtists ? 'text-[#EC4141] bg-red-100/50' : 'text-gray-500'">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">歌手</div>
          </div>
              <button class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.sidebar.showArtists ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
                <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.sidebar.showArtists ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <!-- Albums -->
        <div 
              @click="settings.sidebar.showAlbums = !settings.sidebar.showAlbums"
          class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0" :class="settings.sidebar.showAlbums ? 'text-[#EC4141] bg-red-100/50' : 'text-gray-500'">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2" /><circle cx="12" cy="12" r="3" stroke-width="2" /></svg>
            </div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">专辑</div>
          </div>
              <button class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.sidebar.showAlbums ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
                <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.sidebar.showAlbums ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <!-- Favorites -->
        <div 
              @click="settings.sidebar.showFavorites = !settings.sidebar.showFavorites"
          class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0" :class="settings.sidebar.showFavorites ? 'text-[#EC4141] bg-red-100/50' : 'text-gray-500'">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            </div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">我的收藏</div>
          </div>
              <button class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.sidebar.showFavorites ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
                <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.sidebar.showFavorites ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <!-- Recent -->
        <div 
              @click="settings.sidebar.showRecent = !settings.sidebar.showRecent"
          class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0" :class="settings.sidebar.showRecent ? 'text-[#EC4141] bg-red-100/50' : 'text-gray-500'">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">最近播放</div>
          </div>
              <button class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.sidebar.showRecent ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
                <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.sidebar.showRecent ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <!-- Folders -->
        <div 
              @click="settings.sidebar.showFolders = !settings.sidebar.showFolders"
          class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0" :class="settings.sidebar.showFolders ? 'text-[#EC4141] bg-red-100/50' : 'text-gray-500'">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
            </div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">文件夹</div>
          </div>
              <button class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.sidebar.showFolders ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
                <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.sidebar.showFolders ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <!-- Statistics -->
        <div 
              @click="settings.sidebar.showStatistics = !settings.sidebar.showStatistics"
          class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0" :class="settings.sidebar.showStatistics ? 'text-[#EC4141] bg-red-100/50' : 'text-gray-500'">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            </div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">统计</div>
          </div>
              <button class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.sidebar.showStatistics ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
                <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.sidebar.showStatistics ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <!-- Playlists -->
        <div
              @click="settings.sidebar.showPlaylists = !settings.sidebar.showPlaylists"
          class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0" :class="settings.sidebar.showPlaylists ? 'text-[#EC4141] bg-red-100/50' : 'text-gray-500'">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 10l12-3M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>
            </div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">我的歌单</div>
          </div>
              <button class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.sidebar.showPlaylists ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
                <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.sidebar.showPlaylists ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

      </div>
    </section>
  </div>
</template>
