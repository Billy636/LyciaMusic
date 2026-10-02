<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { extractDominantColors } from '../../composables/colorExtraction';
import { createFlowFieldRenderer, type FlowFieldRenderer } from './flowFieldRenderer';

const props = withDefaults(defineProps<{
  coverSrc: string;
  paused?: boolean;
  dark?: boolean;
}>(), { paused: false, dark: false });

const FALLBACK_COLORS = ['hsl(0, 0%, 34%)', 'hsl(0, 0%, 52%)', 'hsl(0, 0%, 42%)', 'hsl(0, 0%, 62%)'];
const FRAME_INTERVAL = 1000 / 30;
const PALETTE_FADE_SECONDS = 1.4;
const gradientId = `flow-field-${useId()}`;
const canvasRef = ref<HTMLCanvasElement | null>(null);
const fallbackVisible = ref(true);
const fallbackColors = ref(FALLBACK_COLORS);
const prefersReducedMotion = ref(false);
const pageHidden = ref(document.hidden);
const motionPaused = computed(() => props.paused || pageHidden.value || prefersReducedMotion.value);

// The extractor returns HSL strings. Convert once per cover, without reading
// pixels back from the GPU or allocating color objects in the animation loop.
function toRgbPalette(colors: string[]): Float32Array {
  const values = new Float32Array(12);
  for (let index = 0; index < 4; index += 1) {
    const [hue, saturation, lightness] = (colors[index] || FALLBACK_COLORS[index])
      .match(/[\d.]+/g)!.map(Number);
    const light = lightness / 100;
    const amplitude = saturation / 100 * Math.min(light, 1 - light);
    [0, 8, 4].forEach((offset, channel) => {
      const k = (offset + hue / 30) % 12;
      values[index * 3 + channel] = light - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    });
  }
  return values;
}

let renderer: FlowFieldRenderer | null = null;
let resizeObserver: ResizeObserver | null = null;
let motionQuery: MediaQueryList | null = null;
let frameId: number | null = null;
let lastFrameTime: number | null = null;
let lastDrawTime = 0;
let activeTime = 0;
let paletteElapsed = PALETTE_FADE_SECONDS;
const currentPalette = toRgbPalette(FALLBACK_COLORS);
let previousPalette = new Float32Array(currentPalette);
let targetPalette = new Float32Array(currentPalette);
let paletteRequestId = 0;
let renderedCoverSrc: string | null = null;
let disposed = false;

function drawFrame() {
  if (!renderer || disposed || props.paused || pageHidden.value) return;
  renderer.render(activeTime, currentPalette, props.dark);
}

function stopAnimation() {
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
  lastFrameTime = null;
  lastDrawTime = 0;
}

function animate(timestamp: number) {
  frameId = null;
  if (!renderer || disposed || motionPaused.value) return;
  const elapsed = lastFrameTime === null ? 0 : Math.min((timestamp - lastFrameTime) / 1000, 0.1);
  lastFrameTime = timestamp;
  activeTime += elapsed;
  paletteElapsed = Math.min(PALETTE_FADE_SECONDS, paletteElapsed + elapsed);

  if (lastDrawTime === 0 || timestamp - lastDrawTime >= FRAME_INTERVAL) {
    const amount = paletteElapsed / PALETTE_FADE_SECONDS;
    const eased = amount * amount * (3 - 2 * amount);
    for (let index = 0; index < currentPalette.length; index += 1) {
      currentPalette[index] = previousPalette[index] + (targetPalette[index] - previousPalette[index]) * eased;
    }
    drawFrame();
    lastDrawTime = lastDrawTime === 0
      ? timestamp
      : timestamp - ((timestamp - lastDrawTime) % FRAME_INTERVAL);
  }
  frameId = requestAnimationFrame(animate);
}

function syncAnimation() {
  stopAnimation();
  if (motionPaused.value) {
    currentPalette.set(targetPalette);
    paletteElapsed = PALETTE_FADE_SECONDS;
    // Reduced-motion users still get a complete static color field; hidden windows
    // perform no draws. Neither case accumulates elapsed time in the background.
    drawFrame();
    return;
  }
  drawFrame();
  if (renderer && !disposed) frameId = requestAnimationFrame(animate);
}

function resizeCanvas() {
  const canvas = canvasRef.value;
  if (!canvas || !renderer || props.paused || pageHidden.value) return;
  renderer.resize(canvas.clientWidth, canvas.clientHeight);
  drawFrame();
}

