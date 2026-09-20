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

  it('positions window flush with the work area above a bottom taskbar under 100% scale', async () => {
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
    // preferAboveY = 1056 - 273 - 6 = 777, clamped to maxY = 1032 - 273 - 6 = 753
    // so the menu bottom (1026) stays 6px above the taskbar instead of covering it
    const result = await resolveTrayMenuPosition({ x: 1800, y: 1056 });

    expect(result.position.y).toBe(753);
    expect(result.position.y + TRAY_MENU_WINDOW_HEIGHT).toBe(1026);
  });

  it('positions window flush with the work area above a bottom taskbar under 150% high DPI scale', async () => {
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
    // preferAboveY = 777, clamped to logical maxY = 1548/1.5 - 273 - 6 = 753
    const result = await resolveTrayMenuPosition({ x: 2700, y: 1584 });

    expect(result.position.y).toBe(753);
    expect(result.position.y + TRAY_MENU_WINDOW_HEIGHT).toBe(1026);
  });

  it('drops the window below a top taskbar instead of covering it', async () => {
    vi.mocked(availableMonitors).mockResolvedValue([
      {
        name: 'Display 1',
        scaleFactor: 1,
        position: new PhysicalPosition(0, 0),
        size: new PhysicalSize(1920, 1080),
        workArea: {
          position: new PhysicalPosition(0, 48), // taskbar at top, 48px high
          size: new PhysicalSize(1920, 1032),
        },
      } as any,
    ]);

    // Tray click inside the top taskbar (y = 30): opening above is impossible and
    // falling back must clear the taskbar, so the menu top clamps to workArea top + 6
    const result = await resolveTrayMenuPosition({ x: 1800, y: 30 });

    expect(result.position.y).toBe(54);
    expect(result.position.y).toBeGreaterThanOrEqual(48);
  });
});
