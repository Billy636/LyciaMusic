<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import PlayerDetailBackground from './PlayerDetailBackground.vue';

const props = defineProps<{ active: boolean }>();

// Keep the native window transition independent of its visual treatment. Only
// composite opacity here: no screenshots, full-page blur, or window resize loop.
const visible = ref(false);
const overlay = ref<HTMLElement | null>(null);
let disposed = false;
let cancelVisualWait: (() => void) | undefined;

const fade = async (from: number, to: number, duration: number) => {
  const element = overlay.value;
  if (!element || disposed || !visible.value) return;

  element.style.opacity = String(to);
  const animation = element.animate(
    [{ opacity: from }, { opacity: to }],
    { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  );

  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      animation.cancel();
      if (cancelVisualWait === finish) cancelVisualWait = undefined;
      resolve();
    };
    // A minimized/hidden WebView may stop advancing its animation timeline.
    const timeout = setTimeout(finish, duration + 100);
    cancelVisualWait = finish;
    void animation.finished.then(finish, finish);
  });
};

const waitForViewport = () => new Promise<void>((resolve) => {
  let frame = 0;
  let quietTimer: ReturnType<typeof setTimeout>;
  const finish = () => {
    clearTimeout(deadline);
    clearTimeout(quietTimer);
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', resized);
    if (cancelVisualWait === finish) cancelVisualWait = undefined;
    resolve();
  };
  const resized = () => {
    clearTimeout(quietTimer);
    cancelAnimationFrame(frame);
    // Native command completion is not a guarantee that WebView layout has
    // caught up. Wait for a quiet resize interval and two rendering frames.
    quietTimer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(finish);
      });
    }, 48);
  };
  const deadline = setTimeout(finish, 240);
  cancelVisualWait = finish;
  window.addEventListener('resize', resized);
  resized();
});

const play = async (operation: () => Promise<void>) => {
  if (disposed || !props.active || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await operation();
    return;
  }

  visible.value = true;
  try {
    await nextTick();
    // A visual API failure must never prevent the actual fullscreen action.
    try {
      await fade(0, 1, 100);
    } catch {
      if (overlay.value) overlay.value.style.opacity = '1';
    }
    await operation();
  } finally {
    try {
      if (!disposed && visible.value) {
        await waitForViewport();
        // Reveal failures must not replace a native error (or turn a successful
        // native transition into a reported failure). Removing the layer is safe.
        await fade(1, 0, 220).catch(() => undefined);
      }
    } finally {
      visible.value = false;
    }
  }
};

watch(() => props.active, (active) => {
  if (active) return;
  visible.value = false;
  cancelVisualWait?.();
});

onBeforeUnmount(() => {
  disposed = true;
  cancelVisualWait?.();
});

defineExpose({ play });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="overlay"
      class="immersive-transition-overlay"
      aria-hidden="true"
      @pointerdown.stop.prevent
      @pointerup.stop.prevent
      @click.stop.prevent
      @contextmenu.prevent
      @wheel.stop.prevent
    >
      <PlayerDetailBackground :active="true" />
    </div>
  </Teleport>
</template>

<style scoped>
.immersive-transition-overlay {
  position: fixed;
  inset: 0;
  z-index: 8000;
  overflow: hidden;
  background: #0b1222;
  opacity: 0;
  cursor: wait;
  will-change: opacity;
}
</style>
