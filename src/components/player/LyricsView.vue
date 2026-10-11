<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { LyricLineMouseEvent } from '@applemusic-like-lyrics/core';
import {
  getLyricsFontFamily,
  importedLyricsFontsRevision,
  type LyricLine,
  useLyrics,
} from '../../composables/lyrics';
import { usePlayer } from '../../composables/player';
import { useRenderingPower } from '../../composables/renderingPower';
import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import AmlLyricPlayer from './AmlLyricPlayer.vue';
import LightLyricPlayer from './LightLyricPlayer.vue';
import { getPlaybackSeekSecondsForAmlLine } from './amllSeekLayout';
import { getAmlLineSourceStartTime } from './lyricPlaybackTiming';
import { useAmlDisplayLines } from './useAmlDisplayLines';
import { readLyricsAppearanceDraft, type LyricsAppearanceDraft } from './useLyricsAppearanceDraft';

const props = defineProps<{ appearancePreview?: LyricsAppearanceDraft }>();
const { parsedLyrics, nativeAmlLyrics, lyricsSettings, lyricsStatus } = useLyrics();
const { playAt, currentTime, isPlaying, currentSong, showPlayerDetail } = usePlayer();
const { isMainWindowLowPower } = useRenderingPower();
const { audioDelay } = storeToRefs(useSettingsStore());
const { clockRevision, seekRevision } = storeToRefs(usePlaybackStore());
const amlPlayerRef = ref<{ syncSeekLayout: (timeMs: number, lineIndex?: number) => void } | null>(null);
const appearancePreview = computed(() => props.appearancePreview ?? readLyricsAppearanceDraft(lyricsSettings));
const isVerticalWriting = computed(() => lyricsSettings.playerWritingMode === 'vertical');

const amllLines = useAmlDisplayLines(nativeAmlLyrics, () => lyricsSettings);
// Keep the signed source clock: positive lyric delay holds at zero until the
// source clock crosses zero, instead of starting a new local clock too early.
const amllCurrentTime = computed(() => Math.floor((currentTime.value - audioDelay.value) * 1000));
const lightCurrentTime = computed(() => currentTime.value - audioDelay.value);
const lyricsTimeSyncKey = computed(() => `${currentSong.value?.path ?? ''}:${audioDelay.value}:${clockRevision.value}`);
const lyricsAlignmentClass = computed(() => `lyrics-align-${lyricsSettings.playerAlignment}`);
const lyricsPlayerStyle = computed(() => ({
  '--lyrics-font-scale': appearancePreview.value.playerFontScale.toString(),
  '--lyrics-translation-font-scale': (appearancePreview.value.playerTranslationFontScale ?? 1).toString(),
  '--lyrics-line-gap': appearancePreview.value.playerLineGap.toString(),
  '--lyrics-font-family': getLyricsFontFamily(lyricsSettings.playerFontPreset),
  '--lyrics-offset-x': `${appearancePreview.value.playerOffsetX}%`,
  '--lyrics-offset-y': `${appearancePreview.value.playerOffsetY}%`,
}));
const lyricsLayoutVersion = computed(() => `${lyricsSettings.playerFontPreset}:${importedLyricsFontsRevision.value}`);
const shouldReduceLyricsRendering = computed(() => isMainWindowLowPower.value || !showPlayerDetail.value);
const emptyStateText = computed(() => {
  if (lyricsStatus.value === 'loading') return 'Loading lyrics...';
  if (lyricsStatus.value === 'error') return 'Lyrics unavailable';
  return 'No synchronized lyrics';
});

async function handleLineClick(event: LyricLineMouseEvent) {
  const lineStartTimeMs = getAmlLineSourceStartTime(event.line.getLine());
  amlPlayerRef.value?.syncSeekLayout(lineStartTimeMs, event.lineIndex);
  const targetSeconds = getPlaybackSeekSecondsForAmlLine(lineStartTimeMs, audioDelay.value);
  await playAt(targetSeconds);
}

async function handleLightLineClick(line: LyricLine) {
  await playAt(Math.max(0, line.time + audioDelay.value));
}
</script>

