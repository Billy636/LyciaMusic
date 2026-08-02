import { describe, expect, it } from 'vitest'

import touchClickSupport from './touchClickSupport.ts?raw'
import main from '../main.ts?raw'

describe('touch click compatibility', () => {
  it('installs a pointer-based tap fallback at application startup', () => {
    expect(main).toContain('installTouchClickSupport()')
    expect(touchClickSupport).toContain("root.addEventListener('pointerdown'")
    expect(touchClickSupport).toContain("root.addEventListener('pointerup'")
    expect(touchClickSupport).toContain("new MouseEvent('click'")
  })

  it('does not turn mouse input, dragging, or window drag regions into fallback clicks', () => {
    expect(touchClickSupport).toContain('event.isPrimary === false || event.button !== 0')
    expect(touchClickSupport).toContain('TAP_MOVE_TOLERANCE')
    expect(touchClickSupport).toContain("current.hasAttribute('data-tauri-drag-region')")
  })

  it('covers mouse-compatible touch devices and matches native clicks before cancelling the fallback', () => {
    expect(touchClickSupport).toContain('NATIVE_CLICK_GRACE_MS')
    expect(touchClickSupport).not.toContain("event.pointerType === 'mouse'")
    expect(touchClickSupport).toContain('targetsMatch(target, pendingClick.target)')
    expect(touchClickSupport).toContain("root.addEventListener('click', handleNativeClick, true)")
  })

  it('accepts SVG event targets and interactive controls nested inside drag regions', () => {
    expect(touchClickSupport).toContain('item instanceof Element')
    expect(touchClickSupport).toContain('current.matches(INTERACTIVE_SELECTOR)')
  })
})
