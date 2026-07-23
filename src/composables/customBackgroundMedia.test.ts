import { describe, expect, it } from 'vitest';

import {
  isCustomBackgroundVideoWithinLimit,
  optimizeCustomBackgroundRenderTarget,
  resolveCustomBackgroundMediaType,
} from './customBackgroundMedia';

describe('custom background media', () => {
  it('recognizes supported video extensions case-insensitively', () => {
    expect(resolveCustomBackgroundMediaType('C:\\wallpapers\\scene.MP4')).toBe('video');
    expect(resolveCustomBackgroundMediaType('C:\\wallpapers\\scene.webm')).toBe('video');
  });

  it('keeps legacy custom backgrounds as images', () => {
    expect(resolveCustomBackgroundMediaType('C:\\wallpapers\\legacy.jpg')).toBe('image');
    expect(resolveCustomBackgroundMediaType('')).toBe('image');
  });

  it('prefers the persisted media type over the file extension', () => {
    expect(resolveCustomBackgroundMediaType('background.bin', 'video')).toBe('video');
  });
});

describe('custom background image render target', () => {
  const highDpiTarget = { width: 2048, height: 1280, devicePixelRatio: 2 };

  it('uses logical screen pixels once blur hides high-DPI detail', () => {
    expect(optimizeCustomBackgroundRenderTarget(highDpiTarget, 20)).toEqual({
      width: 1024,
      height: 640,
      devicePixelRatio: 1,
    });
  });

  it('keeps physical screen pixels for sharp backgrounds', () => {
    expect(optimizeCustomBackgroundRenderTarget(highDpiTarget, 0)).toBe(highDpiTarget);
  });
});

describe('custom background video limits', () => {
  it('accepts standard landscape and portrait 4K media', () => {
    expect(isCustomBackgroundVideoWithinLimit(3840, 2160)).toBe(true);
    expect(isCustomBackgroundVideoWithinLimit(2160, 3840)).toBe(true);
  });

  it('rejects media whose edge or pixel count exceeds 4K', () => {
    expect(isCustomBackgroundVideoWithinLimit(4096, 2160)).toBe(false);
    expect(isCustomBackgroundVideoWithinLimit(3840, 2161)).toBe(false);
    expect(isCustomBackgroundVideoWithinLimit(7680, 4320)).toBe(false);
  });
});