<template>
  <div class="group/lyrics-view relative h-full min-h-0 w-full min-w-0">
    <div
      v-if="amllLines.length > 0"
      data-player-lyrics-viewport
      class="lyrics-mask-shell h-full min-h-0 w-full min-w-0"
      :class="[lyricsAlignmentClass, { 'lyrics-writing-vertical': isVerticalWriting }]"
      :style="lyricsPlayerStyle"
    >
      <div class="lyrics-position-frame h-full min-h-0 w-full min-w-0">
        <AmlLyricPlayer
          v-if="isVerticalWriting || lyricsSettings.playerRenderMode === 'amll'"
          :key="isVerticalWriting ? `vertical-${lyricsSettings.playerVerticalScrollDirection}` : 'horizontal'"
          ref="amlPlayerRef"
          class="amll-host h-full min-h-0 w-full min-w-0"
          :lyric-lines="amllLines"
          :current-time="amllCurrentTime"
          :time-sync-key="lyricsTimeSyncKey"
          :seek-key="seekRevision"
          :playing="isPlaying"
          :low-power="shouldReduceLyricsRendering"
          :layout-version="lyricsLayoutVersion"
          :font-scale="appearancePreview.playerFontScale"
          :translation-font-scale="appearancePreview.playerTranslationFontScale"
          align-anchor="center"
          :align-position="isVerticalWriting ? 0.5 : 0.42"
          :enable-spring="true"
          :enable-blur="lyricsSettings.enableBlur"
          :blur-strength="appearancePreview.blurStrength"
          :enable-scale="true"
          :hide-passed-lines="false"
          :word-fade-width="0.5"
          :line-gap="appearancePreview.playerLineGap"
          :writing-mode="lyricsSettings.playerWritingMode"
          :vertical-scroll-direction="lyricsSettings.playerVerticalScrollDirection"
          @line-click="handleLineClick"
        />
        <LightLyricPlayer
          v-else-if="lyricsSettings.playerRenderMode === 'light'"
          class="light-lyrics-host h-full min-h-0 w-full min-w-0"
          :lyric-lines="parsedLyrics"
          :current-time="lightCurrentTime"
          :time-sync-key="lyricsTimeSyncKey"
          :seek-key="seekRevision"
          :playing="isPlaying && !shouldReduceLyricsRendering"
          :show-translation="lyricsSettings.showTranslation"
          :show-romaji="lyricsSettings.showRomaji"
          :translation-font-scale="appearancePreview.playerTranslationFontScale"
          :line-gap="appearancePreview.playerLineGap"
          :title="currentSong?.title || currentSong?.name"
          :artist="currentSong?.artist"
          :album="currentSong?.album"
          @line-click="handleLightLineClick"
        />
      </div>
    </div>

    <div
      v-else
      class="no-lyrics flex h-full items-center justify-center text-2xl font-medium"
    >
      {{ emptyStateText }}
    </div>

  </div>
</template>

<style scoped>
.lyrics-mask-shell {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  --lyrics-edge-fade: 12%;
  --lyrics-edge-softness: 8%;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.24) var(--lyrics-edge-softness),
    black var(--lyrics-edge-fade),
    black calc(100% - var(--lyrics-edge-fade)),
    rgba(0, 0, 0, 0.24) calc(100% - var(--lyrics-edge-softness)),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.24) var(--lyrics-edge-softness),
    black var(--lyrics-edge-fade),
    black calc(100% - var(--lyrics-edge-fade)),
    rgba(0, 0, 0, 0.24) calc(100% - var(--lyrics-edge-softness)),
    transparent 100%
  );
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
}

.amll-host {
  min-width: 0;
  min-height: 0;
}

.lyrics-writing-vertical {
  -webkit-mask-image: linear-gradient(to right, transparent, black 12%, black 88%, transparent);
  mask-image: linear-gradient(to right, transparent, black 12%, black 88%, transparent);
}

