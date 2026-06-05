<script setup lang="ts">
import { ref } from 'vue';

import DesktopLyricsToolbar from './DesktopLyricsToolbar.vue';
import { useDesktopLyricsDisplay } from '../../composables/useDesktopLyricsDisplay';
import { useDesktopLyricsWindowController } from '../../composables/useDesktopLyricsWindowController';

const showDragShadow = ref(false);

const {
  playbackTime,
  isPlaying,
  settings,
  lyricsAlignmentClass,
  fallbackStateText,
  lyricsPlayerStyle,
  widgetStyle,
  activeLyricLine,
  blockTransitionKey,
  visibleLyricLines,
  blockStyle,
  handlePayload,
  handlePlaybackPayload,
  emitAction,
  getWordStyle,
  getRomajiWordStyle,
  getRomajiLineStyle,
} = useDesktopLyricsDisplay(showDragShadow);

const {
  isSystemHidden,
  isToolbarVisible,
  widgetShellStyle,
  handlePointerEnter,
  handlePointerMove,
  handlePointerLeave,
  startWindowDrag,
} = useDesktopLyricsWindowController({
  showDragShadow,
  settings,
  playbackTime,
  isPlaying,
  handlePayload,
  handlePlaybackPayload,
});
</script>

<template>
  <div class="desktop-lyrics-window h-screen w-screen overflow-visible bg-transparent">
    <div class="flex h-full w-full items-center justify-center overflow-visible p-0">
      <div
        class="desktop-widget-shell relative h-full w-full transition-all duration-300"
        :style="widgetShellStyle"
        @mouseenter="handlePointerEnter"
        @mousemove="handlePointerMove"
        @mouseleave="handlePointerLeave"
      >
        <DesktopLyricsToolbar
          class="desktop-widget-toolbar"
          :class="{ 'desktop-widget-toolbar--visible': isToolbarVisible }"
          :is-playing="isPlaying"
          @action="emitAction"
        />

        <div
          class="desktop-widget relative flex h-full w-full select-none flex-col overflow-hidden"
          :class="[
            lyricsAlignmentClass,
            {
              'desktop-widget--dragging': showDragShadow,
              'desktop-widget--surface-visible': showDragShadow || settings.alwaysShowShadowBackground,
            },
          ]"
          :style="widgetStyle"
          @mousedown="startWindowDrag"
        >
          <div class="desktop-lyrics-body" :style="lyricsPlayerStyle">
            <div class="desktop-lyrics-host h-full min-h-0 w-full min-w-0" :class="lyricsAlignmentClass">
              <div class="desktop-lyrics-mask-shell h-full min-h-0 w-full min-w-0">
                <div class="desktop-lyrics-position-frame h-full min-h-0 w-full min-w-0">
                  <transition name="desktop-block" mode="out-in">
                    <div
                      v-if="activeLyricLine"
                      :key="blockTransitionKey"
                      class="desktop-lyric-block"
                      :style="blockStyle"
                    >
                      <div
                        v-for="displayLine in visibleLyricLines"
                        :key="`${displayLine.line.time}:${displayLine.line.text}:${displayLine.lineIndex}`"
                        class="desktop-lyric-row"
                        :class="{
                          'desktop-lyric-row--active': displayLine.active,
                          'desktop-lyric-row--inactive': !displayLine.active,
                          'desktop-lyric-row--second-line': settings.showDoubleLine && !displayLine.active,
                        }"
                      >
                        <div
                          class="desktop-lyric-main"
                          :class="{
                            'desktop-lyric-main--inactive': !displayLine.active,
                            'desktop-lyric-main--solid': !displayLine.words.length,
                          }"
                        >
                          <template v-if="displayLine.words.length">
                            <span
                              v-for="(word, index) in displayLine.words"
                              :key="`${word.start}-${word.end}-${index}`"
                              class="desktop-lyric-word"
                              :class="{ 'desktop-lyric-word--with-romaji': displayLine.hasAlignedRomaji }"
                            >
                              <span
                                class="desktop-lyric-word-main"
                                :style="displayLine.active ? getWordStyle(word.start, word.end) : undefined"
                              >
                                {{ word.text }}
                              </span>
                              <span
                                v-if="displayLine.hasAlignedRomaji"
                                class="desktop-lyric-word-romaji"
                                :style="displayLine.active ? getRomajiWordStyle(word.start, word.end) : undefined"
                              >
                                {{ word.romaji?.trim() }}
                              </span>
                            </span>
                          </template>
                          <template v-else>
                            {{ displayLine.line.text }}
                          </template>
                        </div>

                        <div
                          v-for="secondaryLine in displayLine.secondaryLines"
                          :key="`${displayLine.lineIndex}:${secondaryLine.kind}:${secondaryLine.text}`"
                          class="desktop-lyric-sub"
                          :class="`desktop-lyric-sub--${secondaryLine.kind}`"
                          :style="secondaryLine.kind === 'romaji' && displayLine.active
                            ? getRomajiLineStyle(displayLine.line, displayLine.lineIndex)
                            : undefined"
                        >
                          {{ secondaryLine.text }}
                        </div>
                      </div>
                    </div>

                    <div
                      v-else
                      :key="'empty-' + blockTransitionKey"
                      class="desktop-empty-state flex h-full items-center justify-center text-center"
                    >
                      {{ fallbackStateText }}
                    </div>
                  </transition>
                </div>
              </div>
            </div>
          </div>

          <div v-if="isSystemHidden" class="desktop-system-hide-indicator">
            Fullscreen app detected
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.desktop-lyrics-window {
  background: transparent;
}

