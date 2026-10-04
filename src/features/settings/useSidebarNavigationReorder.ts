import { computed, onDeactivated, onScopeDispose, shallowRef, watch, type CSSProperties, type Ref } from 'vue';
import type { SidebarNavigationId } from './sidebarNavigation';

interface RowGeometry {
  id: SidebarNavigationId;
  top: number;
  height: number;
}

interface DragState {
  id: SidebarNavigationId;
  active: boolean;
  settling: boolean;
  offsetY: number;
  targetIndex: number;
}

interface DragSession {
  id: SidebarNavigationId;
  pointerId: number;
  handle: HTMLElement;
  order: SidebarNavigationId[];
  rows: RowGeometry[];
  sourceIndex: number;
  sourceTop: number;
  sourceHeight: number;
  minTop: number;
  maxTop: number;
  grabOffset: number;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  scrollParent: HTMLElement;
  reducedMotion: boolean;
  bodyCursor: string;
  bodyUserSelect: string;
  bodyStyled: boolean;
}

const settleDuration = 200;
const transition = `transform ${settleDuration}ms cubic-bezier(0.2, 0, 0, 1)`;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function findScrollParent(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY)
      && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

export function useSidebarNavigationReorder(
  list: Ref<HTMLOListElement | null>,
  getOrder: () => SidebarNavigationId[],
  onReorder: (order: SidebarNavigationId[], id: SidebarNavigationId) => void,
) {
  const drag = shallowRef<DragState | null>(null);
  let session: DragSession | null = null;
  let frame: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let previousFrameTime: number | null = null;

  function slotTop(current: DragSession, index: number) {
    const row = current.rows[index];
    return index > current.sourceIndex ? row.top + row.height - current.sourceHeight : row.top;
  }

  const placeholderStyle = computed<CSSProperties | null>(() => {
    const current = drag.value;
    if (!current?.active || !session) return null;
    return {
      position: 'absolute',
      top: `${slotTop(session, current.targetIndex)}px`,
      height: `${session.sourceHeight}px`,
      left: 0,
      right: 0,
      pointerEvents: 'none',
      transition: session.reducedMotion ? 'none' : `top ${settleDuration}ms cubic-bezier(0.2, 0, 0, 1)`,
    };
  });

  function getRowStyle(id: SidebarNavigationId): CSSProperties {
    const current = drag.value;
    if (!current?.active || !session) return {};
    const index = session.order.indexOf(id);
    let offset = 0;
    if (id === current.id) offset = current.offsetY;
    else if (index > session.sourceIndex && index <= current.targetIndex) offset = -session.sourceHeight;
    else if (index < session.sourceIndex && index >= current.targetIndex) offset = session.sourceHeight;
    return {
      transform: `translate3d(0, ${offset}px, 0)`,
      transition: session.reducedMotion || (id === current.id && !current.settling) ? 'none' : transition,
      willChange: 'transform',
    };
  }

  function stopFrame() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    previousFrameTime = null;
  }

  function restoreBody(current: DragSession) {
    if (!current.bodyStyled) return;
    document.body.style.cursor = current.bodyCursor;
    document.body.style.userSelect = current.bodyUserSelect;
    current.bodyStyled = false;
  }

  function releaseCapture(current: DragSession) {
    if (current.handle.hasPointerCapture(current.pointerId)) {
      current.handle.releasePointerCapture(current.pointerId);
    }
  }

  function listen(add: boolean) {
    if (add) {
      window.addEventListener('pointermove', moveDrag, { capture: true, passive: false });
      window.addEventListener('pointerup', finishDrag, true);
      window.addEventListener('pointercancel', pointerCancel, true);
      window.addEventListener('scroll', scheduleFrame, true);
      window.addEventListener('blur', cleanup);
      window.addEventListener('resize', cleanup);
      window.addEventListener('keydown', keyboard, true);
    } else {
      window.removeEventListener('pointermove', moveDrag, true);
      window.removeEventListener('pointerup', finishDrag, true);
      window.removeEventListener('pointercancel', pointerCancel, true);
      window.removeEventListener('scroll', scheduleFrame, true);
      window.removeEventListener('blur', cleanup);
      window.removeEventListener('resize', cleanup);
      window.removeEventListener('keydown', keyboard, true);
    }
  }

  function cleanup() {
    const current = session;
    session = null;
    drag.value = null;
    stopFrame();
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
    listen(false);
    if (current) {
      restoreBody(current);
      releaseCapture(current);
    }
  }

  function updatePosition() {
    const current = drag.value;
    const element = list.value;
    const currentSession = session;
    if (!current?.active || current.settling || !currentSession || !element) return;
    const top = clamp(currentSession.pointerY - element.getBoundingClientRect().top - currentSession.grabOffset,
      currentSession.minTop, currentSession.maxTop);
    const center = top + currentSession.sourceHeight / 2;
    const distance = (index: number) => Math.abs(center - slotTop(currentSession, index) - currentSession.sourceHeight / 2);
    let targetIndex = current.targetIndex;
    for (let index = 0; index < currentSession.rows.length; index++) {
      if (distance(index) + 4 < distance(targetIndex)) targetIndex = index;
    }
    drag.value = { ...current, offsetY: top - currentSession.sourceTop, targetIndex };
  }

  function autoScroll(elapsed: number) {
    if (!session) return false;
    const parent = session.scrollParent;
    const rect = parent === document.scrollingElement ? {
      top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth,
    } : parent.getBoundingClientRect();
    const top = Math.max(0, rect.top), bottom = Math.min(window.innerHeight, rect.bottom);
    if (bottom <= top || session.pointerX < Math.max(0, rect.left)
      || session.pointerX > Math.min(window.innerWidth, rect.right)) return false;
    const edge = Math.min(48, (bottom - top) / 2);
    const speed = session.pointerY < top + edge ? -clamp((top + edge - session.pointerY) / edge, 0, 1)
      : session.pointerY > bottom - edge ? clamp((session.pointerY - bottom + edge) / edge, 0, 1) : 0;
    const before = parent.scrollTop;
    if (speed) parent.scrollTop = clamp(before + speed * 600 * elapsed / 1000, 0, parent.scrollHeight - parent.clientHeight);
    return parent.scrollTop !== before;
  }

  function renderFrame(time: number) {
    frame = null;
    if (!drag.value?.active || drag.value.settling) return;
    const elapsed = previousFrameTime === null ? 1000 / 60 : clamp(time - previousFrameTime, 0, 32);
    previousFrameTime = time;
    const scrolled = autoScroll(elapsed);
    updatePosition();
    if (scrolled) scheduleFrame();
    else previousFrameTime = null;
  }

  function scheduleFrame() {
    if (drag.value?.active && !drag.value.settling && frame === null) frame = requestAnimationFrame(renderFrame);
  }

  function moveDrag(event: PointerEvent) {
    const current = drag.value;
    if (!current || current.settling || !session || event.pointerId !== session.pointerId) return;
    session.pointerX = event.clientX;
    session.pointerY = event.clientY;
    if (!current.active) {
      if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 6) return;
      drag.value = { ...current, active: true };
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      session.bodyStyled = true;
    }
    if (event.cancelable) event.preventDefault();
    scheduleFrame();
  }

  function settle(commit: boolean) {
    const current = drag.value;
    const capturedSession = session;
    if (!current || !capturedSession) return;
    if (!current.active) { cleanup(); return; }
    stopFrame();
    if (settleTimer !== null) clearTimeout(settleTimer);
    const targetIndex = commit ? current.targetIndex : capturedSession.sourceIndex;
    drag.value = { ...current, settling: true, targetIndex,
      offsetY: slotTop(capturedSession, targetIndex) - capturedSession.sourceTop };
    restoreBody(capturedSession);
    releaseCapture(capturedSession);
    const complete = () => {
      if (session !== capturedSession) return;
      const order = [...capturedSession.order];
      order.splice(capturedSession.sourceIndex, 1);
      order.splice(targetIndex, 0, capturedSession.id);
      cleanup();
      if (commit && targetIndex !== capturedSession.sourceIndex) onReorder(order, capturedSession.id);
    };
    if (capturedSession.reducedMotion) complete();
    else frame = requestAnimationFrame(() => {
      frame = null;
      settleTimer = setTimeout(complete, settleDuration);
    });
  }

  function finishDrag(event: PointerEvent) {
    if (!session || drag.value?.settling || event.pointerId !== session.pointerId) return;
    session.pointerX = event.clientX;
    session.pointerY = event.clientY;
    updatePosition();
    settle(true);
  }

  function cancelDrag() { settle(false); }

  function pointerCancel(event: PointerEvent) {
    if (event.pointerId === session?.pointerId && !drag.value?.settling) cancelDrag();
  }

  function handleLostPointerCapture(event: PointerEvent) {
    if (event.pointerId === session?.pointerId && !drag.value?.settling) cancelDrag();
  }

  function keyboard(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !session) return;
    event.preventDefault();
    event.stopPropagation();
    cancelDrag();
  }

  function beginDrag(event: PointerEvent, id: SidebarNavigationId) {
    const element = list.value;
    if (!element || drag.value || !event.isPrimary || event.button !== 0) return;
    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) return;
    const order = [...getOrder()];
    const elements = Array.from(element.querySelectorAll<HTMLElement>('[data-navigation-id]'));
    const rows = order.map(rowId => {
      const row = elements.find(row => row.dataset.navigationId === rowId);
      return row ? { id: rowId, top: row.offsetTop, height: row.offsetHeight } : null;
    });
    const sourceIndex = order.indexOf(id);
    if (sourceIndex < 0 || rows.some(row => !row || row.height <= 0)) return;
    const geometry = rows as RowGeometry[];
    const source = geometry[sourceIndex];
    session = {
      id, pointerId: event.pointerId, handle, order, rows: geometry, sourceIndex,
      sourceTop: source.top, sourceHeight: source.height,
      minTop: geometry[0].top,
      maxTop: geometry[geometry.length - 1].top + geometry[geometry.length - 1].height - source.height,
      grabOffset: event.clientY - element.getBoundingClientRect().top - source.top,
      startX: event.clientX, startY: event.clientY, pointerX: event.clientX, pointerY: event.clientY,
      scrollParent: findScrollParent(element), reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      bodyCursor: document.body.style.cursor, bodyUserSelect: document.body.style.userSelect, bodyStyled: false,
    };
    drag.value = { id, active: false, settling: false, offsetY: 0, targetIndex: sourceIndex };
    listen(true);
    handle.focus({ preventScroll: true });
    try { handle.setPointerCapture(event.pointerId); } catch { cleanup(); }
  }

  watch(() => getOrder().join('\0'), order => {
    if (session && order !== session.order.join('\0')) cleanup();
  }, { flush: 'sync' });
  onDeactivated(cleanup);
  onScopeDispose(cleanup);

  return { drag, placeholderStyle, getRowStyle, beginDrag, cancelDrag, handleLostPointerCapture };
}
