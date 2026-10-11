import { computed, nextTick, onScopeDispose, ref, watch, type CSSProperties, type Ref } from 'vue';

export type LyricsAppearanceSection = 'layout' | 'typography' | 'position' | 'subtitles' | 'effects';
export type LyricsAppearancePopoverSide = 'left' | 'right' | 'overlay';

interface LyricsAppearancePopoverOptions {
  visible: Readonly<Ref<boolean>>;
  panelRef: Ref<HTMLElement | null>;
  popoverRef: Ref<HTMLElement | null>;
  beforeClose?: () => void;
}

const HOVER_OPEN_DELAY = 200;
const HOVER_CLOSE_DELAY = 260;
const POPOVER_WIDTH = 320;
const POPOVER_GAP = 0;
const VIEWPORT_MARGIN = 12;
const SECTION_SWITCH_DURATION = 260;
const FOCUSABLE_SELECTOR = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), '
  + 'textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** Keep a hover preview stable while crossing to its teleported controls. */
export function useLyricsAppearancePopover(options: LyricsAppearancePopoverOptions) {
  const activeSection = ref<LyricsAppearanceSection | null>(null);
  const pinned = ref(false);
  const popoverSide = ref<LyricsAppearancePopoverSide>('right');
  const positionStyle = ref<CSSProperties>({ position: 'fixed', width: `${POPOVER_WIDTH}px` });
  const popoverStyle = computed(() => positionStyle.value);

  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let positionFrame: number | undefined;
  let hoveredSection: LyricsAppearanceSection | null = null;
  let pointerInPopover = false;
  let activeTrigger: HTMLElement | null = null;
  let observedPopover: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | undefined;
  let listening = false;
  let disposed = false;
  let sectionAnimation: Animation | undefined;
  let sectionAnimationSequence = 0;
  let sectionTargetHeight: number | undefined;

  function cancelSectionAnimation() {
    sectionAnimationSequence += 1;
    sectionAnimation?.cancel();
    sectionAnimation = undefined;
    sectionTargetHeight = undefined;
  }

  function clearOpenTimer() {
    if (openTimer === undefined) return;
    clearTimeout(openTimer);
    openTimer = undefined;
  }

  function clearCloseTimer() {
    if (closeTimer === undefined) return;
    clearTimeout(closeTimer);
    closeTimer = undefined;
  }

  function findTrigger(section: LyricsAppearanceSection) {
    return options.panelRef.value?.querySelector<HTMLElement>(`[data-lyrics-section="${section}"]`) ?? null;
  }

  function containsTarget(element: HTMLElement | null, target: EventTarget | null) {
    return target instanceof Node && !!element?.contains(target);
  }

  function focusInPopover() {
    return typeof document !== 'undefined'
      && containsTarget(options.popoverRef.value, document.activeElement);
  }

  function focusInActiveTrigger() {
    return typeof document !== 'undefined' && containsTarget(activeTrigger, document.activeElement);
  }

  function updatePosition() {
    if (disposed || !options.visible.value || !activeSection.value || typeof window === 'undefined') return;
    const panel = options.panelRef.value;
    if (!panel) return;

    activeTrigger = findTrigger(activeSection.value);
    const panelRect = panel.getBoundingClientRect();
    const triggerRect = activeTrigger?.getBoundingClientRect() ?? panelRect;
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const leftBoundary = viewportLeft + VIEWPORT_MARGIN;
    const rightBoundary = viewportLeft + viewportWidth - VIEWPORT_MARGIN;
    const topBoundary = viewportTop + (viewportHeight >= 600 ? 84 : VIEWPORT_MARGIN);
    const bottomBoundary = viewportTop + viewportHeight - (viewportHeight >= 600 ? 96 : VIEWPORT_MARGIN);
    const maxHeight = Math.max(1, bottomBoundary - topBoundary);
    const desiredWidth = Math.max(1, Math.min(POPOVER_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2));
    const spaceOnLeft = panelRect.left - POPOVER_GAP - leftBoundary;
    const spaceOnRight = rightBoundary - panelRect.right - POPOVER_GAP;
    const preferredSide = panelRect.left + panelRect.width / 2 < viewportLeft + viewportWidth / 2
      ? 'right' : 'left';
    const preferredSpace = preferredSide === 'right' ? spaceOnRight : spaceOnLeft;
    const otherSpace = preferredSide === 'right' ? spaceOnLeft : spaceOnRight;

    let side: LyricsAppearancePopoverSide = preferredSide;
    let width = desiredWidth;
    if (preferredSpace < desiredWidth) {
      side = otherSpace >= desiredWidth ? (preferredSide === 'right' ? 'left' : 'right') : 'overlay';
    }
    if (side === 'overlay') {
      width = Math.min(desiredWidth, Math.max(280, panelRect.width));
    }
    const desiredLeft = side === 'right' ? panelRect.right + POPOVER_GAP
      : side === 'left' ? panelRect.left - POPOVER_GAP - width : panelRect.left;
    const left = Math.max(leftBoundary, Math.min(rightBoundary - width, desiredLeft));
    // Animated height is only the visual interpolation. Keep positioning tied
    // to the destination size so ResizeObserver cannot move that destination.
    const measuredHeight = sectionTargetHeight
      ?? (options.popoverRef.value?.getBoundingClientRect().height || 280);
    const height = Math.min(measuredHeight, maxHeight);
    const top = Math.max(topBoundary, Math.min(bottomBoundary - height, triggerRect.top));

    popoverSide.value = side;
    positionStyle.value = {
      position: 'fixed',
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${Math.floor(maxHeight)}px`,
    };
  }

  function queuePosition() {
    if (disposed || positionFrame !== undefined || typeof window === 'undefined') return;
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = undefined;
      updatePosition();
    });
  }

  async function animateSectionSwitch(from: DOMRect, section: LyricsAppearanceSection, sequence: number) {
    const popover = options.popoverRef.value;
    const isCurrent = () => !disposed && options.visible.value
      && activeSection.value === section && sequence === sectionAnimationSequence
      && options.popoverRef.value === popover;
    if (!popover || typeof popover.animate !== 'function'
      || (typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      updatePosition();
      void nextTick().then(queuePosition);
      return;
    }

    // Measure after the new keyed controls replace the old controls, then let
    // Vue apply the new viewport constraints before measuring the destination.
    await nextTick();
    if (!isCurrent()) return;
    updatePosition();
    await nextTick();
    if (!isCurrent()) return;
    sectionTargetHeight = popover.getBoundingClientRect().height;
    updatePosition();
    await nextTick();
    if (!isCurrent()) return;
    const to = popover.getBoundingClientRect();

    try {
      const animation = popover.animate([
        { top: `${from.top}px`, left: `${from.left}px`, height: `${from.height}px` },
        { top: `${to.top}px`, left: `${to.left}px`, height: `${to.height}px` },
      ], {
        duration: SECTION_SWITCH_DURATION,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
      });
      sectionAnimation = animation;
      const finish = () => {
        if (!isCurrent() || sectionAnimation !== animation) return;
        sectionAnimation = undefined;
        sectionTargetHeight = undefined;
        queuePosition();
      };
      void animation.finished.then(finish, finish);
    } catch {
      sectionTargetHeight = undefined;
      queuePosition();
    }
  }

  function openSection(section: LyricsAppearanceSection, fixed: boolean, trigger?: HTMLElement | null) {
    if (!options.visible.value || disposed) return;
    clearOpenTimer();
    clearCloseTimer();
    const switchingSection = activeSection.value !== null && activeSection.value !== section;
    // Snapshot before cancelling so repeated clicks continue from the frame
    // currently on screen rather than the previous animation's destination.
    const previousRect = switchingSection ? options.popoverRef.value?.getBoundingClientRect() : undefined;
    if (switchingSection) {
      cancelSectionAnimation();
      options.beforeClose?.();
    }
    activeSection.value = section;
    activeTrigger = trigger ?? findTrigger(section);
    pinned.value = fixed;
    if (previousRect) void animateSectionSwitch(previousRect, section, sectionAnimationSequence);
    else {
      updatePosition();
      void nextTick().then(queuePosition);
    }
  }

  function closePopover(restoreFocus = false) {
    clearOpenTimer();
    clearCloseTimer();
    cancelSectionAnimation();
    const trigger = activeTrigger;
    const wasOpen = activeSection.value !== null;
    if (wasOpen) options.beforeClose?.();
    activeSection.value = null;
    pinned.value = false;
    hoveredSection = null;
    pointerInPopover = false;
    activeTrigger = null;
    if (restoreFocus && wasOpen && trigger) {
      // Overlay mode makes the directory inert until Vue renders this close.
      void nextTick().then(() => {
        if (!disposed && options.visible.value && activeSection.value === null && trigger.isConnected) {
          trigger.focus({ preventScroll: true });
        }
      });
    }
  }

  function scheduleClose() {
    clearCloseTimer();
    if (!activeSection.value || pinned.value) return;
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      if (pinned.value || pointerInPopover || hoveredSection === activeSection.value
        || focusInPopover() || focusInActiveTrigger()) return;
      closePopover();
    }, HOVER_CLOSE_DELAY);
  }

  function enterSection(section: LyricsAppearanceSection, event: PointerEvent) {
    if (event.pointerType !== 'mouse' || !options.visible.value) return;
    hoveredSection = section;
    clearCloseTimer();
    clearOpenTimer();
    if (pinned.value || focusInPopover() || activeSection.value === section) return;
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : findTrigger(section);
    openTimer = setTimeout(() => {
      openTimer = undefined;
      if (hoveredSection !== section || pinned.value || focusInPopover()) return;
      openSection(section, false, trigger);
    }, HOVER_OPEN_DELAY);
  }

  function leaveSection(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    hoveredSection = null;
    clearOpenTimer();
    if (containsTarget(options.popoverRef.value, event.relatedTarget)) {
      clearCloseTimer();
      return;
    }
    scheduleClose();
  }

  function toggleSection(section: LyricsAppearanceSection) {
    if (activeSection.value === section && pinned.value) {
      closePopover();
      return;
    }
    openSection(section, true);
  }

  function keepPopoverOpen() {
    pointerInPopover = true;
    clearOpenTimer();
    clearCloseTimer();
  }

  function leavePopover(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    pointerInPopover = false;
    if (containsTarget(activeTrigger, event.relatedTarget)) {
      clearCloseTimer();
      return;
    }
    scheduleClose();
  }

  function pinPopover() {
    if (!activeSection.value) return;
    pinned.value = true;
    clearOpenTimer();
    clearCloseTimer();
  }

  function handlePopoverPointerDown(event: PointerEvent) {
    // The explicit pin toggle owns its state. Pinning here first would make
    // its click handler always toggle from true back to false.
    if (event.target instanceof Element && event.target.closest('[data-lyrics-popover-pin]')) return;
    pinPopover();
  }

  function focusableControls() {
    return Array.from(options.popoverRef.value?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
      .filter((element) => element.tabIndex >= 0 && !element.closest('[hidden], [inert]'));
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || !options.visible.value || !activeSection.value) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePopover(true);
    } else if (event.key === 'Tab') {
      const controls = focusableControls();
      if (popoverSide.value === 'overlay' && controls.length > 0) {
        const first = controls[0]!;
        const last = controls[controls.length - 1]!;
        if (!containsTarget(options.popoverRef.value, event.target)
          || event.target === options.popoverRef.value
          || (event.shiftKey && event.target === first)
          || (!event.shiftKey && event.target === last)) {
          event.preventDefault();
          pinPopover();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
          return;
        }
      }
      if (!event.shiftKey && containsTarget(activeTrigger, event.target) && controls[0]) {
        event.preventDefault();
        pinPopover();
        controls[0].focus({ preventScroll: true });
      } else if (popoverSide.value !== 'overlay' && event.shiftKey && controls[0] === event.target && activeTrigger) {
        event.preventDefault();
        activeTrigger.focus({ preventScroll: true });
      }
    }
  }

  function handleFocusIn(event: FocusEvent) {
    if (containsTarget(options.popoverRef.value, event.target) || containsTarget(activeTrigger, event.target)) {
      clearCloseTimer();
    }
  }

  function handleFocusOut() {
    if (!pinned.value && activeSection.value) scheduleClose();
  }

  function disconnectObservers() {
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    observedPopover?.removeEventListener('pointerdown', handlePopoverPointerDown, true);
    observedPopover = null;
  }

  function observeElements() {
    disconnectObservers();
    if (disposed || !options.visible.value) return;
    observedPopover = options.popoverRef.value;
    observedPopover?.addEventListener('pointerdown', handlePopoverPointerDown, true);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(queuePosition);
      if (options.panelRef.value) resizeObserver.observe(options.panelRef.value);
      if (observedPopover) resizeObserver.observe(observedPopover);
    }
    queuePosition();
  }

  function stopListening() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    listening = false;
    document.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('focusin', handleFocusIn, true);
    document.removeEventListener('focusout', handleFocusOut, true);
    window.removeEventListener('resize', queuePosition);
    window.removeEventListener('scroll', queuePosition, true);
    window.visualViewport?.removeEventListener('resize', queuePosition);
    window.visualViewport?.removeEventListener('scroll', queuePosition);
    if (positionFrame !== undefined) window.cancelAnimationFrame(positionFrame);
    positionFrame = undefined;
    disconnectObservers();
  }

  function startListening() {
    if (listening || disposed || typeof window === 'undefined' || typeof document === 'undefined') return;
    listening = true;
    // Bubble after nested editors, but before the owning panel's window listener.
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    window.addEventListener('resize', queuePosition);
    window.addEventListener('scroll', queuePosition, true);
    window.visualViewport?.addEventListener('resize', queuePosition);
    window.visualViewport?.addEventListener('scroll', queuePosition);
    observeElements();
  }

  watch(options.visible, (visible) => {
    if (visible) startListening();
    else {
      closePopover();
      stopListening();
    }
  }, { immediate: true, flush: 'sync' });
  watch([options.panelRef, options.popoverRef], observeElements, { flush: 'post' });
  watch(activeSection, () => void nextTick().then(queuePosition), { flush: 'post' });

  onScopeDispose(() => {
    disposed = true;
    closePopover();
    stopListening();
  });

  return {
    activeSection,
    pinned,
    popoverStyle,
    popoverSide,
    enterSection,
    leaveSection,
    toggleSection,
    keepPopoverOpen,
    leavePopover,
    closePopover,
    pinPopover,
  };
}