.desktop-widget-shell {
  overflow: visible;
  will-change: opacity, transform;
}

.desktop-widget-toolbar {
  position: absolute;
  top: 8px;
  left: 50%;
  z-index: 20;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -10px) scale(0.96);
  transition: opacity 180ms ease, transform 220ms ease;
}

.desktop-widget-toolbar--visible {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, 0) scale(1);
}

.desktop-widget {
  position: absolute;
  inset: 0;
  border: 1px solid transparent;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  overflow: visible;
  transition:
    background 220ms ease,
    box-shadow 220ms ease,
    border-color 220ms ease,
    outline-color 220ms ease;
}

.desktop-widget--surface-visible {
  border-color: color-mix(in srgb, var(--desktop-accent-b) 22%, transparent);
  background:
    radial-gradient(circle at top center, color-mix(in srgb, var(--desktop-accent-a) 24%, transparent), transparent 42%),
    radial-gradient(circle at bottom right, color-mix(in srgb, var(--desktop-accent-c) 16%, transparent), transparent 38%),
    linear-gradient(180deg, rgba(20, 20, 24, 0.68), rgba(12, 12, 16, 0.54));
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--desktop-accent-d) 18%, transparent),
    0 22px 56px rgba(0, 0, 0, 0.18),
    0 6px 18px rgba(0, 0, 0, 0.08),
    0 0 0 1px color-mix(in srgb, var(--desktop-accent-a) 8%, transparent);
}

.desktop-widget::before {
  content: none;
}

