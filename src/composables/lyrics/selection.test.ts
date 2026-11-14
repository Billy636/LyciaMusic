import { describe, expect, it } from 'vitest';
import type { LyricLine } from './types';
import { findDisplayLyricIndex, foregroundLyricLines } from './selection';

const line = (time: number, endTime: number, text: string, isBG = false): LyricLine => ({
  time, endTime, text, isBG, translation: '', romaji: '',
});

describe('compact lyric cue selection', () => {
  it('keeps first-line preview and last-line hold even when true source ends exist', () => {
    const lines = [line(1, 2, 'One'), line(4, 5, 'Two')];
    expect(findDisplayLyricIndex(lines, 0)).toBe(-1);
    expect(findDisplayLyricIndex(lines, 0, true)).toBe(0);
    expect(findDisplayLyricIndex(lines, 3)).toBe(0);
    expect(findDisplayLyricIndex(lines, 100)).toBe(1);
  });

  it('selects explicit blank cues without erasing same-time ongoing text', () => {
    const lines = [line(1, 5, 'One'), line(1, 2, ''), line(4, 8, ' '), line(8, 9, 'Two')];
    expect(findDisplayLyricIndex(lines, 3)).toBe(0);
    expect(findDisplayLyricIndex(lines, 4)).toBe(2);
    expect(findDisplayLyricIndex(lines, 8)).toBe(3);
  });

  it('ignores background-only cues when a foreground exists and protects overlapping voices', () => {
    const lines = [line(0, 6, 'BG', true), line(1, 8, 'Long main'), line(2, 3, 'Short overlap'), line(3, 9, 'BG', true)];
    expect(findDisplayLyricIndex(lines, 0, true)).toBe(1);
    expect(findDisplayLyricIndex(lines, 2.5)).toBe(2);
    expect(findDisplayLyricIndex(lines, 4)).toBe(1);
    expect(foregroundLyricLines(lines)).toEqual([lines[1], lines[2]]);
    expect(findDisplayLyricIndex([lines[0]], 1)).toBe(0);
  });
});
