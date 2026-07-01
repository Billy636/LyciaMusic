import { describe, expect, it } from 'vitest';

import {
  hideMainWindowToTray,
  resolveMainWindowLowPower,
  setMainWindowRenderingSnapshot,
  useRenderingPower,
  type MainWindowRenderingSnapshot,
} from './renderingPower';

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

  it('uses low power rendering when the document is hidden', () => {
    expect(resolveMainWindowLowPower({ ...foregroundSnapshot(), documentHidden: true })).toBe(true);
  });

  it('enters low power immediately after hiding the main window to tray', async () => {
    setMainWindowRenderingSnapshot(foregroundSnapshot());
    const appWindow = {
      hide: async () => undefined,
    };

    await hideMainWindowToTray(appWindow as never);

    expect(useRenderingPower().isMainWindowLowPower.value).toBe(true);
    expect(useRenderingPower().mainWindowRenderingSnapshot.value).toMatchObject({
      documentHidden: true,
      windowFocused: false,
      windowVisible: false,
    });
  });
});
