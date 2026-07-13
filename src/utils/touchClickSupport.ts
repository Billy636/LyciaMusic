const TOUCH_TAP_MOVE_TOLERANCE = 12
const NATIVE_CLICK_GRACE_MS = 40

type ActiveTouch = {
  pointerId: number
  target: HTMLElement
  clientX: number
  clientY: number
  moved: boolean
}

/**
 * Some Windows interactive displays expose touch as pointer events but do not
 * reliably synthesize the following click in WebView2. Keep Vue's normal click
 * handlers as the source of truth and provide a click only when the native one
 * did not arrive.
 */
export const installTouchClickSupport = (root: Document = document) => {
  let activeTouch: ActiveTouch | null = null
  let pendingClick: ReturnType<typeof setTimeout> | null = null

  const clearPendingClick = () => {
    if (pendingClick !== null) {
      clearTimeout(pendingClick)
      pendingClick = null
    }
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' || event.isPrimary === false || event.button !== 0) return

    const target = event.target instanceof HTMLElement ? event.target : null
    if (!target || target.closest('[data-tauri-drag-region]')) return

    clearPendingClick()
    activeTouch = {
      pointerId: event.pointerId,
      target,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
    }
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (!activeTouch || activeTouch.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - activeTouch.clientX, event.clientY - activeTouch.clientY) > TOUCH_TAP_MOVE_TOLERANCE) {
      activeTouch.moved = true
    }
  }

  const handlePointerUp = (event: PointerEvent) => {
    if (!activeTouch || activeTouch.pointerId !== event.pointerId) return

    const touch = activeTouch
    activeTouch = null
    if (touch.moved || !touch.target.isConnected || touch.target.closest(':disabled')) return

    clearPendingClick()
    pendingClick = setTimeout(() => {
      pendingClick = null
      touch.target.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: event.clientX,
        clientY: event.clientY,
        detail: 1,
      }))
    }, NATIVE_CLICK_GRACE_MS)
  }

  const handlePointerCancel = (event: PointerEvent) => {
    if (activeTouch?.pointerId === event.pointerId) activeTouch = null
  }

  const handleNativeClick = () => clearPendingClick()

  root.addEventListener('pointerdown', handlePointerDown, true)
  root.addEventListener('pointermove', handlePointerMove, true)
  root.addEventListener('pointerup', handlePointerUp, true)
  root.addEventListener('pointercancel', handlePointerCancel, true)
  root.addEventListener('click', handleNativeClick, true)

  return () => {
    clearPendingClick()
    activeTouch = null
    root.removeEventListener('pointerdown', handlePointerDown, true)
    root.removeEventListener('pointermove', handlePointerMove, true)
    root.removeEventListener('pointerup', handlePointerUp, true)
    root.removeEventListener('pointercancel', handlePointerCancel, true)
    root.removeEventListener('click', handleNativeClick, true)
  }
}
