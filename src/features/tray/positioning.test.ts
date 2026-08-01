import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { availableMonitors } from '@tauri-apps/api/window';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTrayMenuPosition } from './positioning';
import { TRAY_MENU_WINDOW_HEIGHT } from './actions';

vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: vi.fn(),
}));

describe('resolveTrayMenuPosition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly positions window directly above tray icon click with 6px gap under 100% scale', async () => {
    vi.mocked(availableMonitors).mockResolvedValue([
      {
        name: 'Display 1',
        scaleFactor: 1,
        position: new PhysicalPosition(0, 0),
        size: new PhysicalSize(1920, 1080),
        workArea: {
          position: new PhysicalPosition(0, 0),
          size: new PhysicalSize(1920, 1032), // taskbar at bottom, 48px high
        },
      } as any,
    ]);

    // Tray click inside taskbar (y = 1056)
    // preferAboveY = 1056 - 273 - 6 = 777
    const result = await resolveTrayMenuPosition({ x: 1800, y: 1056 });

    expect(result.position.y).toBe(777);
    expect(result.position.y + TRAY_MENU_WINDOW_HEIGHT).toBe(1050); // 6px above cursor at 1056
  });

  it('correctly positions window above tray icon under 150% high DPI scale', async () => {
    vi.mocked(availableMonitors).mockResolvedValue([
      {
        name: 'Display 1',
        scaleFactor: 1.5,
        position: new PhysicalPosition(0, 0),
        size: new PhysicalSize(2880, 1620),
        workArea: {
          position: new PhysicalPosition(0, 0),
          size: new PhysicalSize(2880, 1548),
        },
      } as any,
    ]);

    // Physical click inside taskbar: y = 1584 -> clickY = 1056 logical px
    // preferAboveY = 1056 - 273 - 6 = 777 logical px
    const result = await resolveTrayMenuPosition({ x: 2700, y: 1584 });

    expect(result.position.y).toBe(777);
    expect(result.position.y + TRAY_MENU_WINDOW_HEIGHT).toBe(1050);
  });
});