function initializeRenderer() {
  if (!canvasRef.value || disposed) return;
  renderer = createFlowFieldRenderer(canvasRef.value);
  fallbackVisible.value = !renderer;
  resizeCanvas();
  syncAnimation();
}

watch([() => props.coverSrc, () => props.paused, pageHidden], async ([src, paused, hidden]) => {
  const requestId = ++paletteRequestId;
  if (paused || hidden || disposed || renderedCoverSrc === src) return;
  const colors = src
    ? await extractDominantColors(src, 4, { preserveSourceColors: true })
    : FALLBACK_COLORS;
  if (disposed || requestId !== paletteRequestId) return;
  const isFirstPalette = renderedCoverSrc === null;
  renderedCoverSrc = src;
  fallbackColors.value = colors;
  previousPalette = new Float32Array(currentPalette);
  targetPalette = toRgbPalette(colors);
  paletteElapsed = 0;
  if (motionPaused.value || isFirstPalette || !renderer) {
    currentPalette.set(targetPalette);
    paletteElapsed = PALETTE_FADE_SECONDS;
  }
  drawFrame();
}, { immediate: true });

watch([() => props.paused, pageHidden, prefersReducedMotion], () => {
  resizeCanvas();
  syncAnimation();
});
watch(() => props.dark, drawFrame);

const onMotionPreferenceChanged = (event: MediaQueryListEvent) => {
  prefersReducedMotion.value = event.matches;
};
const onVisibilityChanged = () => { pageHidden.value = document.hidden; };
const onContextLost = (event: Event) => {
  event.preventDefault();
  stopAnimation();
  // WebGL has already invalidated its resources. Keep the static SVG visible
  // until the browser restores the context, without a retry/polling loop.
  renderer = null;
  fallbackVisible.value = true;
};
const onContextRestored = () => { initializeRenderer(); };

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  prefersReducedMotion.value = motionQuery.matches;
  motionQuery.addEventListener('change', onMotionPreferenceChanged);
  document.addEventListener('visibilitychange', onVisibilityChanged);
  canvasRef.value?.addEventListener('webglcontextlost', onContextLost);
  canvasRef.value?.addEventListener('webglcontextrestored', onContextRestored);
  initializeRenderer();
  resizeObserver = new ResizeObserver(resizeCanvas);
  if (canvasRef.value) resizeObserver.observe(canvasRef.value);
});

onBeforeUnmount(() => {
  disposed = true;
  paletteRequestId += 1;
  stopAnimation();
  resizeObserver?.disconnect();
  motionQuery?.removeEventListener('change', onMotionPreferenceChanged);
  document.removeEventListener('visibilitychange', onVisibilityChanged);
  canvasRef.value?.removeEventListener('webglcontextlost', onContextLost);
  canvasRef.value?.removeEventListener('webglcontextrestored', onContextRestored);
  renderer?.dispose();
  renderer = null;
});
</script>

<template>
  <div class="flow-background" :class="{ 'flow-background--dark': dark }" aria-hidden="true">
    <!-- A filter-free static fallback also works when WebGL is unavailable. -->
    <svg v-if="fallbackVisible" class="flow-fallback" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0.1" x2="1" y2="0.9">
          <stop v-for="(color, index) in fallbackColors" :key="index" :offset="index / 3" :stop-color="color" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" :fill="`url(#${gradientId})`" />
      <path v-for="(color, index) in fallbackColors.slice(1)" :key="index"
        d="M 38 -10 C 102 10, 102 30, 48 50 S -6 90, 48 110 L 150 110 L 150 -10 Z"
        :transform="`translate(${(index - 1) * 28}, 0)`" :fill="color" opacity="0.3" />
    </svg>
    <canvas ref="canvasRef" class="flow-canvas" :class="{ 'flow-canvas--unavailable': fallbackVisible }"></canvas>
  </div>
</template>

<style scoped>
.flow-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: #f6f6f6;
}
.flow-background--dark { background: #090909; }
.flow-canvas, .flow-fallback { display: block; position: absolute; inset: 0; width: 100%; height: 100%; }
.flow-fallback { opacity: 0.38; }
.flow-background--dark .flow-fallback { opacity: 0.4; }
.flow-canvas--unavailable { visibility: hidden; }
</style>
