<script setup lang="ts">
import { AudioLines, BarChart3, Clock3, Disc3, FolderPlus, Heart, ListMusic, Music2, UserRound } from 'lucide-vue-next';
import type { SidebarNavigationId } from '../../features/settings/sidebarNavigation';

defineProps<{ id: SidebarNavigationId }>();

const icons = {
  localMusic: Music2,
  artists: UserRound,
  albums: Disc3,
  genres: AudioLines,
  playlists: ListMusic,
  favorites: Heart,
  recent: Clock3,
  folders: FolderPlus,
  statistics: BarChart3,
};
</script>

<template>
  <component :is="icons[id]" :size="16" :stroke-width="2" aria-hidden="true" />
</template>
