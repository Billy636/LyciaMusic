<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  samplePlayerCoverBackground,
  selectPlayerForeground,
  selectPlayerChromeForeground,
  type PlayerBackgroundSample,
  type PlayerForeground,
  type BackgroundRegion,
} from './playerBackgroundReadability';

const props = defineProps<{
  coverSrc: string;
  active: boolean;
  enabled?: boolean;
  lyricsElement?: HTMLElement | null;
  layoutKey?: string;
  largeViewport?: boolean;
}>();
const emit = defineEmits<{ (event: 'foreground-change', foreground: PlayerForeground): void }>();
const surface = ref<HTMLElement | null>(null);
let backgroundSample: PlayerBackgroundSample | null = null;
let chromeForeground: PlayerForeground = 'light';
let lyricForeground: PlayerForeground | undefined;
let generation = 0;
let disposed = false;
let analysisTimer: ReturnType<typeof setTimeout> | undefined;
let entryTimer: ReturnType<typeof setTimeout> | undefined;
let resizeObserver: ResizeObserver | null = null;
let sampleKey = '';
let paintedRoot: HTMLElement | null = null;
const foregroundProperties = [
  '--player-lyrics-rgb',
  '--player-lyrics-inactive-alpha',
  '--player-lyrics-subline-alpha',
  '--player-lyrics-active-subline-alpha',
  '--player-lyrics-amll-subline-alpha',
];

function clearForeground(element: HTMLElement) {
  delete element.dataset.playerForeground;
  for (const property of foregroundProperties) element.style.removeProperty(property);
}

function clearRowOverrides(root: HTMLElement) {
  // Clear overrides left by the previous per-line preview after a hot reload.
  for (const row of root.querySelectorAll<HTMLElement>('[data-player-foreground]')) {
    clearForeground(row);
  }
}

function setLyricsRoot(root: HTMLElement | null) {
  if (paintedRoot && paintedRoot !== root) {
    clearRowOverrides(paintedRoot);
    clearForeground(paintedRoot);
  }
  paintedRoot = root;
  if (root) clearRowOverrides(root);
}

function setChromeForeground(foreground: PlayerForeground) {
  if (foreground === chromeForeground) return;
  chromeForeground = foreground;
  emit('foreground-change', foreground);
}

function resetForeground() {
  setLyricsRoot(props.lyricsElement ?? null);
  if (paintedRoot) clearForeground(paintedRoot);
  lyricForeground = undefined;
  setChromeForeground('light');
}

function paintForeground(element: HTMLElement, foreground: PlayerForeground) {
  element.dataset.playerForeground = foreground;
  element.style.setProperty('--player-lyrics-rgb', foreground === 'dark' ? '12 16 23' : '255 255 255');
  element.style.setProperty('--player-lyrics-inactive-alpha', foreground === 'dark' ? '0.8' : '0.64');
  element.style.setProperty('--player-lyrics-subline-alpha', foreground === 'dark' ? '0.9' : '0.62');
  element.style.setProperty('--player-lyrics-active-subline-alpha', foreground === 'dark' ? '0.92' : '0.82');
  element.style.setProperty('--player-lyrics-amll-subline-alpha', foreground === 'dark' ? '0.92' : '0.72');
}

function localRegion(element: HTMLElement, host: DOMRect): BackgroundRegion | null {
  const bounds = element.getBoundingClientRect();
  const left = Math.max(host.left, bounds.left);
  const top = Math.max(host.top, bounds.top);
  const right = Math.min(host.right, bounds.right);
  const bottom = Math.min(host.bottom, bounds.bottom);
  return right > left && bottom > top
    ? { x: left - host.left, y: top - host.top, width: right - left, height: bottom - top } : null;
}

function updateForegrounds() {
  if (!props.active || props.enabled === false || disposed || !surface.value) return;
  const host = surface.value.getBoundingClientRect();
  setLyricsRoot(props.lyricsElement ?? null);
  const regionElement = paintedRoot?.querySelector<HTMLElement>('[data-player-lyrics-viewport]') ?? paintedRoot;
  const region = regionElement ? localRegion(regionElement, host) : null;
  // The decision covers the entire lyric column, independent of scrolling
  // text. Use the right half while that column is temporarily unmounted.
  const lyricRegion = region ?? { x: host.width / 2, y: 0, width: host.width / 2, height: host.height };
  lyricForeground = backgroundSample
    ? selectPlayerForeground(backgroundSample, lyricRegion, lyricForeground)
    : props.coverSrc ? lyricForeground ?? 'light' : 'light';
  if (paintedRoot) paintForeground(paintedRoot, lyricForeground);
  setChromeForeground(backgroundSample
    ? selectPlayerChromeForeground(backgroundSample, chromeForeground)
    : props.coverSrc ? chromeForeground : 'light');
}

function canAnalyze() {
  return props.active && props.enabled !== false && !disposed;
}

async function updateBackgroundSample() {
  const request = ++generation;
  if (!canAnalyze() || !surface.value) return;
  await nextTick();
  if (request !== generation || !canAnalyze() || !surface.value) return;
  const bounds = surface.value.getBoundingClientRect();
  const key = JSON.stringify([props.coverSrc, bounds.width, bounds.height, props.largeViewport]);
  if (key !== sampleKey) {
    const sample = props.coverSrc
      ? await samplePlayerCoverBackground(props.coverSrc, { width: bounds.width, height: bounds.height }, props.largeViewport ?? false)
      : null;
    if (request !== generation || !canAnalyze()) return;
    backgroundSample = sample;
    sampleKey = key;
  }
  updateForegrounds();
}

function scheduleAnalysis(delay = 60) {
  generation += 1;
  clearTimeout(analysisTimer);
  if (disposed) return;
  if (props.enabled === false) {
    resetForeground();
    return;
  }
  if (!props.active) return;
  analysisTimer = setTimeout(() => { void updateBackgroundSample(); }, delay);
}
function observe() {
  resizeObserver?.disconnect();
  clearTimeout(entryTimer);
  setLyricsRoot(props.lyricsElement ?? null);
  if (!props.active || props.enabled === false) {
    scheduleAnalysis();
    return;
  }
  if (surface.value) resizeObserver?.observe(surface.value);
  if (props.lyricsElement) resizeObserver?.observe(props.lyricsElement);
  scheduleAnalysis();
  // PlayerDetail's entry transforms finish after 600ms and do not trigger a
  // ResizeObserver. Recheck the settled column once, without polling playback.
  entryTimer = setTimeout(() => scheduleAnalysis(0), 750);
}
// Change text polarity around the midpoint of the existing background fade.
watch(() => props.coverSrc, () => scheduleAnalysis(320));
watch(() => props.largeViewport, () => scheduleAnalysis());
watch([() => props.active, () => props.enabled, () => props.lyricsElement], async () => {
  await nextTick();
  if (!disposed) observe();
}, { flush: 'post' });
watch(() => props.layoutKey, () => scheduleAnalysis(250), { flush: 'post' });
onMounted(() => {
  resizeObserver = new ResizeObserver(() => scheduleAnalysis());
  emit('foreground-change', chromeForeground);
  observe();
});
onBeforeUnmount(() => {
  disposed = true;
  generation += 1;
  clearTimeout(analysisTimer);
  clearTimeout(entryTimer);
  resizeObserver?.disconnect();
  setLyricsRoot(null);
});
</script>

<template>
  <div ref="surface" class="player-foreground-surface" aria-hidden="true"></div>
</template>

<style scoped>
.player-foreground-surface { position: absolute; inset: 0; pointer-events: none; }
</style>
