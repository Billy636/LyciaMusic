import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

const ROTATION_DURATION = 24_000;

/** Keep the artwork and its remounted reflection on the same compositor timeline. */
export function useCoverRotation(
  artwork: Ref<HTMLElement | null>,
  reflection: Ref<HTMLElement | null>,
  enabled: () => boolean,
  playing: () => boolean,
  resetDuration = 0,
) {
  const reducedMotion = ref(false);
  const animations = new Map<HTMLElement, Animation>();
  const resets = new Map<HTMLElement, { animation: Animation; angle: number }>();
  let mediaQuery: MediaQueryList | null = null;
  const syncReducedMotion = () => { reducedMotion.value = !!mediaQuery?.matches; };
  const cancelAnimations = () => {
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
  };
  const cancelResets = () => {
    for (const { animation } of resets.values()) animation.cancel();
    resets.clear();
  };

  onMounted(() => {
    mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    syncReducedMotion();
    mediaQuery.addEventListener('change', syncReducedMotion);
  });

  const stop = watch([enabled, playing, reducedMotion, artwork, reflection], ([active, running, reduced, cover, mirror]) => {
    if (!active) {
      // A circular scene can collapse into a square one. Bring its artwork
      // upright over the same interval as the mask, without snapping its phase.
      if (resetDuration > 0 && !reduced) {
        for (const [element, animation] of animations) {
          const elapsed = typeof animation.currentTime === 'number' ? animation.currentTime : 0;
          const phase = (elapsed % ROTATION_DURATION) / ROTATION_DURATION * 360;
          const angle = phase > 180 ? phase - 360 : phase;
          animation.cancel();
          if (!element.isConnected || !angle) continue;
          const reset = element.animate([
            { transform: `rotate(${angle}deg)` },
            { transform: 'rotate(0deg)' },
          ], { duration: resetDuration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
          resets.set(element, { animation: reset, angle });
          reset.onfinish = () => {
            if (resets.get(element)?.animation !== reset) return;
            resets.delete(element);
            reset.cancel();
          };
        }
      } else cancelResets();
      cancelAnimations();
      return;
    }

    // Read the existing phase before a leaving reflection is removed. Pausing,
    // opening the page again and changing songs must never reset the artwork.
    const primary = (cover && animations.get(cover)) || animations.values().next().value;
    const resetting = (cover && resets.get(cover)) || resets.values().next().value;
    const resetProgress = resetting?.animation.effect?.getComputedTiming().progress ?? 0;
    const resetAngle = resetting ? resetting.angle * (1 - resetProgress) : 0;
    const elapsed = resetting ? ((resetAngle + 360) % 360) / 360 * ROTATION_DURATION
      : typeof primary?.currentTime === 'number' ? primary.currentTime : 0;
    // Rapidly reversing a page transition resumes from its visible angle.
    cancelResets();
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
    cancelResets();
    mediaQuery?.removeEventListener('change', syncReducedMotion);
  });
}
