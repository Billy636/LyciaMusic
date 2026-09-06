<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { playbackApi } from '../../services/tauri/playbackApi';
import { useRenderingPower } from '../../composables/renderingPower';
import { smoothVisualizerLevel } from './audioVisualizerMath';

const props = defineProps<{
  active: boolean;
  isPlaying: boolean;
  songPath: string;
}>();

const BAR_COUNT = 48;
const DISPLAY_BAR_COUNT = 112;
const VISUALIZER_TARGET_FPS = 30;
const FETCH_INTERVAL_MS = Math.round(1000 / VISUALIZER_TARGET_FPS);
const DRAW_INTERVAL_MS = 1000 / VISUALIZER_TARGET_FPS;
const MIN_BAR_HEIGHT = 3;
const GRADIENT_ALPHA_STEPS = 32;
const MAX_GRADIENT_CACHE_SIZE = 256;
const { isMainWindowLowPower } = useRenderingPower();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const levels = new Float32Array(BAR_COUNT);
const renderedLevels = new Float32Array(DISPLAY_BAR_COUNT);
const gradientCache = new Map<string, CanvasGradient>();

let animationFrameId: number | null = null;
let fetchTimerId: ReturnType<typeof setInterval> | null = null;
let resizeObserver: ResizeObserver | null = null;
let lastDrawTimestamp = Number.NEGATIVE_INFINITY;
let fetchInFlight = false;
let backendVisualizerEnabled = false;
let backendVisualizerSync = Promise.resolve();

const stopFetchTimer = () => {
  if (fetchTimerId !== null) {
    clearInterval(fetchTimerId);
    fetchTimerId = null;
  }
};

const resizeCanvas = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    gradientCache.clear();
  }
};

const getDisplayLevel = (index: number) => {
  const sourcePosition = (index / Math.max(1, DISPLAY_BAR_COUNT - 1)) * (BAR_COUNT - 1);
  const leftIndex = Math.floor(sourcePosition);
  const rightIndex = Math.min(BAR_COUNT - 1, leftIndex + 1);
  const mix = sourcePosition - leftIndex;
  const left = levels[leftIndex] ?? 0;
  const right = levels[rightIndex] ?? left;

  return left + (right - left) * mix;
};

const shouldAnimate = () =>
  props.active && !isMainWindowLowPower.value && (
    props.isPlaying
    || renderedLevels.some(level => level > 0.012)
  );

const shouldFetchSamples = () => props.active && props.isPlaying && !isMainWindowLowPower.value;

const getBarGradient = (
  context: CanvasRenderingContext2D,
  baselineY: number,
  barHeight: number,
  alpha: number,
) => {
  const heightBucket = Math.max(1, Math.round(barHeight));
  const alphaBucket = Math.max(0, Math.min(
    GRADIENT_ALPHA_STEPS,
    Math.round(alpha * GRADIENT_ALPHA_STEPS),
  ));
  const key = `${heightBucket}:${alphaBucket}`;
  const cached = gradientCache.get(key);
  if (cached) {
    return cached;
  }

  const quantizedAlpha = alphaBucket / GRADIENT_ALPHA_STEPS;
  const gradient = context.createLinearGradient(0, baselineY - heightBucket, 0, baselineY);
  gradient.addColorStop(0, `rgba(184, 219, 236, ${quantizedAlpha * 0.86})`);
  gradient.addColorStop(0.45, `rgba(137, 183, 207, ${quantizedAlpha})`);
  gradient.addColorStop(1, `rgba(95, 145, 174, ${quantizedAlpha * 0.72})`);

  if (gradientCache.size >= MAX_GRADIENT_CACHE_SIZE) {
    const oldestKey = gradientCache.keys().next().value;
    if (oldestKey !== undefined) {
      gradientCache.delete(oldestKey);
    }
  }
  gradientCache.set(key, gradient);
  return gradient;
};

