const TAP_MOVE_TOLERANCE = 12
const NATIVE_CLICK_GRACE_MS = 60

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[data-touch-click]',
].join(',')

type ActivePointer = {
  pointerId: number
  target: Element
  clientX: number
  clientY: number
  moved: boolean
}

type PendingClick = {
  target: Element
  clientX: number
  clientY: number
  timer: ReturnType<typeof setTimeout>
}

const getEventElement = (event: Event): Element | null => {
  const pathTarget = event.composedPath?.().find((item): item is Element => item instanceof Element)
  if (pathTarget) return pathTarget
  return event.target instanceof Element ? event.target : null
}

/**
 * A drag region itself must stay draggable, but real controls nested inside a
 * drag region (for example title-bar buttons) must remain tappable.
 */
const isWindowDragOnlyTarget = (target: Element) => {
  let current: Element | null = target

  while (current) {
    if (current.matches(INTERACTIVE_SELECTOR)) return false
    if (
      current.hasAttribute('data-tauri-drag-region')
      || current.hasAttribute('data-window-drag-handle')
    ) return true
    current = current.parentElement
  }

  return false
}

const targetsMatch = (nativeTarget: Element, pendingTarget: Element) =>
  nativeTarget === pendingTarget
  || nativeTarget.contains(pendingTarget)
  || pendingTarget.contains(nativeTarget)

/**
 * Windows touch hardware is not consistent: WebView2 may expose a tap as a
 * touch/pen pointer, or as a compatibility mouse pointer. Track every primary
 * pointer and synthesize a click only if WebView2 did not emit the matching
 * native click. This keeps ordinary mouse clicks native while covering both
 * classes of touch device.
 */
export const installTouchClickSupport = (root: Document = document) => {
  let activePointer: ActivePointer | null = null
  let pendingClick: PendingClick | null = null

  const clearPendingClick = () => {
    if (!pendingClick) return
    clearTimeout(pendingClick.timer)
    pendingClick = null
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (event.isPrimary === false || event.button !== 0) return

    const target = getEventElement(event)
    if (!target || isWindowDragOnlyTarget(target)) return

    clearPendingClick()
    activePointer = {
      pointerId: event.pointerId,
      target,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
    }
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (!activePointer || activePointer.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - activePointer.clientX, event.clientY - activePointer.clientY) > TAP_MOVE_TOLERANCE) {
      activePointer.moved = true
    }
  }

  const handlePointerUp = (event: PointerEvent) => {
    if (!activePointer || activePointer.pointerId !== event.pointerId) return

    const pointer = activePointer
    activePointer = null
    if (pointer.moved || !pointer.target.isConnected || pointer.target.closest(':disabled')) return

    clearPendingClick()
    const clientX = event.clientX
    const clientY = event.clientY
    const timer = setTimeout(() => {
      pendingClick = null
      pointer.target.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX,
        clientY,
        detail: 1,
      }))
    }, NATIVE_CLICK_GRACE_MS)

    pendingClick = { target: pointer.target, clientX, clientY, timer }
  }

  const handlePointerCancel = (event: PointerEvent) => {
    if (activePointer?.pointerId === event.pointerId) activePointer = null
  }

  const handleNativeClick = (event: MouseEvent) => {
    if (!pendingClick) return

    const target = getEventElement(event)
    if (!target || !targetsMatch(target, pendingClick.target)) return

    const closeToTap = event.clientX === 0 && event.clientY === 0
      || Math.hypot(event.clientX - pendingClick.clientX, event.clientY - pendingClick.clientY) <= TAP_MOVE_TOLERANCE
    if (closeToTap) clearPendingClick()
  }

  root.addEventListener('pointerdown', handlePointerDown, true)
  root.addEventListener('pointermove', handlePointerMove, true)
  root.addEventListener('pointerup', handlePointerUp, true)
  root.addEventListener('pointercancel', handlePointerCancel, true)
  root.addEventListener('click', handleNativeClick, true)

  return () => {
    clearPendingClick()
    activePointer = null
    root.removeEventListener('pointerdown', handlePointerDown, true)
    root.removeEventListener('pointermove', handlePointerMove, true)
    root.removeEventListener('pointerup', handlePointerUp, true)
    root.removeEventListener('pointercancel', handlePointerCancel, true)
    root.removeEventListener('click', handleNativeClick, true)
  }
}