.lyrics-writing-vertical .amll-host :deep(.amll-lyric-player) {
  --amll-lp-font-size: calc(clamp(22px, 3.6vh, 40px) * var(--lyrics-font-scale, 1));
  --amll-lp-line-width-aspect: 0.9;
  line-height: 1.5;
  letter-spacing: 0.1em;
}

.lyrics-writing-vertical .amll-host :deep(.amll-lyric-player [class*="_lyricSubLine"]) {
  letter-spacing: 0.08em;
}

.lyrics-position-frame {
  transform: translate3d(var(--lyrics-offset-x, 0%), var(--lyrics-offset-y, 0%), 0);
  transition: transform 180ms ease;
  will-change: transform;
}

.amll-host :deep(.amll-lyric-player) {
  --amll-lp-color: rgb(var(--player-lyrics-rgb, 255 255 255) / 0.95);
  --amll-lp-bg-color: transparent;
  --amll-lp-font-size: calc(max(max(5vh, 2.5vw), 12px) * var(--lyrics-font-scale, 1));
  mix-blend-mode: normal;
  font-family: var(--lyrics-font-family, system-ui, sans-serif);
}

.amll-host :deep(.amll-lyric-player),
.amll-host :deep(.amll-lyric-player *) {
  text-shadow: none !important;
}

.no-lyrics {
  color: rgb(var(--player-lyrics-rgb, 255 255 255) / 0.55);
}

/* AMLL 0.6 keeps translation as the second child and romanization as the third;
   the two share a class, so target the translation slot independently. */
.amll-host :deep(.amll-lyric-player [class*="_lyricSubLine"]:nth-child(2)) {
  font-size: calc(max(0.5em, 10px) * var(--lyrics-translation-font-scale, 1));
  opacity: var(--player-lyrics-amll-subline-alpha, 0.72);
}

/* AMLL 0.6 skin: retain its layout/duet structure and only change appearance. */
.amll-host :deep(.amll-lyric-player [class*="_lyricLineWrapper"]) {
  --amll-lp-color: rgb(var(--player-lyrics-rgb, 255 255 255) / 0.95);
  color: var(--amll-lp-color);
  padding-top: calc(0.4em * var(--lyrics-line-gap, 1));
  padding-bottom: calc(0.4em * var(--lyrics-line-gap, 1));
}

.amll-host :deep(.amll-lyric-player [class*="_lyricLine"]:not([class*="_lyricLineWrapper"]):not([class*="_lyricDuetLine"])) {
  text-align: var(--lyrics-text-align, left);
  transform-origin: var(--lyrics-line-transform-origin, 0%) center;
}

/* A full-width row lets AMLL measure away its horizontal duet offset while
   preserving the native vertical, scale and opacity animations. */
.lyrics-align-center .amll-host :deep(.amll-lyric-player [class*="_interludeDots"]),
.lyrics-align-right .amll-host :deep(.amll-lyric-player [class*="_interludeDots"]) {
  box-sizing: border-box;
  width: 100%;
  justify-content: center;
  transform-origin: var(--lyrics-line-transform-origin, 50%) center;
}

.lyrics-align-right .amll-host :deep(.amll-lyric-player [class*="_interludeDots"]) {
  justify-content: flex-end;
}

.lyrics-align-left {
  --lyrics-text-align: left;
  --lyrics-line-transform-origin: 0%;
  --light-align-items: flex-start;
}

.lyrics-align-center {
  --lyrics-text-align: center;
  --lyrics-line-transform-origin: 50%;
  --light-align-items: center;
}

.lyrics-align-right {
  --lyrics-text-align: right;
  --lyrics-line-transform-origin: 100%;
  --light-align-items: flex-end;
}

@media screen and (max-width: 768px) {
  .amll-host :deep(.amll-lyric-player) {
    --amll-lp-font-size: calc(max(8vw, 12px) * var(--lyrics-font-scale, 1));
  }

  .lyrics-writing-vertical .amll-host :deep(.amll-lyric-player) {
    --amll-lp-font-size: calc(clamp(20px, 4vw, 30px) * var(--lyrics-font-scale, 1));
  }
}

</style>
