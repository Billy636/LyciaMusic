import { describe, expect, it } from 'vitest';

import { withAlignedRomanization } from './romanization';
import type { NativeAmlLyricLine, NativeAmlLyricWord } from './ttml';

const word = (text: string, startTime: number, endTime: number): NativeAmlLyricWord => ({
  word: text, startTime, endTime,
});

function line(words: NativeAmlLyricWord[], romanWords: NativeAmlLyricWord[]): NativeAmlLyricLine {
  return {
    startTime: 1000, endTime: 3000, words, romanWords,
    translatedLyric: '译文', romanLyric: '', isBG: false, isDuet: false,
  };
}

describe('lossless romanization projection onto official AMLL words', () => {
  it('aggregates every fragment of one-to-many timing without changing either source grid', () => {
    const source = line([word('本', 1000, 2000), word('当', 2000, 3000)], [
      word('ho ', 1000, 1500), word('n ', 1500, 1999),
      word('to ', 2000, 2500), word('u ', 2501, 2999),
    ]);
    source.words[0].ruby = [{ word: 'ほん', startTime: 1000, endTime: 2000 }];
    source.words[0].obscene = true;
    source.isBG = true;
    source.isDuet = true;
    const before = structuredClone(source);
    const issues: string[] = [];
    const result = withAlignedRomanization(source, issues);

    expect(result.words.map((item) => item.romanWord)).toEqual(['ho n ', 'to u ']);
    expect(result.romanLyric).toBe('');
    expect(result.romanWords).toEqual(before.romanWords);
    expect(result.words.map(({ romanWord: _, ...rest }) => rest)).toEqual(before.words);
    expect(result).toMatchObject({ translatedLyric: '译文', isBG: true, isDuet: true });
    expect(source).toEqual(before);
    expect(issues).toEqual([]);
  });

  it('leaves uncovered main words blank instead of shifting later syllables', () => {
    const result = withAlignedRomanization(line([
      word('き', 1000, 1500), word('ゃ', 1500, 2000), word('と', 2000, 3000),
    ], [word('kya ', 1000, 1500), word('to', 2000, 3000)]));
    expect(result.words.map((item) => item.romanWord)).toEqual(['kya ', '', 'to']);
    expect(result.romanLyric).toBe('');
  });

  it('does not attach a long fragment to the preceding word over a 1ms sliver', () => {
    const result = withAlignedRomanization(line([word('の', 1000, 1037), word('世', 1037, 1653)], [
      word('no ', 1000, 1036), word('se ', 1036, 1652),
    ]));
    expect(result.words.map((item) => item.romanWord)).toEqual(['no ', 'se ']);
    expect(result.romanLyric).toBe('');
  });

  it('accepts at most 2ms boundary jitter without altering timestamps', () => {
    const result = withAlignedRomanization(line([word('甲', 1000, 2000), word('乙', 2000, 3000)], [
      word('a ', 998, 2002), word('b', 1998, 3002),
    ]));
    expect(result.words.map((item) => item.romanWord)).toEqual(['a ', 'b']);
    expect(result.romanWords?.[0].startTime).toBe(998);
    expect(result.words[0].startTime).toBe(1000);
  });

  it('preserves repeated syllables and whitespace, including a zero-duration separator', () => {
    const result = withAlignedRomanization(line([
      word('甲', 1000, 2000), word(' ', 2000, 2000), word('乙', 2000, 3000),
    ], [
      word(' ', 1000, 1000), word('ha', 1000, 1500), word(' ha', 1500, 2000),
      word('  ', 2000, 2000), word('ha ', 2000, 3000),
    ]));
    expect(result.words.map((item) => item.romanWord)).toEqual([' ha ha  ', '', 'ha ']);
    expect(result.words.map((item) => item.romanWord).join('')).toBe(' ha ha  ha ');
    expect(result.words[1]).toMatchObject({ word: ' ', startTime: 2000, endTime: 2000 });
  });

  it.each([
    ['significant cross-word timing', [word('kan ', 1000, 1400), word('ji', 1400, 2700)]],
    ['more than 2ms drift', [word('a ', 1000, 2003), word('b', 2003, 3000)]],
    ['disjoint timestamp near a boundary', [word('a ', 1000, 2000), word('b', 3001, 3002)]],
    ['unmatched suffix', [word('a ', 1000, 1500), word('b', 4000, 4500)]],
    ['reversed source order', [word('b ', 2000, 3000), word('a', 1000, 2000)]],
    ['negative start', [word('a ', -1, 2000), word('b', 2000, 3000)]],
    ['NaN start', [word('a ', Number.NaN, 2000), word('b', 2000, 3000)]],
    ['infinite end', [word('a ', 1000, Number.POSITIVE_INFINITY), word('b', 2000, 3000)]],
    ['reversed interval', [word('a ', 1800, 1500), word('b', 2000, 3000)]],
    ['zero-duration ambiguous boundary', [word('a ', 1000, 1500), word('b', 2000, 2000)]],
  ] as const)('keeps the full auxiliary and clears partial inline output for %s', (_name, romanWords) => {
    const source = line([
      { ...word('漢', 1000, 2000), romanWord: 'old partial' }, word('字', 2000, 3000),
    ], [...romanWords]);
    const issues: string[] = [];
    const result = withAlignedRomanization(source, issues);
    expect(result.romanLyric).toBe(romanWords.map((item) => item.word).join(''));
    expect(result.words.every((item) => !item.romanWord)).toBe(true);
    expect(result.romanWords).toEqual(romanWords);
    expect(issues).toEqual(['逐字音译无法可靠对齐，已保留完整整行音译。']);
    expect(source.words[0].romanWord).toBe('old partial');
  });

  it('does not lose romanization on whitespace main words', () => {
    const result = withAlignedRomanization(line([
      word('甲', 1000, 1500), word(' ', 1500, 2000), word('乙', 2000, 3000),
    ], [word('a ', 1000, 1500), word('b', 1500, 2000)]));
    expect(result.romanLyric).toBe('a b');
    expect(result.words.every((item) => !item.romanWord)).toBe(true);
  });

  it('does not guess between two overlapping main words', () => {
    const result = withAlignedRomanization(line([word('甲', 1000, 3000), word('乙', 1000, 3000)], [
      word('a ', 1000, 1500), word('b', 2000, 3000),
    ]));
    expect(result.romanLyric).toBe('a b');
    expect(result.words.every((item) => !item.romanWord)).toBe(true);
  });

  it('keeps a zero-duration fragment when it has exactly one owner, without extending it', () => {
    const result = withAlignedRomanization(line([word('甲', 1000, 2000), word('乙', 2000, 3000)], [
      word('a ', 1200, 1200), word('b', 2000, 3000),
    ]));
    expect(result.words.map((item) => item.romanWord)).toEqual(['a ', 'b']);
    expect(result.romanWords?.[0]).toMatchObject({ startTime: 1200, endTime: 1200 });
  });

  it('retains plain whole-line romanization for the official non-dynamic renderer', () => {
    const issues: string[] = [];
    const result = withAlignedRomanization(line([word('整行', 1000, 3000)], [
      word('whole ', 1000, 2000), word('line', 2000, 3000),
    ]), issues);
    expect(result.romanLyric).toBe('whole line');
    expect(result.words[0].romanWord).toBeUndefined();
    expect(issues).toEqual([]);
    const singleAuxiliary = withAlignedRomanization(line([word('整', 1000, 2000), word('行', 2000, 3000)], [
      word('whole line', 1000, 3000),
    ]), issues);
    expect(singleAuxiliary.romanLyric).toBe('whole line');
    expect(issues).toEqual([]);
  });
});
