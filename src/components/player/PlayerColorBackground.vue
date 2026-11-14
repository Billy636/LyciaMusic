<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { extractCoverColorProfile } from '../../composables/colorExtraction';
import type { PlayerBackgroundMode, PlayerBackgroundPalette } from '../../types';
import { createPlayerBackgroundPalette, type PlayerBackgroundColors } from './playerBackgroundPalette';
import { createPlayerColorRenderer, type PlayerColorRenderer } from './playerColorRenderer';

const props = withDefaults(defineProps<{
  mode: Exclude<PlayerBackgroundMode, 'original'>;
  palette: PlayerBackgroundPalette;
  coverSrc?: string;
  coverPending?: boolean;
  motion?: boolean;
  suspended?: boolean;
  light?: boolean;
}>(), {
  coverSrc: '',
  coverPending: false,
  motion: true,
  suspended: false,
  light: false,
});

const emptyProfile = { colors: [] };
const colors = shallowRef(createPlayerBackgroundPalette(props.palette, emptyProfile, props.light));
const container = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const canvasReady = ref(false);
const pageHidden = ref(typeof document !== 'undefined' && document.hidden);
const reducedMotion = ref(false);
const renderingSuspended = computed(() => props.suspended || pageHidden.value);
const moving = computed(() => props.mode === 'soft' && props.motion && !reducedMotion.value);
const paletteStyle = computed(() => ({
  '--player-bg-base': colors.value.base,
  '--player-bg-end': colors.value.end,
  '--player-bg-left': colors.value.left,
  '--player-bg-glow': colors.value.glow,
  '--player-bg-accent': colors.value.accent,
  '--player-bg-quiet': colors.value.quiet,
}));
const coverToSample = computed(() => props.palette === 'cover' ? props.coverSrc : '');

watch([() => props.palette, coverToSample, () => props.coverPending, renderingSuspended, () => props.light], async ([palette, coverSrc, pending, suspended], _, onCleanup) => {
  let stale = false;
  onCleanup(() => { stale = true; });

  if (suspended) return;
  if (palette !== 'cover') {
    colors.value = createPlayerBackgroundPalette(palette, emptyProfile, props.light);
    return;
  }

  // Keep the displayed palette until the next song's thumbnail is ready.
  // A confirmed missing cover still returns to the neutral palette.
  if (!coverSrc && pending) return;
  const profile = coverSrc ? await extractCoverColorProfile(coverSrc) : emptyProfile;
  if (!stale) colors.value = createPlayerBackgroundPalette(palette, profile, props.light);
}, { immediate: true });

const colorKeys = ['base', 'end', 'left', 'glow', 'accent', 'quiet'] as const;
type ColorChannels = Record<typeof colorKeys[number], number[]>;
const PALETTE_DURATION_MS = 1100;
const FRAME_INTERVAL_MS = 1000 / 30;

// The palette generator supplies HSL. Interpolate RGB on one opaque surface
// instead of recreating full-window gradient layers during every song change.
function paletteChannels(palette: PlayerBackgroundColors): ColorChannels {
  const channels = {} as ColorChannels;
  for (const key of colorKeys) {
    const [h, s, l] = palette[key].match(/[\d.]+/g)!.map(Number);
    const lightness = l / 100;
    const amplitude = s / 100 * Math.min(lightness, 1 - lightness);
    channels[key] = [0, 8, 4].map(offset => {
      const sector = (offset + h / 30) % 12;
      return 255 * (lightness - amplitude * Math.max(-1, Math.min(sector - 3, 9 - sector, 1)));
    });
  }
  return channels;
}

const displayed = paletteChannels(colors.value);
let from = displayed;
let target = displayed;
let paletteStartedAt: number | null = null;
let renderer: PlayerColorRenderer | null = null;
let observer: ResizeObserver | null = null;
let motionQuery: MediaQueryList | null = null;
let frameId: number | null = null;
let lastPaintAt = 0;
let lastMotionAt: number | null = null;
let motionSeconds = 0;

function samplePalette(now: number): PlayerBackgroundColors {
  const progress = paletteStartedAt === null ? 1 : Math.min(1, (now - paletteStartedAt) / PALETTE_DURATION_MS);
  const eased = progress * progress * (3 - 2 * progress);
  const sampled = { key: colors.value.key } as PlayerBackgroundColors;
  for (const key of colorKeys) {
    displayed[key] = target[key].map((channel, index) => from[key][index] + (channel - from[key][index]) * eased);
    sampled[key] = `rgb(${displayed[key].map(channel => channel.toFixed(2)).join(', ')})`;
  }
  if (progress === 1) paletteStartedAt = null;
  return sampled;
}

