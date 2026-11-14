import { describe, expect, it } from 'vitest';

import { getCurrentLyricDisplayLines } from './converters';
import { amlLineToLegacyLyricLine, applyNativeAmlDisplaySettings } from './ttml';
import type { NativeAmlLyricLine } from './ttml';

function nativeLine(): NativeAmlLyricLine {
  return {
    startTime: 1000, endTime: 3500,
    translatedLyric: '你好', romanLyric: '',
    isBG: false, isDuet: true,
    words: [
      { word: 'こん', startTime: 1000, endTime: 1500, romanWord: 'kon' },
      {
        word: 'にちは', startTime: 2000, endTime: 3200, romanWord: 'nichiwa',
        ruby: [{ word: '注音', startTime: 2050, endTime: 3150 }],
      },
    ],
  };
}

describe('lyrics display projections', () => {
  it('keeps source line/word endings and real gaps when converting to seconds', () => {
    const source = nativeLine();
    const before = structuredClone(source);
    const result = amlLineToLegacyLyricLine(source);

    expect(result.time).toBe(1);
    expect(result.endTime).toBe(3.5);
    expect(result.words?.map((word) => [word.start, word.end])).toEqual([[1, 1.5], [2, 3.2]]);
    expect(result.words?.[1].ruby).toEqual([{ text: '注音', start: 2.05, end: 3.15 }]);
    expect(result.isDuet).toBe(true);
    expect(source).toEqual(before);
  });

  it('preserves overlaps instead of truncating one vocalist at the next start', () => {
    const lines = [nativeLine(), { ...nativeLine(), startTime: 1800, endTime: 4000 }];
    const displayed = lines.map(amlLineToLegacyLyricLine);
    expect(displayed.map((line) => line.endTime)).toEqual([3.5, 4]);
    expect(lines[0].endTime).toBe(3500);
  });

  it('shows inline romaji on auxiliary surfaces even without a separate roman line', () => {
    const display = getCurrentLyricDisplayLines(amlLineToLegacyLyricLine(nativeLine()), true, true);
    expect(display.map((line) => line.kind)).toEqual(['main', 'romaji', 'translation']);
    expect(display[1].text).toContain('kon');
    expect(display[1].text).toContain('nichiwa');
    expect(display[1].words?.map((word) => [word.start, word.end])).toEqual([[1, 1.5], [2, 3.2]]);
  });

  it('applies display switches without mutating the canonical words and translation', () => {
    const source = nativeLine();
    const hidden = applyNativeAmlDisplaySettings([source], false, false)[0];
    expect(hidden.translatedLyric).toBe('');
    expect(hidden.words.every((word) => !word.romanWord)).toBe(true);
    expect(source.translatedLyric).toBe('你好');
    expect(source.words[0].romanWord).toBe('kon');
    const display = getCurrentLyricDisplayLines(amlLineToLegacyLyricLine(source), false, false);
    expect(display.map((line) => line.kind)).toEqual(['main']);
  });
});
