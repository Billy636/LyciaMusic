<script setup lang="ts">
import { computed } from 'vue';
import FooterIcon from './FooterIcon.vue';
import { footerAction } from '../../features/settings/footer';
import type { FooterMovableId } from '../../types/footer';

const props = defineProps<{
  id: FooterMovableId; label?: string; active?: boolean; disabled?: boolean; menu?: boolean; playing?: boolean;
  playMode?: number; volume?: number; progressHidden?: boolean; pinned?: boolean; expanded?: boolean;
}>();
defineEmits<{ activate: [event: MouseEvent]; enter: [event: MouseEvent | FocusEvent]; leave: [] }>();
const label = computed(() => props.label ?? footerAction(props.id).label);
const highlighted = computed(() => props.id === 'progress' ? props.progressHidden
  : props.id !== 'pin' && props.id !== 'volume' && props.id !== 'lyricsStyle' && props.id !== 'more' && props.active);
</script>

<template>
  <button
    type="button"
    :title="label"
    :aria-label="label"
    :aria-pressed="active"
    :aria-expanded="expanded"
    :disabled="disabled"
    :data-queue-trigger="id === 'queue' ? 'true' : undefined"
    :data-footer-action="id"
    class="footer-action rounded-md transition-colors disabled:cursor-default disabled:opacity-30"
    :class="[menu ? 'flex w-full items-center gap-3 px-3 py-2 text-left text-sm' : ['flex shrink-0 items-center justify-center', id === 'play' ? 'h-11 w-11' : 'h-8 w-8'], highlighted ? 'text-[#EC4141]' : id === 'play' && !menu ? 'text-current' : 'text-current opacity-80 hover:opacity-100']"
    @mousedown.stop
    @click.stop="$emit('activate', $event)"
    @mouseenter="$emit('enter', $event)"
    @focus="$emit('enter', $event)"
    @mouseleave="$emit('leave')"
    @blur="$emit('leave')"
  >
    <FooterIcon :id="id === 'play' && playing ? 'pause' : id" :active="active" :play-mode="playMode" :volume="volume" :progress-hidden="progressHidden" :pinned="pinned" />
    <span v-if="menu">{{ label }}</span>
  </button>
</template>

<style scoped>
.footer-action:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
</style>
