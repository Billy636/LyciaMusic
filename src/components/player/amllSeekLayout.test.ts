import { describe, expect, it, vi } from 'vitest';

import { getPlaybackSeekSecondsForAmlLine, syncAmlLyricSeekLayout } from './amllSeekLayout';

describe('syncAmlLyricSeekLayout', () => {
  it('seeks using official APIs, leaving group selection and layout to AMLL', () => {
    const calls: string[] = [];
    const player = {
      resetScroll: vi.fn(() => calls.push('resetScroll')),
      setCurrentTime: vi.fn((_time: number, _isSeek?: boolean) => calls.push('setCurrentTime')),
      update: vi.fn((_delta?: number) => calls.push('update')),
    };

    syncAmlLyricSeekLayout(player, 12345.9);

    expect(player.resetScroll).toHaveBeenCalledOnce();
    expect(player.setCurrentTime).toHaveBeenCalledWith(12345, true);
    expect(player.update).toHaveBeenCalledWith(0);
    expect(calls).toEqual([
      'resetScroll',
      'setCurrentTime',
      'update',
    ]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -20])('normalizes invalid seek time %s', (time) => {
    const player = { resetScroll: vi.fn(), setCurrentTime: vi.fn(), update: vi.fn() };
    syncAmlLyricSeekLayout(player, time);
    expect(player.setCurrentTime).toHaveBeenCalledWith(0, true);
  });
});

describe('getPlaybackSeekSecondsForAmlLine', () => {
  it('adds lyrics audio delay to the clicked AMLL line time', () => {
    expect(getPlaybackSeekSecondsForAmlLine(12345, 0.25)).toBe(12.595);
  });

  it('clamps negative seek targets to zero', () => {
    expect(getPlaybackSeekSecondsForAmlLine(100, -1)).toBe(0);
  });
});
