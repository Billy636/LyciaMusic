<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { extractCoverColorProfile, type CoverColorProfile } from '../../composables/colorExtraction';
import { createMistPalette } from './mistPalette';

const props = withDefaults(defineProps<{
  coverSrc: string;
  suspended?: boolean;
  dark?: boolean;
  immersive?: boolean;
}>(), { suspended: false, dark: false, immersive: false });

const sourceProfile = ref<CoverColorProfile>({ colors: [] });
const pageHidden = ref(typeof document !== 'undefined' && document.hidden);
const reducedMotion = ref(false);
const renderingSuspended = computed(() => props.suspended || pageHidden.value);
const palette = computed(() => createMistPalette(sourceProfile.value, props.dark, props.immersive));

let renderedCoverSrc: string | null = null;
let paletteRequestId = 0;
let disposed = false;
let motionQuery: MediaQueryList | null = null;

watch([() => props.coverSrc, renderingSuspended], async ([src, suspended]) => {
  const requestId = ++paletteRequestId;
  if (disposed || suspended || src === renderedCoverSrc) return;
  const profile = await extractCoverColorProfile(src);
  if (disposed || requestId !== paletteRequestId || renderingSuspended.value || props.coverSrc !== src) return;
  renderedCoverSrc = src;
  sourceProfile.value = profile;
}, { immediate: true });

const onVisibilityChanged = () => { pageHidden.value = document.hidden; };
const onMotionPreferenceChanged = (event: MediaQueryListEvent) => {
  reducedMotion.value = event.matches;
};

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.value = motionQuery.matches;
  motionQuery.addEventListener('change', onMotionPreferenceChanged);
  document.addEventListener('visibilitychange', onVisibilityChanged);
});

onBeforeUnmount(() => {
  disposed = true;
  paletteRequestId += 1;
  motionQuery?.removeEventListener('change', onMotionPreferenceChanged);
  document.removeEventListener('visibilitychange', onVisibilityChanged);
});
</script>

<template>
  <div
    class="mist-background"
    :class="{
      'mist-background--static': renderingSuspended || reducedMotion,
    }"
    :style="{ backgroundColor: palette.base }"
    aria-hidden="true"
  >
    <div class="mist-glow" :style="{ backgroundColor: palette.glow, opacity: palette.glowOpacity }"></div>
    <div class="mist-shade" :style="{ backgroundColor: palette.shade, opacity: palette.shadeOpacity }"></div>
    <div v-if="immersive" class="mist-vignette"></div>
  </div>
</template>

<style scoped>
.mist-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: paint;
  transition: background-color 1200ms cubic-bezier(0.4, 0, 0.2, 1);
}

.mist-glow,
.mist-shade {
  position: absolute;
  inset: 0;
  transition: background-color 1200ms cubic-bezier(0.4, 0, 0.2, 1), opacity 1200ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* A soft alpha mask makes the light broad without a full-window blur pass.
   Individual colors interpolate continuously even during rapid song changes. */
.mist-glow {
  opacity: 0.42;
  mask-image: radial-gradient(ellipse at 49% 42%, #000 0%, #0009 25%, transparent 68%);
}

.mist-shade {
  opacity: 0.22;
  mask-image: radial-gradient(ellipse at 98% 97%, #000 0%, transparent 74%);
}

.mist-vignette {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to bottom, rgb(0 0 0 / 3%), transparent 50%, rgb(0 0 0 / 22%)),
    linear-gradient(to right, rgb(0 0 0 / 6%), transparent 50%, rgb(0 0 0 / 6%));
}

.mist-background--static,
.mist-background--static .mist-glow,
.mist-background--static .mist-shade { transition: none; }

@media (prefers-reduced-motion: reduce) {
  .mist-background,
  .mist-glow,
  .mist-shade { transition: none; }
}
</style>