.desktop-widget--dragging {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.desktop-lyrics-body {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 24px;
  box-sizing: border-box;
}

.desktop-lyrics-host {
  display: flex;
  align-items: center;
  justify-content: center;
}

.desktop-lyrics-mask-shell {
  position: relative;
  overflow: visible;
  isolation: isolate;
  display: flex;
  align-items: center;
  justify-content: center;
}

.desktop-lyrics-position-frame {
  transform: translate3d(var(--lyrics-offset-x, 0%), var(--lyrics-offset-y, 0%), 0);
  transition: transform 180ms ease;
  will-change: transform;
  display: flex;
  align-items: var(--lyrics-vertical-align, center);
  justify-content: var(--lyrics-horizontal-align, center);
  min-height: 100%;
  padding: 16px 0;
  box-sizing: border-box;
}

.desktop-lyric-block {
  width: min(100%, 1180px);
  max-width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(0.22rem * var(--desktop-line-gap, 1));
  text-align: var(--lyrics-text-align, center);
  font-family: var(--lyrics-font-family, system-ui, sans-serif);
  transform-origin: var(--lyrics-line-transform-origin, 50%) center;
  opacity: var(--desktop-text-opacity, 1);
  transition: opacity 220ms ease;
}

.desktop-lyric-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: calc(0.12rem * var(--desktop-line-gap, 1));
  opacity: 1;
  transform: translate3d(0, 0, 0) scale(1);
  filter: none;
  transition:
    opacity 480ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 560ms cubic-bezier(0.22, 1, 0.36, 1),
    filter 480ms ease;
  will-change: opacity, transform, filter;
}

.desktop-lyric-row--active {
  opacity: 1;
  transform: translate3d(0, 0, 0) scale(1);
}

.desktop-lyric-row--inactive {
  opacity: 0.74;
  transform: translate3d(0, 2px, 0) scale(0.992);
  filter: saturate(0.94);
}

.desktop-lyric-main {
  width: 100%;
  font-size: calc(max(26px, min(4.8vw, 6vh)) * var(--desktop-font-scale, 1));
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: 0.01em;
  color: var(--desktop-text-primary);
  overflow-wrap: anywhere;
  word-break: break-word;
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.55)))
    drop-shadow(0 0 var(--desktop-first-line-text-shadow-blur, 0px) rgb(var(--desktop-text-shadow-color, 0 0 0) / var(--desktop-first-line-text-shadow-alpha, 0)))
    drop-shadow(0 0 24px color-mix(in srgb, var(--desktop-accent-a) 14%, transparent));
  transition:
    color 460ms ease,
    font-size 560ms cubic-bezier(0.22, 1, 0.36, 1),
    font-weight 520ms ease,
    filter 460ms ease;
}

.desktop-lyric-main--inactive {
  font-size: calc(max(20px, min(3.6vw, 4.8vh)) * var(--desktop-font-scale, 1));
  font-weight: 650;
  color: color-mix(in srgb, var(--desktop-text-primary) 76%, transparent);
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 var(--desktop-second-line-text-shadow-blur, 0px) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.86)))
    drop-shadow(0 0 18px color-mix(in srgb, var(--desktop-accent-c) 10%, transparent));
}

.desktop-lyric-main--solid {
  color: var(--desktop-lyric-solid-color, var(--desktop-text-primary));
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.55)))
    drop-shadow(0 0 var(--desktop-first-line-text-shadow-blur, 0px) rgb(var(--desktop-text-shadow-color, 0 0 0) / var(--desktop-first-line-text-shadow-alpha, 0)))
    drop-shadow(0 0 24px color-mix(in srgb, var(--desktop-lyric-solid-color, var(--desktop-accent-a)) 22%, transparent));
}

.desktop-lyric-main--solid.desktop-lyric-main--inactive {
  color: color-mix(in srgb, var(--desktop-lyric-solid-color, var(--desktop-text-primary)) 76%, transparent);
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 var(--desktop-second-line-text-shadow-blur, 0px) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.86)))
    drop-shadow(0 0 18px color-mix(in srgb, var(--desktop-lyric-solid-color, var(--desktop-accent-c)) 14%, transparent));
}

.desktop-lyric-word {
  display: inline-block;
  white-space: pre-wrap;
  transition:
    color 420ms ease,
    opacity 420ms ease,
    filter 260ms linear,
    text-shadow 260ms linear;
}

.desktop-lyric-word--with-romaji {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  text-align: center;
  vertical-align: bottom;
  white-space: nowrap;
}

.desktop-lyric-word-main {
  display: inline-block;
  white-space: pre-wrap;
}

