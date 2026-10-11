<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { extractCoverColorProfile } from '../../composables/colorExtraction';
import type { PlayerBackgroundMode, PlayerBackgroundPalette } from '../../types';
import { createPlayerBackgroundPalette } from './playerBackgroundPalette';

const props = withDefaults(defineProps<{
  mode: Exclude<PlayerBackgroundMode, 'original'>;
  palette: PlayerBackgroundPalette;
  coverSrc?: string;
  motion?: boolean;
  suspended?: boolean;
}>(), {
  coverSrc: '',
  motion: true,
  suspended: false,
});

const emptyProfile = { colors: [] };
const colors = shallowRef(createPlayerBackgroundPalette(props.palette, emptyProfile));
const moving = computed(() => props.mode === 'soft' && props.motion && !props.suspended);
const paletteStyle = computed(() => ({
  '--player-bg-base': colors.value.base,
  '--player-bg-end': colors.value.end,
  '--player-bg-left': colors.value.left,
  '--player-bg-glow': colors.value.glow,
  '--player-bg-accent': colors.value.accent,
  '--player-bg-quiet': colors.value.quiet,
}));
const coverToSample = computed(() => (
  props.palette === 'cover' && !props.suspended ? props.coverSrc : ''
));

watch([() => props.palette, coverToSample, () => props.suspended], async ([palette, coverSrc, suspended], _, onCleanup) => {
  let stale = false;
  onCleanup(() => { stale = true; });

  if (palette !== 'cover') {
    colors.value = createPlayerBackgroundPalette(palette, emptyProfile);
    return;
  }

  // Closed/hidden players skip sampling and use the shared cache on resume.
  if (suspended) return;
  if (!coverSrc) {
    colors.value = createPlayerBackgroundPalette(palette, emptyProfile);
    return;
  }
  const profile = await extractCoverColorProfile(coverSrc);
  if (!stale) colors.value = createPlayerBackgroundPalette(palette, profile);
}, { immediate: true });
</script>

<template>
  <div
    class="player-color-background"
    :class="{ 'is-moving': moving }"
    :style="{ backgroundColor: colors.base }"
    aria-hidden="true"
  >
    <Transition name="player-palette-dissolve">
      <div :key="`${colors.key}:${mode}`" class="player-color-layer" :class="mode" :style="paletteStyle">
        <div class="player-color-foundation"></div>
        <div class="player-color-field player-color-cover"></div>
        <div class="player-color-field player-color-halo"></div>
        <div class="player-color-field player-color-accent"></div>
        <div class="player-color-field player-color-quiet"></div>
        <div class="player-color-texture"></div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.player-color-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  transition: background-color 1100ms ease;
}
.player-color-layer { position: absolute; inset: 0; overflow: hidden; }
.player-color-foundation {
  position: absolute;
  inset: 0;
  background: linear-gradient(116deg, var(--player-bg-base) 0%, var(--player-bg-base) 30%, var(--player-bg-end) 100%);
}
.player-color-field { position: absolute; inset: -10%; background-repeat: no-repeat; }
.player-color-cover { background: radial-gradient(ellipse 53% 75% at 24% 44%, var(--player-bg-left), transparent 76%); }
.player-color-halo { background: radial-gradient(ellipse 35% 45% at 9% 11%, var(--player-bg-glow), transparent 80%); }
.player-color-accent { background: radial-gradient(ellipse 60% 60% at 44% 109%, var(--player-bg-accent), transparent 78%); }
.player-color-quiet { background: radial-gradient(ellipse 42% 58% at 94% 33%, var(--player-bg-quiet), transparent 85%); }
.player-color-texture {
  position: absolute;
  inset: 0;
  opacity: .035;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' opacity='.65' filter='url(%23n)'/%3E%3C/svg%3E");
}
.gradient .player-color-cover { background: linear-gradient(128deg, var(--player-bg-left) -45%, transparent 55%); }
.gradient .player-color-halo,
.gradient .player-color-accent,
.gradient .player-color-quiet { display: none; }
.soft .player-color-cover { animation: player-cover-drift 36s ease-in-out infinite alternate; }
.soft .player-color-halo { animation: player-halo-drift 42s ease-in-out infinite alternate; }
.soft .player-color-accent { animation: player-accent-drift 46s ease-in-out infinite alternate; }
.soft .player-color-field { animation-play-state: paused; }
.is-moving .soft .player-color-field { animation-play-state: running; }
.player-palette-dissolve-enter-active,
.player-palette-dissolve-leave-active { transition: opacity 1100ms ease; }
.player-palette-dissolve-enter-from,
.player-palette-dissolve-leave-to { opacity: 0; }
@keyframes player-cover-drift {
  from { transform: translate(-2%, -2%) scale(1); }
  to { transform: translate(2%, 3%) scale(1.06); }
}
@keyframes player-halo-drift {
  from { transform: translate(-2%, 0); }
  to { transform: translate(4%, 6%); }
}
@keyframes player-accent-drift {
  from { transform: translate(0, -3%); }
  to { transform: translate(-4%, 2%); }
}
@media (prefers-reduced-motion: reduce) {
  .soft .player-color-field { animation: none; }
  .player-color-background,
  .player-palette-dissolve-enter-active,
  .player-palette-dissolve-leave-active { transition: none; }
}
</style>
