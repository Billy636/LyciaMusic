import { describe, expect, it, vi } from 'vitest';

import { setMainWindowRenderingSnapshot, useRenderingPower } from './renderingPower';
import { toggleMainWindowVisibility } from './mainWindowVisibility';

const createWindow = (visible: boolean, minimized: boolean) => ({
  isVisible: vi.fn().mockResolvedValue(visible),
  isMinimized: vi.fn().mockResolvedValue(minimized),
  minimize: vi.fn().mockResolvedValue(undefined),
  show: vi.fn().mockResolvedValue(undefined),
  unminimize: vi.fn().mockResolvedValue(undefined),
  setFocus: vi.fn().mockResolvedValue(undefined),
});

describe('main window visibility toggle', () => {
  it('minimizes a visible main window and enters low-power rendering', async () => {
    setMainWindowRenderingSnapshot({
      documentHidden: false,
      windowFocused: true,
      windowVisible: true,
      windowMinimized: false,
      miniMode: false,
    });
    const mainWindow = createWindow(true, false);

    await expect(toggleMainWindowVisibility(mainWindow as never)).resolves.toBe('minimized');

    expect(mainWindow.minimize).toHaveBeenCalledOnce();
    expect(mainWindow.show).not.toHaveBeenCalled();
    expect(useRenderingPower().isMainWindowLowPower.value).toBe(true);
  });

  it('restores and focuses a minimized main window', async () => {
    const mainWindow = createWindow(true, true);

    await expect(toggleMainWindowVisibility(mainWindow as never)).resolves.toBe('restored');

    expect(mainWindow.show).toHaveBeenCalledOnce();
    expect(mainWindow.unminimize).toHaveBeenCalledOnce();
    expect(mainWindow.setFocus).toHaveBeenCalledOnce();
    expect(mainWindow.minimize).not.toHaveBeenCalled();
  });

  it('shows a hidden, non-minimized main window without an unnecessary unminimize', async () => {
    const mainWindow = createWindow(false, false);

    await expect(toggleMainWindowVisibility(mainWindow as never)).resolves.toBe('restored');

    expect(mainWindow.show).toHaveBeenCalledOnce();
    expect(mainWindow.unminimize).not.toHaveBeenCalled();
    expect(mainWindow.setFocus).toHaveBeenCalledOnce();
  });
});
