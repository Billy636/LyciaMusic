import { describe, expect, it } from 'vitest';

import source from './TitleBar.vue?raw';

describe('TitleBar close to tray', () => {
  it('updates rendering power state when hiding the main window', () => {
    expect(source).toContain('hideMainWindowToTray');
    expect(source).not.toContain('await appWindow.hide()');
  });

  it('starts native window dragging from primary pointer input without swallowing controls', () => {
    expect(source).toContain('data-window-drag-handle');
    expect(source).toContain('@pointerdown="handleTitleBarPointerDown"');
    expect(source).toContain('target.closest(TITLE_BAR_CONTROL_SELECTOR)');
    expect(source).toContain('appWindow.startDragging()');
    expect(source).not.toContain('data-tauri-drag-region');
  });

  it('keeps window controls outside the pointer drag path', () => {
    expect(source).toContain('aria-label="最小化"');
    expect(source).toContain('aria-label="最大化或还原"');
    expect(source).toContain('@click.stop="minimize"');
    expect(source).toContain('@click.stop="toggleMaximize"');
  });
});
