<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import type { LyricWord } from '../../composables/lyrics/types';
import { getTaskbarLyricWordProgress } from '../../features/taskbarPlayer/lyrics';

const props = defineProps<{
  text: string;
  words?: LyricWord[];
  time: number;
  endTime: number;
  playbackTime: number;
  /** Untimed translations stay readable instead of inheriting source word timing. */
  translation?: boolean;
}>();

const viewport = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lineProgress = () => {
  if (props.playbackTime < props.time) return 0;
  if (props.endTime <= props.time) return 1;
  return clamp((props.playbackTime - props.time) / (props.endTime - props.time), 0, 1);
};

const updateScroll = () => {
  if (!viewport.value || !content.value) return;
  const overflow = Math.max(0, content.value.scrollWidth - viewport.value.clientWidth);
  let scrollLeft = 0;
  if (overflow > 0 && props.playbackTime > props.time) {
    const words = props.words ?? [];
    if (words.length) {
      const nextIndex = words.findIndex(word => word.end > props.playbackTime);
      const wordIndex = nextIndex === -1 ? words.length - 1 : nextIndex;
      const element = content.value.children[wordIndex] as HTMLElement | undefined;
      if (element) {
        const progress = getTaskbarLyricWordProgress(words[wordIndex], props.playbackTime);
        scrollLeft = element.offsetLeft + element.offsetWidth * progress - viewport.value.clientWidth * 0.65;
      }
    } else {
      scrollLeft = overflow * lineProgress();
    }
  }
  viewport.value.scrollLeft = Math.round(clamp(scrollLeft, 0, overflow));
};

watch(() => props.playbackTime, () => { void nextTick(updateScroll); });
watch(() => [props.text, props.time, props.words], () => {
  if (viewport.value) viewport.value.scrollLeft = 0;
  void nextTick(updateScroll);
}, { flush: 'post' });

onMounted(() => {
  resizeObserver = new ResizeObserver(updateScroll);
  if (viewport.value) resizeObserver.observe(viewport.value);
  if (content.value) resizeObserver.observe(content.value);
  updateScroll();
});
onUnmounted(() => resizeObserver?.disconnect());
</script>

<template>
  <div ref="viewport" class="taskbar-lyric-viewport" :class="{ 'is-translation': translation }" :title="text">
    <div ref="content" class="taskbar-lyric-content" role="group" :aria-label="text">
      <template v-if="words?.length">
        <span
          v-for="(word, index) in words"
          :key="index"
          class="taskbar-lyric-word"
          aria-hidden="true"
          :data-text="word.text"
          :style="{ '--word-progress': `${getTaskbarLyricWordProgress(word, playbackTime) * 100}%` }"
        >{{ word.text }}</span>
      </template>
      <span
        v-else
        aria-hidden="true"
        class="taskbar-lyric-word"
        :class="{ 'is-untimed-translation': translation }"
        :data-text="text"
        :style="{ '--word-progress': `${lineProgress() * 100}%` }"
      >{{ text }}</span>
    </div>
  </div>
</template>

<style scoped>
.taskbar-lyric-viewport {
  overflow: hidden;
  white-space: nowrap;
  scrollbar-width: none;
  min-width: 0;
  font-size: 13px;
  line-height: 17px;
  font-weight: 600;
}
.taskbar-lyric-viewport.is-translation {
  font-size: 11px;
  line-height: 14px;
  font-weight: 500;
}
.taskbar-lyric-content {
  position: relative;
  width: max-content;
  min-width: 100%;
  white-space: pre;
}
.taskbar-lyric-word {
  position: relative;
  display: inline-block;
  color: rgb(var(--taskbar-text-rgb, 255 255 255) / 50%);
}
.taskbar-lyric-word::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  color: rgb(var(--taskbar-text-rgb, 255 255 255) / 95%);
  clip-path: inset(0 calc(100% - var(--word-progress, 0%)) 0 0);
}
.is-untimed-translation { color: rgb(var(--taskbar-text-rgb, 255 255 255) / 80%); }
.is-untimed-translation::after { content: none; }
</style>
