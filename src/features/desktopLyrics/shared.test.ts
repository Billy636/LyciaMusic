import { describe, expect, it } from 'vitest';

import {
  DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT,
  DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH,
  DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
  DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
  restoreDesktopLyricsBounds,
} from './shared';

describe('desktop lyrics saved bounds', () => {
  it.each([
    { x: 40, y: 1030, width: 900, height: 280 },
    { x: -1400, y: 1200, width: 900, height: 280 },
    { x: 8000, y: -3000, width: 900, height: 280 },
    { x: 14, y: 18, width: 800, height: 200 },
  ])('preserves taskbar, off-screen and near-edge coordinates: %o', bounds => {
    expect(restoreDesktopLyricsBounds(bounds)).toEqual(bounds);
  });

  it('does not shrink valid physical bounds from a high-DPI renderer', () => {
    const bounds = { x: -2200, y: 1600, width: 2880, height: 2000 };
    expect(restoreDesktopLyricsBounds(bounds)).toEqual(bounds);
  });

  it('retains the minimum size while leaving negative coordinates unchanged', () => {
    expect(restoreDesktopLyricsBounds({ x: -120, y: -80, width: 200, height: 60 })).toEqual({
      x: -120,
      y: -80,
      width: DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
      height: DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
    });
  });

  it('uses default dimensions for invalid or missing stored sizes', () => {
    expect(restoreDesktopLyricsBounds({ x: -1400.2, y: 1200.8, width: Number.NaN })).toEqual({
      x: -1400,
      y: 1201,
      width: DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH,
      height: DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT,
    });
  });

  it.each([{ x: Number.NaN, y: 0 }, { x: 0, y: Infinity }, { y: 0 }])('rejects invalid coordinates: %o', bounds => {
    expect(restoreDesktopLyricsBounds(bounds)).toBeNull();
  });
});
