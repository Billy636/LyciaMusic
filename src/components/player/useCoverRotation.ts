import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

const ROTATION_DURATION = 24_000;

/** Keep the artwork and its remounted reflection on the same compositor timeline. */
export function useCoverRotation(
  artwork: Ref<HTMLElement | null>,
  reflection: Ref<HTMLElement | null>,
  enabled: () => boolean,
  playing: () => boolean,
) {
  const reducedMotion = ref(false);
  const animations = new Map<HTMLElement, Animation>();
  let mediaQuery: MediaQueryList | null = null;
  const syncReducedMotion = () => { reducedMotion.value = !!mediaQuery?.matches; };
  const cancelAnimations = () => {
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
  };

  onMounted(() => {
    mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    syncReducedMotion();
    mediaQuery.addEventListener('change', syncReducedMotion);
  });

  const stop = watch([enabled, playing, reducedMotion, artwork, reflection], ([active, running, reduced, cover, mirror]) => {
    if (!active) {
      cancelAnimations();
      return;
    }

    // Read the existing phase before a leaving reflection is removed. Pausing,
    // opening the page again and changing songs must never reset the artwork.
    const primary = (cover && animations.get(cover)) || animations.values().next().value;
    const elapsed = typeof primary?.currentTime === 'number' ? primary.currentTime : 0;
    const surfaces = [cover, mirror].filter((element): element is HTMLElement => !!element);
    for (const [element, animation] of animations) {
      if (!surfaces.includes(element)) {
        // Vue clears a leaving ref before the reflection's fade finishes.
        // Keep that visible frame at its current angle until the DOM leaves.
        if (element.isConnected) animation.commitStyles();
        animation.cancel();
        animations.delete(element);
      }
    }

    const timelineTime = document.timeline.currentTime;
    for (const element of surfaces) {
      let animation = animations.get(element);
      if (!animation) {
        animation = element.animate([
          { transform: 'rotate(0deg)' },
          { transform: 'rotate(360deg)' },
        ], { duration: ROTATION_DURATION, iterations: Infinity, easing: 'linear' });
        animations.set(element, animation);
      }
      animation.pause();
      animation.currentTime = elapsed;
      if (running && !reduced) {
        animation.play();
        if (typeof timelineTime === 'number') animation.startTime = timelineTime - elapsed;
      }
    }
  }, { flush: 'post' });

  onBeforeUnmount(() => {
    stop();
    cancelAnimations();
    mediaQuery?.removeEventListener('change', syncReducedMotion);
  });
}