const draw = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const context = canvas.getContext('2d');
  if (!context) return;

  const width = canvas.width;
  const height = canvas.height;
  const pixelRatio = window.devicePixelRatio || 1;
  const baselineY = height - 2 * pixelRatio;
  const barWidth = Math.max(1.2 * pixelRatio, Math.min(2.4 * pixelRatio, width / (DISPLAY_BAR_COUNT * 3.5)));
  const gap = Math.max(3.5 * pixelRatio, (width - barWidth * DISPLAY_BAR_COUNT) / (DISPLAY_BAR_COUNT - 1));
  const visualizerWidth = barWidth * DISPLAY_BAR_COUNT + gap * (DISPLAY_BAR_COUNT - 1);
  const startX = (width - visualizerWidth) / 2;

  context.clearRect(0, 0, width, height);
  context.save();
  context.shadowBlur = 7 * pixelRatio;
  context.shadowColor = 'rgba(151, 191, 211, 0.36)';

  for (let index = 0; index < DISPLAY_BAR_COUNT; index += 1) {
    const rawValue = Math.max(0, getDisplayLevel(index));
    const bandPosition = index / Math.max(1, DISPLAY_BAR_COUNT - 1);
    const previousRendered = renderedLevels[index] ?? 0;
    const lowFrequencyWeight = 1.12 - bandPosition * 0.28;
    const targetValue = props.isPlaying
      ? Math.min(1, Math.pow(rawValue, 0.72) * lowFrequencyWeight)
      : 0;
    const value = smoothVisualizerLevel(previousRendered, targetValue);

    renderedLevels[index] = value;

    const edgeDistance = Math.abs(index - (DISPLAY_BAR_COUNT - 1) / 2) / (DISPLAY_BAR_COUNT / 2);
    const edgeFade = 1 - Math.pow(edgeDistance, 2) * 0.16;
    const barHeight = Math.max(
      MIN_BAR_HEIGHT * pixelRatio,
      value * height * 0.88 * edgeFade,
    );
    const x = startX + index * (barWidth + gap);
    const y = baselineY - barHeight;
    const radius = Math.min(barWidth / 2, 2 * pixelRatio);
    const alpha = props.isPlaying ? 0.36 + value * 0.42 : 0.2;
    context.fillStyle = getBarGradient(context, baselineY, barHeight, alpha);
    context.beginPath();
    context.roundRect(x, y, barWidth, barHeight, radius);
    context.fill();
  }

  context.restore();

  if (shouldAnimate()) {
    scheduleDraw();
  }
};

const scheduleDraw = () => {
  if (animationFrameId !== null) return;

  animationFrameId = requestAnimationFrame((timestamp) => {
    animationFrameId = null;
    if (timestamp - lastDrawTimestamp < DRAW_INTERVAL_MS - 1) {
      if (shouldAnimate()) {
        scheduleDraw();
      }
      return;
    }
    lastDrawTimestamp = timestamp;
    draw();
  });
};

const fetchSamples = async () => {
  if (!shouldFetchSamples() || fetchInFlight) return;

  fetchInFlight = true;
  try {
    const nextLevels = await playbackApi.getAudioVisualizerSamples();
    if (nextLevels.length > 0) {
      const length = Math.min(BAR_COUNT, nextLevels.length);
      for (let index = 0; index < length; index += 1) {
        levels[index] = nextLevels[index] ?? 0;
      }
      if (length < BAR_COUNT) {
        levels.fill(0, length);
      }
      scheduleDraw();
    }
  } catch {
  } finally {
    fetchInFlight = false;
  }
};

const syncBackendVisualizer = () => {
  const enabled = shouldFetchSamples();
  if (backendVisualizerEnabled === enabled) {
    return;
  }
  backendVisualizerEnabled = enabled;
  backendVisualizerSync = backendVisualizerSync
    .then(() => playbackApi.setAudioVisualizerEnabled(enabled))
    .catch(() => {});
};

const syncFetchTimer = () => {
  stopFetchTimer();
  syncBackendVisualizer();
  if (!shouldFetchSamples()) {
    scheduleDraw();
    return;
  }

  void fetchSamples();
  fetchTimerId = setInterval(() => {
    void fetchSamples();
  }, FETCH_INTERVAL_MS);
};

watch(() => [props.active, props.isPlaying, isMainWindowLowPower.value] as const, syncFetchTimer);

watch(() => props.songPath, () => {
  levels.fill(0);
  renderedLevels.fill(0);
  scheduleDraw();
  syncFetchTimer();
});

onMounted(() => {
  const canvas = canvasRef.value;
  if (canvas) {
    resizeCanvas();
    resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      scheduleDraw();
    });
    resizeObserver.observe(canvas);
  }

  void nextTick(() => {
    scheduleDraw();
    syncFetchTimer();
  });
});

onBeforeUnmount(() => {
  stopFetchTimer();
  if (backendVisualizerEnabled) {
    backendVisualizerEnabled = false;
    backendVisualizerSync = backendVisualizerSync
      .then(() => playbackApi.setAudioVisualizerEnabled(false))
      .catch(() => {});
  }
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
  }
  resizeObserver?.disconnect();
});
</script>

<template>
  <canvas
    ref="canvasRef"
    class="audio-visualizer"
    aria-hidden="true"
  ></canvas>
</template>

<style scoped>
.audio-visualizer {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
