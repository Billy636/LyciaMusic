import { describe, expect, it } from 'vitest';

import { getAmlLineSourceStartTime } from './lyricPlaybackTiming';
import { getPlaybackSeekSecondsForAmlLine } from './amllSeekLayout';

describe('lyric click source timing', () => {
  it('seeks to the source start instead of AMLL display lead-in', () => {
    const start = getAmlLineSourceStartTime({ startTime: 500, sourceStartTimeMs: 1200 });
    expect(start).toBe(1200);
    expect(getPlaybackSeekSecondsForAmlLine(start, 0.2)).toBe(1.4);
  });

  it('preserves a source start at zero and clamps a negative playback offset', () => {
    const start = getAmlLineSourceStartTime({ startTime: 500, sourceStartTimeMs: 0 });
    expect(start).toBe(0);
    expect(getPlaybackSeekSecondsForAmlLine(start, -0.2)).toBe(0);
  });

  it('falls back safely when source timing is unavailable or invalid', () => {
    expect(getAmlLineSourceStartTime({ startTime: 1500 })).toBe(1500);
    expect(getAmlLineSourceStartTime({ startTime: 1500, sourceStartTimeMs: NaN })).toBe(1500);
    expect(getAmlLineSourceStartTime({ startTime: 1500, sourceStartTimeMs: -1 })).toBe(1500);
    expect(getAmlLineSourceStartTime({ startTime: NaN })).toBe(0);
    expect(getAmlLineSourceStartTime({ startTime: -500 })).toBe(0);
  });
});
