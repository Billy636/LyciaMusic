<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { usePlayer } from '../../composables/player';

const props = defineProps<{
  bgOpacity?: number;
  active?: boolean;
}>();

const { dominantColors, currentCover } = usePlayer();

const viewportArea = ref(
  typeof window !== 'undefined' ? window.innerWidth * window.innerHeight : 0
);
const isLargeViewport = computed(() => viewportArea.value >= 2000000);

const updateViewportArea = () => {
  viewportArea.value = window.innerWidth * window.innerHeight;
};

const thumbCoverUrl = computed(() => (
  (props.active ?? true) ? currentCover.value : ''
));

onMounted(() => {
  window.addEventListener('resize', updateViewportArea);
  updateViewportArea();
});

onUnmounted(() => {
  window.removeEventListener('resize', updateViewportArea);
});
</script>

<template>
  <div
    class="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none"
    :style="{ opacity: props.bgOpacity ?? 1, transition: 'opacity 350ms cubic-bezier(0.4, 0, 0.2, 1)' }"
  >
    <div class="absolute inset-0 bg-[#0b1222] z-0"></div>

    <div
      class="absolute inset-0 transition-colors duration-[1200ms]"
      :class="isLargeViewport ? 'opacity-[0.04]' : 'opacity-[0.06]'"
      :style="{ backgroundColor: dominantColors[0] }"
    ></div>

    <transition name="song-switch-bg" mode="out-in">
      <div v-if="thumbCoverUrl" :key="thumbCoverUrl" class="absolute inset-0 overflow-hidden z-[1]">
        <img
          :src="thumbCoverUrl"
          class="w-full h-full object-cover scale-110 select-none"
          :style="{ filter: isLargeViewport ? 'blur(40px) brightness(0.78) saturate(1.42) contrast(1.16)' : 'blur(52px) brightness(0.72) saturate(1.36) contrast(1.14)' }"
          draggable="false"
          decoding="async"
        />
      </div>
    </transition>

    <div class="absolute inset-0 z-[2]" :style="{ background: `radial-gradient(circle at 24% 16%, ${dominantColors[1] || dominantColors[0]}22 0%, transparent 52%)` }"></div>
    <div class="absolute inset-0 z-[3]" :style="{ background: `radial-gradient(circle at 78% 84%, ${dominantColors[2] || dominantColors[0]}18 0%, transparent 62%)` }"></div>
    <div class="absolute inset-0 z-[4]" :style="{ background: `radial-gradient(circle at 50% 48%, ${dominantColors[0]}10 0%, transparent 58%)` }"></div>

    <div class="absolute inset-0 bg-gradient-to-r from-black/6 via-transparent to-black/6 z-[18]"></div>
    <div class="absolute inset-0 bg-gradient-to-b from-black/3 via-transparent to-black/22 z-20"></div>
  </div>
</template>

<style scoped>
/* 切歌时背景封面交叉淡入淡出 */
.song-switch-bg-enter-active,
.song-switch-bg-leave-active {
  transition: opacity 600ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-switch-bg-enter-from,
.song-switch-bg-leave-to {
  opacity: 0;
}
</style>