function draw(now: number) {
  if (!renderer) return;
  if (moving.value && !renderingSuspended.value && lastMotionAt !== null) {
    motionSeconds += Math.min(100, now - lastMotionAt) / 1000;
  }
  lastMotionAt = now;
  renderer.render(samplePalette(now), props.mode, motionSeconds);
  lastPaintAt = now;
  canvasReady.value = true;
}

function scheduleFrame() {
  if (frameId !== null || !renderer || renderingSuspended.value || (!moving.value && paletteStartedAt === null)) return;
  frameId = requestAnimationFrame(onFrame);
}

function onFrame(now: number) {
  frameId = null;
  if (renderingSuspended.value) return;
  if (now - lastPaintAt >= FRAME_INTERVAL_MS) draw(now);
  scheduleFrame();
}

function stopFrames() {
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
  lastMotionAt = null;
}

watch(colors, (palette, previous) => {
  if (palette.key === previous.key) return;
  const now = performance.now();
  samplePalette(now);
  from = Object.fromEntries(colorKeys.map(key => [key, [...displayed[key]]])) as ColorChannels;
  target = paletteChannels(palette);
  paletteStartedAt = reducedMotion.value || !renderer ? null : now;
  draw(now);
  scheduleFrame();
});

watch([renderingSuspended, moving, reducedMotion, () => props.mode], () => {
  stopFrames();
  if (renderingSuspended.value) return;
  if (reducedMotion.value) paletteStartedAt = null;
  draw(performance.now());
  scheduleFrame();
});

const onVisibilityChanged = () => { pageHidden.value = document.hidden; };
const onMotionPreferenceChanged = (event: MediaQueryListEvent) => { reducedMotion.value = event.matches; };

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.value = motionQuery.matches;
  motionQuery.addEventListener('change', onMotionPreferenceChanged);
  document.addEventListener('visibilitychange', onVisibilityChanged);
  if (!canvas.value || !container.value) return;
  renderer = createPlayerColorRenderer(canvas.value);
  const resize = () => {
    const bounds = container.value?.getBoundingClientRect();
    if (!renderer || !bounds || bounds.width <= 0 || bounds.height <= 0) return;
    // Resize clears a canvas. Repaint before the browser presents the frame.
    renderer.resize(bounds.width, bounds.height);
    draw(performance.now());
    scheduleFrame();
  };
  observer = new ResizeObserver(resize);
  observer.observe(container.value);
  resize();
});

onBeforeUnmount(() => {
  stopFrames();
  observer?.disconnect();
  renderer?.dispose();
  renderer = null;
  motionQuery?.removeEventListener('change', onMotionPreferenceChanged);
  document.removeEventListener('visibilitychange', onVisibilityChanged);
});
</script>

<template>
  <div
    ref="container"
    class="player-color-background"
    :style="paletteStyle"
    aria-hidden="true"
  >
    <canvas ref="canvas" v-show="canvasReady" class="player-color-canvas"></canvas>
    <div v-show="!canvasReady" class="player-color-layer" :class="mode">
      <div class="player-color-foundation"></div>
      <div class="player-color-field player-color-cover"></div>
      <div class="player-color-field player-color-halo"></div>
      <div class="player-color-field player-color-accent"></div>
      <div class="player-color-field player-color-quiet"></div>
    </div>
    <div class="player-color-texture"></div>
  </div>
</template>

<style scoped>
.player-color-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  background: var(--player-bg-base);
}
.player-color-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.player-color-layer { position: absolute; inset: 0; overflow: hidden; }
.player-color-foundation {
  position: absolute;
  inset: 0;
  background: linear-gradient(116deg, var(--player-bg-base) 0%, var(--player-bg-base) 30%, var(--player-bg-end) 100%);
}
.player-color-field { position: absolute; inset: -10%; background-repeat: no-repeat; }
.player-color-cover { background: radial-gradient(ellipse 53% 75% at 24% 44%, var(--player-bg-left), transparent 76%); }
.player-color-halo { background: radial-gradient(ellipse 35% 45% at 9% 11%, var(--player-bg-glow), transparent 80%); }
.player-color-accent { background: radial-gradient(ellipse 60% 60% at 44% 109%, var(--player-bg-accent), transparent 78%); }
.player-color-quiet { background: radial-gradient(ellipse 42% 58% at 94% 33%, var(--player-bg-quiet), transparent 85%); }
.player-color-texture {
  position: absolute;
  inset: 0;
  opacity: .035;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' opacity='.65' filter='url(%23n)'/%3E%3C/svg%3E");
}
.gradient .player-color-cover { background: linear-gradient(128deg, var(--player-bg-left) -45%, transparent 55%); }
.gradient .player-color-halo,
.gradient .player-color-accent,
.gradient .player-color-quiet { display: none; }
</style>
