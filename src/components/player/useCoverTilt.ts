import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

const MAX_TILT_DEGREES = 8;
const SETTLE_EPSILON = 0.015;
const SETTLE_SPEED = 0.03; // Degrees per second, not per frame.
const GEOMETRY_PROPERTIES = new Set(['top', 'left', 'width', 'height', 'translate', 'transform']);
const FOLLOW_SPRING = createSpring(8.5, 0.78);
const RETURN_SPRING = createSpring(7, 0.84);

function createSpring(frequency: number, dampingRatio: number) {
  return {
    stiffness: frequency * frequency,
    damping: frequency * dampingRatio,
    dampedFrequency: frequency * Math.sqrt(1 - dampingRatio * dampingRatio),
  };
}

/** Animate a separate surface so the hit area and shared-cover transition stay stable. */
export function useCoverTilt(
  hitArea: Ref<HTMLElement | null>,
  surface: Ref<HTMLElement | null>,
  enabled: () => boolean,
) {
  const supportsHover = ref(false);
  let mediaQuery: MediaQueryList | null = null;
  const syncHoverSupport = () => { supportsHover.value = !!mediaQuery?.matches; };

  onMounted(() => {
    mediaQuery = window.matchMedia('(any-hover: hover) and (any-pointer: fine) and (prefers-reduced-motion: no-preference)');
    syncHoverSupport();
    mediaQuery.addEventListener('change', syncHoverSupport);
  });

  // Closed/hidden players have no pointer listeners, resize observer or animation work.
  const stop = watch([enabled, supportsHover, hitArea, surface], ([active, supported, host, layer], _, onCleanup) => {
    if (!active || !supported || !host || !layer) return;

    let frame = 0;
    let lastFrameTime: number | null = null;
    let bounds: DOMRect | null = null;
    let hovering = false;
    let pointerDirty = false;
    let pointerX = 0;
    let pointerY = 0;
    let rotationX = 0;
    let rotationY = 0;
    let velocityX = 0;
    let velocityY = 0;
    let targetX = 0;
    let targetY = 0;
    const geometryTransitions = new Set<string>();

    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastFrameTime = null;
      bounds = null;
      hovering = false;
      pointerDirty = false;
      rotationX = rotationY = targetX = targetY = 0;
      velocityX = velocityY = 0;
      layer.style.removeProperty('transform');
      layer.style.removeProperty('will-change');
    };

    const animate = (timestamp: number) => {
      frame = 0;

      if (hovering && pointerDirty) {
        // Measure the untransformed hit area once per hover, never on every mouse event.
        bounds ??= host.getBoundingClientRect();
        if (!bounds.width || !bounds.height) {
          reset();
          return;
        }
        const x = Math.max(-1, Math.min(1, (pointerX - bounds.left) / bounds.width * 2 - 1));
        const y = Math.max(-1, Math.min(1, (pointerY - bounds.top) / bounds.height * 2 - 1));
        targetX = -y * MAX_TILT_DEGREES;
        targetY = x * MAX_TILT_DEGREES;
        pointerDirty = false;
      }

      // A softer spring preserves momentum on direction changes, with only a tiny rebound.
      // Its exact solution shares coefficients across both axes: no integration substeps,
      // frame-rate-dependent damping or additional DOM reads/writes.
      const elapsed = lastFrameTime === null ? 0 : Math.min(timestamp - lastFrameTime, 64) / 1000;
      lastFrameTime = timestamp;
      const spring = hovering ? FOLLOW_SPRING : RETURN_SPRING;
      const decay = Math.exp(-spring.damping * elapsed);
      const cosine = Math.cos(spring.dampedFrequency * elapsed);
      const sine = Math.sin(spring.dampedFrequency * elapsed) / spring.dampedFrequency;
      const positionDecay = decay * (cosine + spring.damping * sine);
      const velocityToPosition = decay * sine;
      const positionToVelocity = -spring.stiffness * velocityToPosition;
      const velocityDecay = decay * (cosine - spring.damping * sine);
      const offsetX = rotationX - targetX;
      const offsetY = rotationY - targetY;
      rotationX = targetX + offsetX * positionDecay + velocityX * velocityToPosition;
      rotationY = targetY + offsetY * positionDecay + velocityY * velocityToPosition;
      velocityX = offsetX * positionToVelocity + velocityX * velocityDecay;
      velocityY = offsetY * positionToVelocity + velocityY * velocityDecay;
      // Crossing the target at speed must not cut the spring animation short.
      const settled = Math.abs(targetX - rotationX) < SETTLE_EPSILON
        && Math.abs(targetY - rotationY) < SETTLE_EPSILON
        && Math.abs(velocityX) < SETTLE_SPEED
        && Math.abs(velocityY) < SETTLE_SPEED;
      if (settled) {
        rotationX = targetX;
        rotationY = targetY;
        velocityX = velocityY = 0;
      }

      // One compositor-friendly write moves both the artwork and its existing reflection.
      if (rotationX || rotationY) {
        layer.style.transform = `perspective(1100px) rotateX(${rotationX.toFixed(3)}deg) rotateY(${rotationY.toFixed(3)}deg)`;
      } else {
        layer.style.removeProperty('transform');
      }

      if (settled) {
        lastFrameTime = null;
        layer.style.removeProperty('will-change');
        return;
      }
      frame = requestAnimationFrame(animate);
    };

    const scheduleFrame = () => {
      if (frame) return;
      layer.style.willChange = 'transform';
      frame = requestAnimationFrame(animate);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons || geometryTransitions.size || document.hidden) return;
      if (hovering && pointerX === event.clientX && pointerY === event.clientY) return;
      if (!hovering) bounds = null;
      hovering = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
      pointerDirty = true;
      scheduleFrame();
    };

    const onPointerLeave = () => {
      if (!hovering) return;
      hovering = false;
      pointerDirty = false;
      bounds = null;
      targetX = targetY = 0;
      scheduleFrame();
    };

    const onTransitionRun = (event: TransitionEvent) => {
      if (event.target !== host || !GEOMETRY_PROPERTIES.has(event.propertyName)) return;
      geometryTransitions.add(event.propertyName);
      if (event.propertyName === 'transform') {
        // Level out gently while the cover travels, without tracking a moving hit area.
        onPointerLeave();
        bounds = null;
      } else {
        reset();
      }
    };

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== host || !GEOMETRY_PROPERTIES.has(event.propertyName)) return;
      geometryTransitions.delete(event.propertyName);
      bounds = null;
    };

    const passive = { passive: true };
    host.addEventListener('pointerenter', onPointerMove, passive);
    host.addEventListener('pointermove', onPointerMove, passive);
    host.addEventListener('pointerleave', onPointerLeave, passive);
    host.addEventListener('pointercancel', reset, passive);
    host.addEventListener('transitionrun', onTransitionRun);
    host.addEventListener('transitionend', onTransitionEnd);
    host.addEventListener('transitioncancel', onTransitionEnd);
    window.addEventListener('resize', reset, passive);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    const resizeObserver = new ResizeObserver(reset);
    resizeObserver.observe(host);

    onCleanup(() => {
      reset();
      resizeObserver.disconnect();
      host.removeEventListener('pointerenter', onPointerMove);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('pointercancel', reset);
      host.removeEventListener('transitionrun', onTransitionRun);
      host.removeEventListener('transitionend', onTransitionEnd);
      host.removeEventListener('transitioncancel', onTransitionEnd);
      window.removeEventListener('resize', reset);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    });
  }, { flush: 'post' });

  onBeforeUnmount(() => {
    stop();
    mediaQuery?.removeEventListener('change', syncHoverSupport);
  });
}
