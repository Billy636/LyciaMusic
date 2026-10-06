<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DomLyricPlayer, type LyricLine, type LyricLineMouseEvent } from '@applemusic-like-lyrics/core';

import { clampPlayerLineGap } from '../../composables/lyrics/constants';
import { AmlLyricPlayerRuntime } from './amlLyricPlayerRuntime';
import { VerticalAmlLyricPlayer } from './verticalAmlLyricPlayer';

const props = withDefaults(defineProps<{
  disabled?: boolean;
  lowPower?: boolean;
  playing?: boolean;
  alignAnchor?: 'top' | 'bottom' | 'center';
  alignPosition?: number;
  enableSpring?: boolean;
  enableBlur?: boolean;
  enableScale?: boolean;
  hidePassedLines?: boolean;
  lyricLines?: LyricLine[];
  currentTime?: number;
  timeSyncKey?: string | number;
  seekKey?: string | number;
  wordFadeWidth?: number;
  fontScale?: number;
  lineGap?: number;
  layoutVersion?: string | number;
  writingMode?: 'horizontal' | 'vertical';
  verticalScrollDirection?: 'left' | 'right';
}>(), {
  disabled: false,
  lowPower: false,
  playing: true,
  alignAnchor: 'center',
  alignPosition: 0.5,
  enableSpring: true,
  enableBlur: true,
  enableScale: true,
  hidePassedLines: false,
  lyricLines: () => [],
  currentTime: 0,
  timeSyncKey: '',
  seekKey: '',
  wordFadeWidth: 0.5,
  layoutVersion: 0,
  writingMode: 'horizontal',
  verticalScrollDirection: 'left',
});

const emit = defineEmits<{
  (e: 'line-click', event: LyricLineMouseEvent): void;
}>();

const wrapperRef = ref<HTMLDivElement | null>(null);
const coordinateStageRef = ref<HTMLDivElement | null>(null);
const isVerticalWriting = computed(() => props.writingMode === 'vertical');
const isLeftwardVertical = computed(() => isVerticalWriting.value && props.verticalScrollDirection === 'left');
const wrapperStyle = computed(() => props.lineGap === undefined
  ? undefined
  : { '--lyrics-line-gap': String(clampPlayerLineGap(props.lineGap)) });
let player: DomLyricPlayer | null = null;
let runtime: AmlLyricPlayerRuntime | null = null;
let fontRefreshRevision = 0;
let sizeObserver: ResizeObserver | null = null;
let sizeFrame = 0;

function syncCoordinateSize() {
  const wrapper = wrapperRef.value;
  const stage = coordinateStageRef.value;
  if (!wrapper || !stage || !isVerticalWriting.value) return;
  stage.style.width = `${wrapper.clientHeight}px`;
  stage.style.height = `${wrapper.clientWidth}px`;
}

function handleHorizontalWheel(event: WheelEvent) {
  if (!isVerticalWriting.value || !player || event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
  event.preventDefault();
  event.stopPropagation();
  player.getElement().dispatchEvent(new WheelEvent('wheel', {
    deltaY: isLeftwardVertical.value ? event.deltaX : -event.deltaX,
    deltaMode: event.deltaMode,
    bubbles: false,
    cancelable: true,
  }));
}

function applyPlayerProps() {
  if (!player) return;
  player.setAlignAnchor(props.alignAnchor);
  player.setAlignPosition(props.alignPosition);
  player.setEnableSpring(props.enableSpring);
  player.setEnableBlur(props.enableBlur);
  player.setEnableScale(props.enableScale);
  player.setHidePassedLines(props.hidePassedLines);
  player.setWordFadeWidth(props.wordFadeWidth);
}

function handleLineClick(event: Event) {
  // Preserve the public line object, including parser-provided source timing.
  emit('line-click', event as LyricLineMouseEvent);
}

function syncSeekLayout(timeMs: number, _lineIndex?: number) {
  // Kept source-compatible with callers from the old wrapper. AMLL's optimized
  // groups own their indexes; the original media time is the stable seek target.
  runtime?.seek(timeMs);
}

async function refreshAfterFontsReady() {
  const revision = ++fontRefreshRevision;
  await nextTick();
  await document.fonts?.ready;
  if (revision === fontRefreshRevision) runtime?.refreshLayout();
}

defineExpose({ syncSeekLayout });

onMounted(() => {
  const wrapper = wrapperRef.value;
  const stage = coordinateStageRef.value;
  if (!wrapper || !stage) return;

  syncCoordinateSize();
  player = isVerticalWriting.value ? new VerticalAmlLyricPlayer(stage) : new DomLyricPlayer();
  const element = player.getElement();
  element.style.width = '100%';
  element.style.height = '100%';
  stage.appendChild(element);
  if (isVerticalWriting.value) {
    sizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(sizeFrame);
      sizeFrame = requestAnimationFrame(syncCoordinateSize);
    });
    sizeObserver.observe(wrapper);
    wrapper.addEventListener('wheel', handleHorizontalWheel, { capture: true, passive: false });
  }
  player.addEventListener('line-click', handleLineClick);
  applyPlayerProps();

  runtime = new AmlLyricPlayerRuntime(player, {
    currentTime: props.currentTime,
    playing: props.playing,
    disabled: props.disabled,
    lowPower: props.lowPower,
  });
  runtime.setLyricLines(props.lyricLines, props.currentTime);
  runtime.start();
  if (document.fonts?.status === 'loading') void refreshAfterFontsReady();
});

