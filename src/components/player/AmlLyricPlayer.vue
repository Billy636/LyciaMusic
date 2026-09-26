<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DomLyricPlayer, type LyricLine, type LyricLineMouseEvent } from '@applemusic-like-lyrics/core';

import { clampPlayerLineGap } from '../../composables/lyrics/constants';
import { AmlLyricPlayerRuntime } from './amlLyricPlayerRuntime';

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
});

const emit = defineEmits<{
  (e: 'line-click', event: LyricLineMouseEvent): void;
}>();

const wrapperRef = ref<HTMLDivElement | null>(null);
const wrapperStyle = computed(() => props.lineGap === undefined
  ? undefined
  : { '--lyrics-line-gap': String(clampPlayerLineGap(props.lineGap)) });
let player: DomLyricPlayer | null = null;
let runtime: AmlLyricPlayerRuntime | null = null;
let fontRefreshRevision = 0;

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
  if (!wrapper) return;

  player = new DomLyricPlayer();
  const element = player.getElement();
  element.style.width = '100%';
  element.style.height = '100%';
  wrapper.appendChild(element);
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
  <div ref="wrapperRef" class="w-full h-full min-h-0 min-w-0" :style="wrapperStyle" />
</template>
