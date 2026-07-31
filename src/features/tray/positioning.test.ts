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

  it('correctly calculates logical position above taskbar with 8px margin under 100% scale', async () => {
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
    const result = await resolveTrayMenuPosition({ x: 1800, y: 1056 });

    // maxY = 1032 - 276 - 8 = 748
    // Window bottom = 748 + 276 = 1024, which is 8px above workArea bottom (1032)
    expect(result.position.y).toBe(748);
    expect(result.position.y + TRAY_MENU_WINDOW_HEIGHT).toBe(1024);
  });

  it('correctly calculates position and matches monitor when clicking in taskbar under 150% high DPI scale', async () => {
    vi.mocked(availableMonitors).mockResolvedValue([
      {
        name: 'Display 1',
        scaleFactor: 1.5,
        position: new PhysicalPosition(0, 0),
        size: new PhysicalSize(2880, 1620),
        workArea: {
          position: new PhysicalPosition(0, 0),
          size: new PhysicalSize(2880, 1548), // taskbar 72 physical px high (48 logical px)
        },
      } as any,
    ]);

    // Physical click inside taskbar: y = 1584
    // Logical work area height = 1548 / 1.5 = 1032
    // maxY = 1032 - 276 - 8 = 748 logical px
    const result = await resolveTrayMenuPosition({ x: 2700, y: 1584 });

    expect(result.position.y).toBe(748);
    expect(result.position.y + TRAY_MENU_WINDOW_HEIGHT).toBe(1024); // 8 logical px above taskbar
  });
});
