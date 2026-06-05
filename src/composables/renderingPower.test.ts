import { describe, expect, it } from 'vitest';

import { resolveMainWindowLowPower, type MainWindowRenderingSnapshot } from './renderingPower';

const foregroundSnapshot = (): MainWindowRenderingSnapshot => ({
  documentHidden: false,
  windowFocused: true,
  windowVisible: true,
  windowMinimized: false,
  miniMode: false,
});

describe('main window rendering power', () => {
  it('keeps full rendering when the main window is foreground and visible', () => {
    expect(resolveMainWindowLowPower(foregroundSnapshot())).toBe(false);
  });

  it('uses low power rendering when the main window is not visible', () => {
    expect(resolveMainWindowLowPower({ ...foregroundSnapshot(), windowVisible: false })).toBe(true);
    expect(resolveMainWindowLowPower({ ...foregroundSnapshot(), windowMinimized: true })).toBe(true);
    expect(resolveMainWindowLowPower({ ...foregroundSnapshot(), miniMode: true })).toBe(true);
  });

  it('keeps full rendering when the main window is visible but not focused', () => {
    expect(resolveMainWindowLowPower({ ...foregroundSnapshot(), windowFocused: false })).toBe(false);
  });

  it('keeps full rendering when document visibility changes but the main window remains visible', () => {
    expect(resolveMainWindowLowPower({ ...foregroundSnapshot(), documentHidden: true })).toBe(false);
  });
});
