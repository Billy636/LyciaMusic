<script setup lang="ts">
import { ref } from 'vue';

interface SidebarSettings {
  showLocalMusic: boolean;
  showArtists: boolean;
  showAlbums: boolean;
  showFavorites: boolean;
  showRecent: boolean;
  showFolders: boolean;
  showStatistics: boolean;
}

interface Props {
  sidebar: SidebarSettings;
  currentViewMode: string;
  currentPath: string;
  isDragActive: boolean;
}

const props = defineProps<Props>();

defineEmits<{
  (event: 'openAll'): void;
  (event: 'openArtists'): void;
  (event: 'openAlbums'): void;
  (event: 'openPlaylists'): void;
  (event: 'openFavorites'): void;
  (event: 'openRecent'): void;
  (event: 'openFolder'): void;
  (event: 'openStatistics'): void;
  (event: 'hoverArtists'): void;
  (event: 'hoverAlbums'): void;
}>();

const hoveredItem = ref<string | null>(null);
let leaveTimer: ReturnType<typeof setTimeout> | undefined;

function handleItemEnter(id: string) {
  clearTimeout(leaveTimer);
  hoveredItem.value = id;
}

function handleItemLeave() {
  leaveTimer = setTimeout(() => {
    hoveredItem.value = null;
  }, 150);
}

const baseNavClasses = 'px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all duration-100 text-sm font-medium active:scale-[0.97]';
const activeNavClasses = 'bg-black/10 dark:bg-white/10 text-black dark:text-white font-semibold shadow-sm translate-x-1';
const idleClasses = 'text-gray-800 dark:text-gray-200';
const hoverClasses = 'bg-black/5 dark:bg-white/5 text-black dark:text-white translate-x-1';
</script>

<template>
  <ul class="space-y-1 transition-all duration-200" :class="{ 'opacity-30 grayscale pointer-events-none': isDragActive }">
    <template v-if="props.sidebar.showLocalMusic">
      <li
        @click="$emit('openAll')"
        @mouseenter="handleItemEnter('all')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, (props.currentViewMode === 'all' && props.currentPath === '/') ? activeNavClasses : idleClasses, hoveredItem === 'all' && !(props.currentViewMode === 'all' && props.currentPath === '/') ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
        <span>本地音乐</span>
      </li>
    </template>

    <template v-if="props.sidebar.showArtists">
      <li
        @click="$emit('openArtists')"
        @mouseenter="handleItemEnter('artists'); $emit('hoverArtists')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, props.currentPath === '/artists' ? activeNavClasses : idleClasses, hoveredItem === 'artists' && props.currentPath !== '/artists' ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
        <span>歌手</span>
      </li>
    </template>

    <template v-if="props.sidebar.showAlbums">
      <li
        @click="$emit('openAlbums')"
        @mouseenter="handleItemEnter('albums'); $emit('hoverAlbums')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, props.currentPath === '/albums' ? activeNavClasses : idleClasses, hoveredItem === 'albums' && props.currentPath !== '/albums' ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2" /><circle cx="12" cy="12" r="3" stroke-width="2" /></svg>
        <span>专辑</span>
      </li>
    </template>

    <li
      data-nav="playlists"
      role="button"
      tabindex="0"
      :aria-current="props.currentPath === '/playlists' ? 'page' : undefined"
      @click="$emit('openPlaylists')"
      @keydown.enter.prevent="$emit('openPlaylists')"
      @keydown.space.prevent="$emit('openPlaylists')"
      @mouseenter="handleItemEnter('playlists')"
      @mouseleave="handleItemLeave()"
      :class="[baseNavClasses, props.currentPath === '/playlists' ? activeNavClasses : idleClasses, hoveredItem === 'playlists' && props.currentPath !== '/playlists' ? hoverClasses : '']"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5h14M4 10h14M4 15h7m5 3V8l5-1v9m-5 2c0 1.1-1.1 2-2.5 2S11 19.1 11 18s1.1-2 2.5-2 2.5.9 2.5 2zm5-2c0 1.1-1.1 2-2.5 2S16 17.1 16 16s1.1-2 2.5-2 2.5.9 2.5 2z" /></svg>
      <span>歌单</span>
    </li>

    <template v-if="props.sidebar.showFavorites">
      <li
        @click="$emit('openFavorites')"
        @mouseenter="handleItemEnter('favorites')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, props.currentPath === '/favorites' ? activeNavClasses : idleClasses, hoveredItem === 'favorites' && props.currentPath !== '/favorites' ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
        <span>我的收藏</span>
      </li>
    </template>

    <template v-if="props.sidebar.showRecent">
      <li
        @click="$emit('openRecent')"
        @mouseenter="handleItemEnter('recent')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, props.currentPath === '/recent' ? activeNavClasses : idleClasses, hoveredItem === 'recent' && props.currentPath !== '/recent' ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>最近播放</span>
      </li>
    </template>

    <template v-if="props.sidebar.showFolders">
      <li
        @click="$emit('openFolder')"
        @mouseenter="handleItemEnter('folders')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, (props.currentViewMode === 'folder' && props.currentPath === '/') ? activeNavClasses : idleClasses, hoveredItem === 'folders' && !(props.currentViewMode === 'folder' && props.currentPath === '/') ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
        <span>文件夹</span>
      </li>
    </template>

    <template v-if="props.sidebar.showStatistics">
      <li
        @click="$emit('openStatistics')"
        @mouseenter="handleItemEnter('statistics')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, (props.currentViewMode === 'statistics' && props.currentPath === '/') ? activeNavClasses : idleClasses, hoveredItem === 'statistics' && !(props.currentViewMode === 'statistics' && props.currentPath === '/') ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        <span>统计</span>
      </li>
    </template>
  </ul>
</template>