.desktop-lyric-word-romaji {
  display: block;
  margin-top: 0.08em;
  color: var(--desktop-romaji-unplayed-color);
  font-size: 0.46em;
  font-weight: 650;
  line-height: 1.05;
  letter-spacing: 0;
  white-space: pre;
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.86) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.86)))
    drop-shadow(0 0 16px color-mix(in srgb, var(--desktop-romaji-unplayed-color) 20%, transparent));
}

.desktop-lyric-sub {
  width: 100%;
  font-size: calc(max(14px, min(2.25vw, 2.75vh)) * var(--desktop-font-scale, 1));
  line-height: 1.36;
  letter-spacing: 0.03em;
  overflow-wrap: anywhere;
  word-break: break-word;
  transition:
    color 460ms ease,
    opacity 460ms ease,
    filter 460ms ease,
    transform 500ms ease;
}

.desktop-lyric-sub--romaji {
  color: var(--desktop-romaji-unplayed-color);
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.86) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.86)))
    drop-shadow(0 0 16px color-mix(in srgb, var(--desktop-romaji-unplayed-color) 20%, transparent));
}

.desktop-lyric-sub--translation {
  color: var(--desktop-translation-color);
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.82) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.82)))
    drop-shadow(0 0 12px color-mix(in srgb, var(--desktop-translation-color) 18%, transparent));
}

.desktop-lyric-row--second-line .desktop-lyric-sub--romaji {
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-second-line-text-shadow-blur, 0px) * 0.86) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.86)))
    drop-shadow(0 0 16px color-mix(in srgb, var(--desktop-romaji-unplayed-color) 20%, transparent));
}

.desktop-lyric-row--second-line .desktop-lyric-sub--translation {
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-second-line-text-shadow-blur, 0px) * 0.82) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.82)))
    drop-shadow(0 0 12px color-mix(in srgb, var(--desktop-translation-color) 18%, transparent));
}

.lyrics-align-left {
  --lyrics-horizontal-align: center;
  --lyrics-vertical-align: center;
  --lyrics-text-align: left;
  --lyrics-line-transform-origin: 0%;
}

.lyrics-align-center {
  --lyrics-horizontal-align: center;
  --lyrics-vertical-align: center;
  --lyrics-text-align: center;
  --lyrics-line-transform-origin: 50%;
}

.lyrics-align-right {
  --lyrics-horizontal-align: center;
  --lyrics-vertical-align: center;
  --lyrics-text-align: right;
  --lyrics-line-transform-origin: 100%;
}

.lyrics-align-split-corners {
  --lyrics-horizontal-align: center;
  --lyrics-vertical-align: stretch;
  --lyrics-text-align: left;
  --lyrics-line-transform-origin: 0%;
}

.lyrics-align-split-corners .desktop-lyric-block {
  width: 100%;
  height: 100%;
  max-width: 100%;
  align-items: stretch;
  justify-content: space-between;
  gap: 0;
}

.lyrics-align-split-corners .desktop-lyric-row:first-child {
  text-align: left;
  transform-origin: 0% center;
}

.lyrics-align-split-corners .desktop-lyric-row:nth-child(2) {
  --lyrics-text-align: right;
  --lyrics-line-transform-origin: 100%;
  text-align: right;
  transform-origin: 100% center;
}

.desktop-empty-state {
  color: var(--desktop-text-secondary);
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.82) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.82)))
    drop-shadow(0 0 16px color-mix(in srgb, var(--desktop-accent-a) 12%, transparent));
}

.desktop-block-enter-active,
.desktop-block-leave-active {
  transition: opacity 180ms ease, transform 220ms ease, filter 220ms ease;
}

.desktop-block-enter-from,
.desktop-block-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.985);
  filter: blur(8px);
}

.desktop-system-hide-indicator {
  position: absolute;
  right: 16px;
  bottom: 12px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  pointer-events: none;
}
</style>