onBeforeUnmount(() => {
  fontRefreshRevision += 1;
  cancelAnimationFrame(sizeFrame);
  sizeObserver?.disconnect();
  wrapperRef.value?.removeEventListener('wheel', handleHorizontalWheel, { capture: true });
  player?.removeEventListener('line-click', handleLineClick);
  runtime?.dispose();
  runtime = null;
  player = null;
});

watch(() => [props.disabled, props.lowPower] as const, ([disabled, lowPower]) => {
  runtime?.setRenderingState({ disabled, lowPower }, props.currentTime);
});

watch(() => props.playing, (playing) => {
  runtime?.setPlaying(playing, props.currentTime);
});

watch(() => [
  props.alignAnchor,
  props.alignPosition,
  props.enableSpring,
  props.enableBlur,
  props.enableScale,
  props.hidePassedLines,
  props.wordFadeWidth,
], applyPlayerProps);

watch(() => props.lyricLines, (lines) => {
  runtime?.setLyricLines(lines, props.currentTime);
});

watch(() => [props.currentTime, props.timeSyncKey, props.seekKey] as const, (
  [timeMs, syncKey, seekKey],
  [, previousSyncKey, previousSeekKey],
) => {
  if (seekKey !== previousSeekKey) runtime?.seek(timeMs);
  else runtime?.syncCurrentTime(timeMs, syncKey !== previousSyncKey);
});

// AMLL observes normal container/line size changes itself. Font replacement is
// the only explicit reconstruction here; no internal layout or recovery loop.
watch(() => props.layoutVersion, () => { void refreshAfterFontsReady(); });
// The font-size CSS variable lives on the parent view. Refresh the official
// metrics after Vue has applied that style, without reconstructing lyric rows.
watch(() => props.fontScale, () => { runtime?.refreshMeasurements(); }, { flush: 'post' });
</script>

<template>
  <div
    ref="wrapperRef"
    class="amll-coordinate-host relative w-full h-full min-h-0 min-w-0"
    :class="{
      'amll-coordinate-host--vertical': isVerticalWriting,
      'amll-coordinate-host--leftward': isLeftwardVertical,
    }"
    :style="wrapperStyle"
  >
    <div ref="coordinateStageRef" class="amll-coordinate-stage h-full w-full" />
  </div>
</template>

<style scoped>
.amll-coordinate-host--vertical > .amll-coordinate-stage {
  position: absolute;
  top: 0;
  left: 100%;
  transform: rotate(90deg);
  transform-origin: 0 0;
}

.amll-coordinate-host--leftward > .amll-coordinate-stage {
  left: 0;
  /* Original X still points down; original Y now points right. */
  transform: matrix(0, 1, 1, 0, 0, 0);
}

.amll-coordinate-host--vertical :deep(.amll-lyric-player [class*="_lyricLine"]:not([class*="_lyricLineWrapper"])) {
  content-visibility: visible;
}

.amll-coordinate-host--vertical :deep(.amll-vertical-glyph) {
  display: inline-block;
  box-sizing: content-box;
  position: relative;
  width: 1em;
  height: 1em;
  margin: 0;
  padding: 0;
  line-height: 1em;
  vertical-align: middle;
  contain: none;
  text-align: center;
  transform: rotate(-90deg);
}

.amll-coordinate-host--vertical :deep(.amll-vertical-sideways) {
  display: inline-block;
  max-width: 100%;
  margin: 0;
  padding: 0;
  vertical-align: baseline;
  white-space: pre-wrap;
  contain: none;
}

.amll-coordinate-host--leftward :deep(.amll-vertical-glyph) {
  transform: matrix(0, 1, 1, 0, 0, 0);
}

.amll-coordinate-host--leftward :deep(.amll-vertical-sideways) {
  transform: scaleY(-1);
}
</style>
