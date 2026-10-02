<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { getVisibleSidebarNavigation, type SidebarNavigationId } from '../../features/settings/sidebarNavigation';
import type { SidebarSettings } from '../../types';
import SidebarNavigationIcon from './SidebarNavigationIcon.vue';

interface Props {
  sidebar: SidebarSettings;
  currentViewMode: string;
  currentPath: string;
  isDragActive: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
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

const items = computed(() => getVisibleSidebarNavigation(props.sidebar));
const hoveredItem = ref<SidebarNavigationId | null>(null);
let leaveTimer: ReturnType<typeof setTimeout> | undefined;

const openItem: Record<SidebarNavigationId, () => void> = {
  localMusic: () => emit('openAll'),
  artists: () => emit('openArtists'),
  albums: () => emit('openAlbums'),
  playlists: () => emit('openPlaylists'),
  favorites: () => emit('openFavorites'),
  recent: () => emit('openRecent'),
  folders: () => emit('openFolder'),
  statistics: () => emit('openStatistics'),
};

function isActive(id: SidebarNavigationId) {
  if (id === 'localMusic') return props.currentPath === '/' && props.currentViewMode === 'all';
  if (id === 'folders') return props.currentPath === '/' && props.currentViewMode === 'folder';
  if (id === 'statistics') return props.currentPath === '/' && props.currentViewMode === 'statistics';
  return props.currentPath === `/${id}`;
}

function handleItemEnter(id: SidebarNavigationId) {
  clearTimeout(leaveTimer);
  hoveredItem.value = id;
  if (id === 'artists') emit('hoverArtists');
  if (id === 'albums') emit('hoverAlbums');
}

function handleItemLeave() {
  leaveTimer = setTimeout(() => {
    hoveredItem.value = null;
  }, 150);
}

onBeforeUnmount(() => clearTimeout(leaveTimer));

// Animate interaction feedback, not font metrics or the item's layout width.
const baseNavClasses = 'w-full px-3 py-2 rounded-md cursor-pointer flex items-center text-left transition-[color,background-color,box-shadow,translate,scale] duration-100 text-sm font-medium active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EC4141]';
const activeNavClasses = 'bg-black/10 dark:bg-white/10 text-black dark:text-white font-semibold shadow-sm translate-x-1';
const idleClasses = 'text-gray-800 dark:text-gray-200';
const hoverClasses = 'bg-black/5 dark:bg-white/5 text-black dark:text-white translate-x-1';
</script>

<template>
  <ul class="space-y-1 transition-[opacity,filter] duration-200" :class="{ 'opacity-30 grayscale pointer-events-none': isDragActive }">
    <li v-for="item in items" :key="item.id" :data-nav="item.id" class="mx-2">
      <button
        type="button"
        :disabled="isDragActive"
        :aria-current="isActive(item.id) ? 'page' : undefined"
        :class="[baseNavClasses, isActive(item.id) ? activeNavClasses : idleClasses, hoveredItem === item.id && !isActive(item.id) ? hoverClasses : '']"
        @click="openItem[item.id]()"
        @mouseenter="handleItemEnter(item.id)"
        @mouseleave="handleItemLeave()"
        @focus="handleItemEnter(item.id)"
        @blur="handleItemLeave()"
      >
        <SidebarNavigationIcon :id="item.id" class="mr-3 shrink-0" />
        <span>{{ item.label }}</span>
      </button>
    </li>
  </ul>
</template>
