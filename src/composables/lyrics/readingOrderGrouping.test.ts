import { describe, expect, it } from 'vitest';

import { groupLyricsByReadingOrder as groupLrcByReadingOrder, type ReadingOrderLyricEntry } from './readingOrderGrouping';
import type { LyricsReadingOrder } from './types';
import type { NativeAmlLyricLine } from './ttml';

const cases: Array<[LyricsReadingOrder, number, number, number]> = [
  ['main-translation-roman', 0, 1, 2],
  ['main-roman-translation', 0, 2, 1],
  ['roman-main-translation', 1, 2, 0],
  ['roman-translation-main', 2, 1, 0],
  ['translation-main-roman', 1, 0, 2],
  ['translation-roman-main', 2, 0, 1],
];

function line(text: string, start = 1000, end = 3000): NativeAmlLyricLine {
  return {
    startTime: start, endTime: end,
    words: [{ word: text, startTime: start, endTime: end }],
    translatedLyric: '', romanLyric: '', isBG: false, isDuet: false,
  };
}

describe('manual reading order is a positional convention, not language guessing', () => {
  it.each(cases)('maps all three roles for %s', (readingOrder, main, translation, roman) => {
    const texts = ['English', 'French', 'Spanish'];
    const result = groupLrcByReadingOrder(texts.map((text) => ({ line: line(text) })), readingOrder);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].words[0].word).toBe(texts[main]);
    expect(result.lines[0].translatedLyric).toBe(texts[translation]);
    expect(result.lines[0].romanWords?.[0].word).toBe(texts[roman]);
    expect(result.issues).toEqual([]);
  });

  it.each(cases)('removes only roman from two unlabelled rows for %s', (readingOrder, main, translation) => {
    const result = groupLrcByReadingOrder([{ line: line('first') }, { line: line('second') }], readingOrder);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].words[0].word).toBe(main < translation ? 'first' : 'second');
    expect(result.lines[0].translatedLyric).toBe(main < translation ? 'second' : 'first');
    expect(result.lines[0].romanWords).toBeUndefined();
    expect(result.lines[0].romanLyric).toBe('');
  });

  it.each(cases)('keeps an unlabelled single row as main for %s', (readingOrder) => {
    const result = groupLrcByReadingOrder([{ line: line('Only lyric') }], readingOrder);
    expect(result.lines[0].words[0].word).toBe('Only lyric');
    expect(result.lines[0].translatedLyric).toBe('');
    expect(result.lines[0].romanWords).toBeUndefined();
  });

  it('locks a partial explicit translation and fills remaining roles in selected order', () => {
    const result = groupLrcByReadingOrder([
      { line: line('Translation'), role: 'translation' },
      { line: line('Roman') },
      { line: line('Main') },
    ], 'roman-main-translation');
    expect(result.lines[0].words[0].word).toBe('Main');
    expect(result.lines[0].translatedLyric).toBe('Translation');
    expect(result.lines[0].romanWords?.[0].word).toBe('Roman');
  });

  it('allows explicitly labelled romanization in a pair without adding a two-line option', () => {
    const result = groupLrcByReadingOrder([
      { line: line('Roman'), role: 'roman' }, { line: line('Main') },
    ], 'translation-main-roman');
    expect(result.lines[0].words[0].word).toBe('Main');
    expect(result.lines[0].romanWords?.[0].word).toBe('Roman');
    expect(result.lines[0].translatedLyric).toBe('');
  });

  it('retains every row for conflicting roles or more than three candidates', () => {
    const conflicting: ReadingOrderLyricEntry[] = [
      { line: line('A'), role: 'translation' },
      { line: line('B'), role: 'translation' },
      { line: line('C') },
    ];
    const result = groupLrcByReadingOrder(conflicting, 'main-translation-roman');
    expect(result.lines.map((item) => item.words[0].word)).toEqual(['A', 'B', 'C']);
    expect(result.issues).toContain('歌词角色标记冲突，已保留原内容。');
    const overflow = groupLrcByReadingOrder(['A', 'B', 'C', 'D'].map((text) => ({ line: line(text) })), 'main-translation-roman');
    expect(overflow.lines).toHaveLength(4);
    expect(overflow.issues).toContain('同时间歌词超过三行，已保留原内容。');
  });

  it('does not override existing parser-native auxiliary content', () => {
    const result = groupLrcByReadingOrder([
      { line: { ...line('MAIN'), translatedLyric: 'Existing' } },
      { line: line('Other translation') },
    ], 'main-translation-roman');
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].translatedLyric).toBe('Existing');
    expect(result.issues).toContain('歌词角色与已有辅助内容冲突，已保留原内容。');
  });

  it('does not apply language row counts across explicit vocal identities', () => {
    const result = groupLrcByReadingOrder([
      { line: line('Lead'), protectedVocal: true },
      { line: { ...line('Duet'), isDuet: true }, protectedVocal: true },
      { line: line('Unmarked') },
    ], 'translation-main-roman');
    expect(result.lines.map((item) => item.words[0].word)).toEqual(['Lead', 'Duet', 'Unmarked']);
    expect(result.lines.every((item) => !item.translatedLyric && !item.romanWords)).toBe(true);
  });

  it('uses exact original timestamps and does not fuzzy-match dense neighboring rows', () => {
    const result = groupLrcByReadingOrder([
      { line: line('A', 1000) }, { line: line('B', 1010) }, { line: line('C', 1049) },
    ], 'translation-main-roman');
    expect(result.lines.map((item) => item.startTime)).toEqual([1000, 1010, 1049]);
    expect(result.lines.every((item) => !item.translatedLyric)).toBe(true);
    const clamped = groupLrcByReadingOrder([
      { line: line('A', 0), sourceTime: 100 }, { line: line('B', 0), sourceTime: 200 },
    ], 'main-translation-roman');
    expect(clamped.lines).toHaveLength(2);
  });

  it('preserves all auxiliary timings and leaves its input immutable', () => {
    const main = line('MAIN', 1000, 5000);
    const translation = line('TRANS', 1000, 3600);
    translation.words = [
      { word: 'Trans ', startTime: 1200, endTime: 1800 },
      { word: 'late', startTime: 1800, endTime: 3600 },
    ];
    const roman = line('ROMAN', 1000, 4200);
    const entries = [{ line: main }, { line: translation }, { line: roman }];
    const before = structuredClone(entries);
    const result = groupLrcByReadingOrder(entries, 'main-translation-roman');
    expect(entries).toEqual(before);
    expect(result.lines[0]).toMatchObject({ startTime: 1000, endTime: 5000, romanLyric: 'ROMAN' });
    expect(result.lines[0].translationWords).toEqual(translation.words.map((word) => ({ ...word, ruby: undefined })));
    expect(result.lines[0].romanWords?.[0]).toMatchObject({ startTime: 1000, endTime: 4200 });
    expect(result.lines[0].words[0].romanWord).toBeUndefined();
    result.lines[0].translationWords![0].word = 'Changed output';
    expect(entries).toEqual(before);
  });

  it('preserves exact multiword alignment and full-line romanization for plain LRC', () => {
    const main = line('Main');
    main.words = [
      { word: 'Ma', startTime: 1000, endTime: 2000 },
      { word: 'in', startTime: 2000, endTime: 3000 },
    ];
    const roman = line('Roman');
    roman.words = [
      { word: 'ro ', startTime: 1000, endTime: 2000 },
      { word: 'man', startTime: 2000, endTime: 3000 },
    ];
    const exact = groupLrcByReadingOrder([
      { line: main, role: 'main' }, { line: roman, role: 'roman' },
    ], 'main-translation-roman').lines[0];
    expect(exact.romanLyric).toBe('');
    expect(exact.words.map((word) => word.romanWord)).toEqual(['ro ', 'man']);
    const plain = groupLrcByReadingOrder([
      { line: line('Main'), role: 'main' }, { line: line('Roman'), role: 'roman' },
    ], 'main-translation-roman').lines[0];
    expect(plain.romanLyric).toBe('Roman');
    expect(plain.words[0].romanWord).toBeUndefined();
    expect(plain.romanWords?.[0].word).toBe('Roman');
  });
});
