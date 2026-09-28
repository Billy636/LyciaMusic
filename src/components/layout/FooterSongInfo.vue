<script setup lang="ts">
import { computed } from 'vue';
import type { Song } from '../../types';
import type { FooterBehavior } from '../../types/footer';

const props = defineProps<{
  mode: FooterBehavior['info']; song: Song | null; cover: string;
  currentTime: string; totalTime: string; expanded: boolean;
  downloadLabel?: string; preview?: boolean;
}>();
defineEmits<{ toggle: [] }>();
const hasCover = computed(() => ['cover', 'song', 'both'].includes(props.mode));
const songInfoMode = computed<'song' | 'both'>(previous =>
  props.mode === 'song' || props.mode === 'both' ? props.mode : previous ?? 'song');
</script>

<template>
  <div v-if="mode !== 'none'" :data-player-song-info="preview ? undefined : ''" class="flex h-full min-w-0 flex-1 items-center"
    :class="{ 'cursor-pointer': song && !preview }">
    <button type="button" :data-footer-cover="preview ? undefined : ''" title="切换播放页" class="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg"
      :class="{ 'opacity-0 pointer-events-none': !hasCover }" :inert="!hasCover || preview || undefined" :aria-hidden="!hasCover || preview" @click.stop="$emit('toggle')">
      <img v-if="(expanded || preview) && cover && hasCover" :src="cover" class="h-full w-full object-cover" alt="" draggable="false" />
    </button>
    <div v-if="mode !== 'cover'" class="footer-info-text relative ml-3 h-10 min-w-0 flex-1" :class="{ 'is-time-only': !hasCover }">
      <div class="footer-info-state footer-info-song absolute inset-0 flex flex-col justify-center" :class="{ 'is-hidden': !hasCover }" :aria-hidden="!hasCover">
        <div class="truncate text-sm font-semibold">{{ song ? song.title || song.name.replace(/\.[^/.]+$/, '') : '听我想听的音乐' }}</div>
        <div class="truncate text-xs" :class="[expanded ? 'text-white/60' : 'text-gray-500 dark:text-gray-400', { 'tabular-nums': songInfoMode === 'both' }]">{{ downloadLabel || (songInfoMode === 'song' ? song?.artist || 'My Music' : `${currentTime} / ${totalTime}`) }}</div>
      </div>
      <div class="footer-info-state footer-info-time absolute inset-0 flex flex-col justify-center" :class="[expanded ? 'text-white/90' : 'text-gray-500 dark:text-gray-400', { 'is-hidden': hasCover }]" :aria-hidden="hasCover">
        <div class="truncate text-[12px] font-semibold tabular-nums tracking-wide">
          <template v-if="downloadLabel">{{ downloadLabel }}</template>
          <template v-else>{{ currentTime }} <span class="mx-1 opacity-50">/</span> {{ totalTime }}</template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.footer-info-text { transition:transform 400ms cubic-bezier(.4,0,.2,1); }
.footer-info-text.is-time-only { transform:translateX(-60px); }
.footer-info-state { transition:opacity 400ms cubic-bezier(.4,0,.2,1),transform 400ms cubic-bezier(.4,0,.2,1); }
.footer-info-state.is-hidden { opacity:0; pointer-events:none; }
.footer-info-song.is-hidden { transform:translateY(16px); }
.footer-info-time.is-hidden { transform:translateY(-16px); }
@media(prefers-reduced-motion:reduce) { .footer-info-text,.footer-info-state { transition:none; } }
</style>
