import { describe, expect, it } from 'vitest';
import { createLightPlaybackClock } from './lightPlaybackClock';

describe('light lyric playback clock', () => {
  it('accepts samples before the first cue when no local animation frames are running', () => {
    let now = 0;
    const clock = createLightPlaybackClock(-1, () => now);
    now = 500;
    expect(clock.sync(-0.5, true, false, false)).toBe(true);
    expect(clock.current(false)).toBe(-0.5);
    now = 1200;
    expect(clock.sync(0.2, true, false, false)).toBe(true);
    expect(clock.current(false)).toBe(0.2);
  });

  it('forces sub-threshold seeks and delay changes in both directions', () => {
    let now = 0;
    const clock = createLightPlaybackClock(10, () => now);
    now = 1000;
    expect(clock.current(true)).toBe(11);
    expect(clock.sync(11.1, true)).toBe(false);
    expect(clock.sync(11.1, true, true)).toBe(true);
    expect(clock.current(true)).toBe(11.1);
    expect(clock.sync(11, true, true)).toBe(true);
    expect(clock.current(true)).toBe(11);
  });

  it('does not advance lyrics early during a positive audio-delay preroll', () => {
    let now = 0;
    const clock = createLightPlaybackClock(0 - 1, () => now);
    expect(clock.current(true)).toBe(-1);
    now = 500;
    expect(clock.current(true)).toBe(-0.5);
    now = 999;
    expect(clock.current(true)).toBeLessThan(0);
    now = 1000;
    expect(clock.current(true)).toBe(0);
    now = 1100;
    expect(clock.current(true)).toBeCloseTo(0.1);
  });

  it('keeps ordinary smooth ticks, freezes paused values, and reanchors on resume', () => {
    let now = 0;
    const clock = createLightPlaybackClock(5, () => now);
    now = 500;
    expect(clock.sync(5.4, true)).toBe(false);
    expect(clock.current(true)).toBe(5.5);
    expect(clock.sync(5.4, false)).toBe(true);
    now = 60000;
    expect(clock.current(false)).toBe(5.4);
    clock.sync(5.4, true, true);
    now += 500;
    expect(clock.current(true)).toBeCloseTo(5.9);
  });
});
