<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { LyricLine as AmlLyricLine, LyricLineMouseEvent } from '@applemusic-like-lyrics/core';
import { PatchedLyricPlayer } from '../../lib/amll/PatchedLyricPlayer';
import { syncAmlLyricSeekLayout } from './amllSeekLayout';

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
  lyricLines?: AmlLyricLine[];
  currentTime?: number;
  wordFadeWidth?: number;
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
  wordFadeWidth: 0.5,
  lineGap: 1,
  layoutVersion: 0,
});

const emit = defineEmits<{
  (e: 'line-click', event: LyricLineMouseEvent): void;
}>();

const wrapperRef = ref<HTMLDivElement | null>(null);

let player: PatchedLyricPlayer | null = null;
let resizeObserver: ResizeObserver | null = null;
let frameId = 0;
let recoveryFrameId = 0;
let queueRecoveryMaxAttempts = 0;
let queueRecoveryAttempts = 0;
let queueRecoveryReason = '';
let pendingLowPowerRecoveryReason = '';

function stopAnimationLoop() {
  if (frameId !== 0) {
    cancelAnimationFrame(frameId);
    frameId = 0;
  }
}

function startAnimationLoop() {
  stopAnimationLoop();

  if (props.disabled || props.lowPower) {
    return;
  }

  let lastTime = -1;
  const onFrame = (time: number) => {
    if (!player || props.disabled || props.lowPower) {
      frameId = 0;
      return;
    }

    if (lastTime === -1) {
      lastTime = time;
    }

    player.update(time - lastTime);
    lastTime = time;
    frameId = requestAnimationFrame(onFrame);
  };

  frameId = requestAnimationFrame(onFrame);
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
  player.setLineGap(props.lineGap);
  player.setPlaybackPaused(!props.playing);
}

function attachPlayer(nextPlayer: PatchedLyricPlayer) {
  const wrapper = wrapperRef.value;
  if (!wrapper) return;

  const playerElement = nextPlayer.getElement();
  playerElement.style.width = '100%';
  playerElement.style.height = '100%';
  wrapper.appendChild(playerElement);
  nextPlayer.addEventListener('line-click', handleLineClick as EventListener);
  player = nextPlayer;
  applyPlayerProps();
  player.setLyricLines(props.lyricLines, Math.trunc(props.currentTime));
  player.setCurrentTime(Math.trunc(props.currentTime));
}

function detachPlayer() {
  if (!player) return;

  player.removeEventListener('line-click', handleLineClick as EventListener);
  player.dispose();
  player = null;
}

function queueRecovery(reason: string, options: { maxAttempts?: number } = {}) {
  if (!player) return;

  if (props.lowPower) {
    pendingLowPowerRecoveryReason = reason;
    return;
  }

  const maxAttempts = options.maxAttempts ?? 12;
  queueRecoveryReason = reason;
  queueRecoveryMaxAttempts = Math.max(queueRecoveryMaxAttempts, maxAttempts);

  if (recoveryFrameId !== 0) return;

  queueRecoveryAttempts = 0;
  const runRecovery = () => {
    if (!player) {
      recoveryFrameId = 0;
      queueRecoveryMaxAttempts = 0;
      queueRecoveryAttempts = 0;
      return;
    }

    player.recoverLayout(`${queueRecoveryReason}:${queueRecoveryAttempts}`);
    if (queueRecoveryAttempts < queueRecoveryMaxAttempts) {
      queueRecoveryAttempts += 1;
      recoveryFrameId = requestAnimationFrame(runRecovery);
    } else {
      recoveryFrameId = 0;
      queueRecoveryMaxAttempts = 0;
      queueRecoveryAttempts = 0;
    }
  };

  recoveryFrameId = requestAnimationFrame(runRecovery);
}

function handleLineClick(event: Event) {
  emit('line-click', event as LyricLineMouseEvent);
}

function syncSeekLayout(timeMs: number, lineIndex?: number) {
  if (!player) return;

  syncAmlLyricSeekLayout(player, timeMs, lineIndex);
}

defineExpose({
  syncSeekLayout,
});

onMounted(() => {
  const wrapper = wrapperRef.value;
  if (!wrapper) return;

  attachPlayer(new PatchedLyricPlayer());
  startAnimationLoop();
  queueRecovery('mounted');

  resizeObserver = new ResizeObserver(() => {
    queueRecovery('resize');
  });
  resizeObserver.observe(wrapper);
});

onBeforeUnmount(() => {
  stopAnimationLoop();

  if (recoveryFrameId !== 0) {
    cancelAnimationFrame(recoveryFrameId);
    recoveryFrameId = 0;
    queueRecoveryMaxAttempts = 0;
    queueRecoveryAttempts = 0;
  }
  pendingLowPowerRecoveryReason = '';

  resizeObserver?.disconnect();
  resizeObserver = null;

  if (player) {
    detachPlayer();
  }
});

watch(() => props.disabled, (disabled) => {
  if (disabled) {
    stopAnimationLoop();
    return;
  }

  startAnimationLoop();
  queueRecovery('disabled-toggle');
});

watch(() => props.lowPower, (lowPower) => {
  if (lowPower) {
    stopAnimationLoop();
    if (recoveryFrameId !== 0) {
      cancelAnimationFrame(recoveryFrameId);
      recoveryFrameId = 0;
      queueRecoveryMaxAttempts = 0;
      queueRecoveryAttempts = 0;
    }
    return;
  }

  startAnimationLoop();
  queueRecovery(pendingLowPowerRecoveryReason || 'low-power-toggle');
  pendingLowPowerRecoveryReason = '';
});

watch(() => props.playing, (playing) => {
  if (!player) return;

  player.setPlaybackPaused(!playing);
});

watch(() => props.alignAnchor, (value) => {
  player?.setAlignAnchor(value);
  queueRecovery('align-anchor');
});

watch(() => props.alignPosition, (value) => {
  player?.setAlignPosition(value);
  queueRecovery('align-position');
});

watch(() => props.enableSpring, (value) => {
  player?.setEnableSpring(value);
  queueRecovery('spring');
});

watch(() => props.enableBlur, (value) => {
  player?.setEnableBlur(value);
  queueRecovery('blur');
});

watch(() => props.enableScale, (value) => {
  player?.setEnableScale(value);
  queueRecovery('scale');
});

watch(() => props.hidePassedLines, (value) => {
  player?.setHidePassedLines(value);
  queueRecovery('hide-passed');
});

watch(() => props.wordFadeWidth, (value) => {
  player?.setWordFadeWidth(value);
  queueRecovery('fade-width');
});

watch(() => props.lineGap, (value) => {
  player?.setLineGap(value);
  queueRecovery('line-gap', { maxAttempts: 0 });
});

watch(() => props.layoutVersion, () => {
  queueRecovery('layout-version');
});

watch(() => props.lyricLines, (value) => {
  if (!player) return;

  player.setLyricLines(value, Math.trunc(props.currentTime));
  queueRecovery('lyrics');
}, { deep: false });

watch(() => props.currentTime, (value) => {
  player?.setCurrentTime(Math.trunc(value));
});
</script>

<template>
  <div ref="wrapperRef" class="w-full h-full min-h-0 min-w-0" />
</template>
