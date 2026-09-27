<script setup lang="ts">
import { AudioLines, Ellipsis, Eye, EyeOff, SlidersHorizontal } from 'lucide-vue-next';
import type { FooterActionId } from '../../types/footer';

// Preserve the original footer artwork, sizes and state variants. Share it with
// the settings preview instead of substituting a different icon collection.
withDefaults(defineProps<{
  id: FooterActionId | 'previous' | 'play' | 'pause' | 'next';
  active?: boolean;
  playMode?: number;
  volume?: number;
  progressHidden?: boolean;
  pinned?: boolean;
}>(), { playMode: 0, volume: 100, pinned: true });
</script>

<template>
  <template v-if="id === 'favorite'">
    <svg v-if="active" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-[#EC4141]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" />
    </svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-gray-400 transition-colors hover:text-gray-600 dark:text-white/40 dark:hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
  </template>
  <template v-else-if="id === 'mode'">
    <svg v-if="playMode === 0" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
    <svg v-else-if="playMode === 1" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /><text x="12" y="16" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1</text></svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
  </template>
  <svg v-else-if="id === 'previous'" xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg>
  <svg v-else-if="id === 'pause'" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
  <svg v-else-if="id === 'play'" xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.3 5v14l11-7z" /></svg>
  <svg v-else-if="id === 'next'" xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
  <svg v-else-if="id === 'queue'" xmlns="http://www.w3.org/2000/svg" width="22" height="22" class="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
  <template v-else-if="id === 'volume'">
    <svg v-if="volume === 0" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
    <svg v-else-if="volume > 0 && volume < 30" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /></svg>
    <svg v-else-if="volume >= 30 && volume < 70" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
  </template>
  <span v-else-if="id === 'desktopLyrics'" class="shrink-0 text-[14px] font-bold" aria-hidden="true">词</span>
  <span v-else-if="id === 'lyricsStyle'" class="shrink-0 text-base font-semibold tracking-[0.02em]" aria-hidden="true">A</span>
  <template v-else-if="id === 'pin'">
    <svg v-if="pinned" xmlns="http://www.w3.org/2000/svg" width="16" height="16" class="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" class="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 2 20 20" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-.82" /><path d="M12 17v5" /><path d="M15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0-1.16.37" /></svg>
  </template>
  <template v-else-if="id === 'progress'">
    <EyeOff v-if="progressHidden" class="h-4 w-4 shrink-0" :stroke-width="2.2" aria-hidden="true" />
    <Eye v-else class="h-4 w-4 shrink-0" :stroke-width="2.2" aria-hidden="true" />
  </template>
  <AudioLines v-else-if="id === 'visualizer'" class="h-4 w-4 shrink-0" :stroke-width="2.2" aria-hidden="true" />
  <SlidersHorizontal v-else-if="id === 'equalizer'" class="h-4 w-4 shrink-0" :stroke-width="2.2" aria-hidden="true" />
  <Ellipsis v-else-if="id === 'more'" class="h-5 w-5 shrink-0" aria-hidden="true" />
</template>
