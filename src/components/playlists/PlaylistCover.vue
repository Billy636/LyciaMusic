<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Music2 } from 'lucide-vue-next';
import { useCoverCache } from '../../composables/useCoverCache';
import type { Playlist } from '../../types';

const props = defineProps<{ playlist: Playlist; compact?: boolean }>();
const { loadCover } = useCoverCache();
const element = ref<HTMLElement | null>(null);
const inView = ref(false);
const covers = ref<string[]>([]);
const paths = computed(() => [...new Set(props.playlist.songPaths.slice(0, 4))]);
const palette = computed(() => {
  let hash = 0;
  for (const character of props.playlist.id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 6;
});
let observer: IntersectionObserver | null = null;
let generation = 0;

watch([inView, paths], async ([visible, songPaths]) => {
  const request = ++generation;
  covers.value = [];
  if (!visible) return;
  const loaded = await Promise.all(songPaths.map(path => loadCover(path).catch(() => null)));
  if (request === generation) covers.value = [...new Set(loaded.filter((url): url is string => !!url))];
}, { immediate: true });

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') {
    inView.value = true;
    return;
  }
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      inView.value = true;
      observer?.disconnect();
    }
  }, { rootMargin: '160px' });
  if (element.value) observer.observe(element.value);
});

onBeforeUnmount(() => {
  generation += 1;
  observer?.disconnect();
});
</script>

<template>
  <div ref="element" class="playlist-cover" :class="[`palette-${palette}`, { compact }]" aria-hidden="true">
    <div v-if="covers.length >= 4" class="cover-mosaic">
      <img v-for="cover in covers.slice(0, 4)" :key="cover" :src="cover" alt="" loading="lazy" @error="covers = covers.filter(url => url !== cover)" />
    </div>
    <img v-else-if="covers.length" :src="covers[0]" class="cover-image" alt="" loading="lazy" @error="covers = covers.slice(1)" />
    <template v-else>
      <span v-if="!compact" class="cover-label">LYCIA / COLLECTION</span>
      <div class="record-sleeve"></div>
      <div class="record"><div class="record-center"><Music2 :size="compact ? 15 : 26" :stroke-width="1.5" /></div></div>
      <span v-if="!compact" class="cover-caption">{{ playlist.songPaths.length ? 'A collection of sounds' : 'Waiting for a melody' }}</span>
    </template>
  </div>
</template>

<style scoped>
.playlist-cover { --cover-bg: #e9d9d1; --cover-ink: #946555; position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--cover-bg); color: var(--cover-ink); isolation: isolate; }
.palette-1 { --cover-bg: #dbe4dd; --cover-ink: #668271; }
.palette-2 { --cover-bg: #dce2ed; --cover-ink: #687d9e; }
.palette-3 { --cover-bg: #e5deea; --cover-ink: #8c729e; }
.palette-4 { --cover-bg: #ede4cf; --cover-ink: #a48b51; }
.palette-5 { --cover-bg: #e8d9dd; --cover-ink: #a3697e; }
.cover-label { position: absolute; top: 10%; left: 10%; font-size: clamp(6px, .65vw, 9px); font-weight: 600; letter-spacing: .17em; opacity: .75; }
.record-sleeve { position: absolute; width: 49%; height: 58%; top: 25%; left: 16%; border: 1px solid currentColor; opacity: .3; transform: rotate(-10deg); border-radius: 3px; }
.record { position: absolute; width: 65%; aspect-ratio: 1; top: 23%; left: 28%; border-radius: 50%; background: repeating-radial-gradient(circle, transparent 0 5px, currentColor 6px, transparent 7px 10px); box-shadow: inset 0 0 0 1px currentColor; opacity: .8; display: flex; align-items: center; justify-content: center; transform: rotate(12deg); }
.record-center { width: 41%; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--cover-bg); border: 1px solid currentColor; }
.cover-caption { position: absolute; bottom: 8%; left: 10%; font-family: Georgia, serif; font-size: clamp(9px, .9vw, 13px); font-style: italic; opacity: .8; }
.cover-mosaic { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); height: 100%; }
.cover-mosaic img, .cover-image { width: 100%; height: 100%; min-height: 0; object-fit: cover; }
.compact .record { width: 78%; top: 20%; left: 28%; }
.compact .record-sleeve { width: 52%; height: 68%; top: 18%; left: 16%; }
</style>
