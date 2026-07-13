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
    expect(touchClickSupport).toContain("event.pointerType === 'mouse'")
    expect(touchClickSupport).toContain('TOUCH_TAP_MOVE_TOLERANCE')
    expect(touchClickSupport).toContain("closest('[data-tauri-drag-region]')")
  })

  it('waits for and prefers the native click to avoid duplicate actions', () => {
    expect(touchClickSupport).toContain('NATIVE_CLICK_GRACE_MS')
    expect(touchClickSupport).toContain("root.addEventListener('click', handleNativeClick, true)")
  })
})
