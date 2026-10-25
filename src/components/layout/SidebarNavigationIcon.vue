<script setup lang="ts">
import { h, type FunctionalComponent } from 'vue';
import { BarChart3, Clock3, Disc3, FolderPlus, Heart, ListMusic, Music2, UserRound } from 'lucide-vue-next';
import type { SidebarNavigationId } from '../../features/settings/sidebarNavigation';

defineProps<{ id: SidebarNavigationId }>();

// 流派入口：标签轮廓内嵌八分音符（自绘，遵循 lucide 的 24×24 / stroke-2 视觉规范）
const TagNoteIcon: FunctionalComponent<{ size?: number | string; strokeWidth?: number | string }> = (props) =>
  h('svg', {
    width: props.size ?? 24,
    height: props.size ?? 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': props.strokeWidth ?? 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }, [
    h('path', { d: 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z' }),
    h('circle', { cx: '7.6', cy: '9.9', r: '1.5' }),
    h('path', { d: 'M9.1 9.9V4.8' }),
    h('path', { d: 'M9.1 4.8c1.9.6 2.7 1.8 2.9 3.3' }),
  ]);

const icons = {
  localMusic: Music2,
  artists: UserRound,
  albums: Disc3,
  genres: TagNoteIcon,
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
