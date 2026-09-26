import { describe, expect, it } from 'vitest';

import { parseOfficialLyrics } from './officialParser';
import { amlLineToLegacyLyricLine, applyNativeAmlDisplaySettings } from './ttml';
import {
  ROMANIZATION_SAMPLE_A,
  ROMANIZATION_SAMPLE_B,
  ROMANIZATION_TIMING_FIXTURES,
} from './fixtures/romanizationTiming';

/** Independent fixture reader: assertion data never comes from the parser being tested. */
function sourceWords(row: string) {
  const markers = [...row.matchAll(/<(\d{2}):(\d{2})\.(\d{3})>/g)];
  const toMs = (marker: RegExpExecArray) => Number(marker[1]) * 60000 + Number(marker[2]) * 1000 + Number(marker[3]);
  return markers.slice(0, -1).flatMap((marker, index) => {
    const next = markers[index + 1];
    const word = row.slice(marker.index + marker[0].length, next.index);
    return word.length > 0 ? [{ word, startTime: toMs(marker), endTime: toMs(next) }] : [];
  });
}

function sourceGroups(raw: string) {
  const rows = raw.split('\n');
  return rows.filter((_, index) => index % 3 === 0).map((_, index) => ({
    roman: sourceWords(rows[index * 3]),
    main: sourceWords(rows[index * 3 + 1]),
    translation: sourceWords(rows[index * 3 + 2]),
  }));
}

function timing(words: ReadonlyArray<{ word: string; startTime: number; endTime: number }>) {
  return words.map(({ word, startTime, endTime }) => ({ word, startTime, endTime }));
}

async function parseSample(raw: string) {
  const result = await parseOfficialLyrics(raw, { readingOrder: 'roman-main-translation' });
  expect(result.error).toBeUndefined();
  expect(result.format).toBe('enhanced_lrc');
  return result.lines;
}

describe('user romanization samples through the official parser and display adapters', () => {
  it('renders all four Sample A rows inline while leaving unmatched Japanese slots empty', async () => {
    const lines = await parseSample(ROMANIZATION_SAMPLE_A);
    expect(lines).toHaveLength(4);
    expect(lines.map((line) => line.romanLyric)).toEqual(['', '', '', '']);
    // The source gives no romanization for ち or either small ゃ. In particular,
    // chi belongs to the preceding こ by timestamp, not by a pronunciation guess.
    // The zero-duration separator may attach to a neighboring word; raw spaces
    // remain checked independently in romanWords and the complete legacy text.
    const inline = lines.map((line) => line.words
      .filter((word) => word.word.trim())
      .map((word) => [word.word, (word.romanWord ?? '').trimEnd()]));
    expect(inline).toEqual([
      [['ど', 'do '], ['う', 'u '], ['で', 'de '], ['も', 'mo '], ['よ', 'yo '], ['か', 'ka '], ['っ', 'tsu '], ['た', 'ta ']],
      [['瞬', 'ma do ka '], ['く', 'ku '], ['間', 'a i da '], ['に', 'ni '], ['落', 'o '], ['っ', 'kko '], ['こ', 'chi '], ['ち', ''], ['た', 'ta '], ['淡', 'a wa '], ['い', 'i '], ['靄', 'mo ya '], ['の', 'no '], ['中', 'na ka '], ['で', 'de ']],
      [['君', 'ki mi '], ['じ', 'ja '], ['ゃ', ''], ['な', 'na '], ['き', 'kya '], ['ゃ', ''], ['い', 'i '], ['け', 'ke '], ['な', 'na '], ['い', 'i '], ['と', 'to ']],
      [['た', 'ta '], ['だ', 'da '], ['強', 'tsu yo '], ['く', 'ku '], ['思', 'o mo '], ['う', 'u '], ['だ', 'da '], ['け', 'ke ']],
    ].map((row) => row.map(([word, roman]) => [word, roman.trimEnd()])));
  });

  it('assigns all fifteen Sample B fragments exactly once, retaining their source spaces', async () => {
    const [line] = await parseSample(ROMANIZATION_SAMPLE_B);
    const roman = sourceGroups(ROMANIZATION_SAMPLE_B)[0].roman;
    expect(roman).toHaveLength(15);
    expect(line.romanLyric).toBe('');
    expect(line.words.map((word) => [word.word, word.romanWord ?? ''])).toEqual([
      ['本', 'ho n '], ['当', 'to u '], ['の', 'no '], ['世', 'se '],
      ['界', 'ka i '], ['で', 'de '], ['笑', 'wa ra '], ['え', 'e '],
      ['る', 'ru '], ['か', 'ka '], ['?', '? '],
    ]);
    expect(line.words.map((word) => word.romanWord ?? '').join('')).toBe(roman.map((word) => word.word).join(''));
    expect(line.romanWords).toHaveLength(15);
  });

  it.each(ROMANIZATION_TIMING_FIXTURES)('preserves every supplied main/roman timestamp and translation in $name', async ({ raw, lineCount }) => {
    const lines = await parseSample(raw);
    const groups = sourceGroups(raw);
    expect(lines).toHaveLength(lineCount);
    lines.forEach((line, index) => {
      const expected = groups[index];
      expect(timing(line.words)).toEqual(expected.main);
      expect(timing(line.romanWords ?? [])).toEqual(expected.roman);
      expect(timing(line.translationWords ?? [])).toEqual(expected.translation);
      expect(line.startTime).toBe(expected.main[0].startTime);
      expect(line.endTime).toBe(expected.main[expected.main.length - 1].endTime);
      expect(line.translatedLyric).toBe(expected.translation.map((word) => word.word).join(''));
    });
  });

  it.each(ROMANIZATION_TIMING_FIXTURES)('retains romanization through visibility toggles and the legacy projection in $name', async ({ raw }) => {
    const lines = await parseSample(raw);
    const before = structuredClone(lines);
    const visible = applyNativeAmlDisplaySettings(lines, true, true);
    const hidden = applyNativeAmlDisplaySettings(lines, false, false);
    expect(hidden.every((line) => line.romanLyric === '' && line.romanWords === undefined
      && line.words.every((word) => word.romanWord === ''))).toBe(true);
    expect(hidden.every((line) => line.translatedLyric === '' && line.translationWords === undefined)).toBe(true);
    expect(lines).toEqual(before);
    expect(applyNativeAmlDisplaySettings(lines, true, true)).toEqual(visible);

    sourceGroups(raw).forEach((expected, index) => {
      const legacy = amlLineToLegacyLyricLine(visible[index]);
      expect(legacy.words?.map((word) => word.romaji ?? '')).toEqual(lines[index].words.map((word) => word.romanWord ?? ''));
      expect(legacy.words?.map(({ text, start, end }) => ({ text, start, end }))).toEqual(
        expected.main.map(({ word, startTime, endTime }) => ({ text: word, start: startTime / 1000, end: endTime / 1000 })),
      );
      expect(legacy.romajiWords?.map(({ text, start, end }) => ({ text, start, end }))).toEqual(
        expected.roman.map(({ word, startTime, endTime }) => ({ text: word, start: startTime / 1000, end: endTime / 1000 })),
      );
      expect(legacy.romaji).toBe(expected.roman.map((word) => word.word).join(''));
      expect(legacy.translation).toBe(expected.translation.map((word) => word.word).join(''));
    });
  });
});
