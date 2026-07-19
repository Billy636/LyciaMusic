import { describe, expect, it } from 'vitest';

import { resolveCustomBackgroundMediaType } from './customBackgroundMedia';

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
