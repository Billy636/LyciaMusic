import { describe, expect, it } from 'vitest';

import { convertLyricsToAmlLines, getCurrentLyricDisplayLines, semanticLineToLyricLine } from './converters';
import type { LyricLine, SemanticLine } from './types';

function stripAmlRomajiSeparators(text: string) {
  return text.replace(/\u00a0/g, '');
}

describe('convertLyricsToAmlLines', () => {
  it('limits plain lyric lead-in before dense bilingual lines', () => {
    const lines: LyricLine[] = [
      {
        time: 18.11,
        endTime: 19.83,
        text: 'You show me',
        translation: '你告诉我',
        romaji: '',
      },
      {
        time: 19.83,
        endTime: 24.7,
        text: 'what is deep as sea',
        translation: '什么如海般深沉',
        romaji: '',
      },
    ];

    const amlLines = convertLyricsToAmlLines(lines, true, false);

    expect(amlLines[0]?.startTime).toBe(18110);
    expect(amlLines[0]?.endTime).toBe(19530);
    expect(amlLines[1]?.startTime).toBe(19830);
  });

  it('carries independent timed romaji words for player-side karaoke rendering', () => {
    const lines = [
      {
        time: 98.981,
        endTime: 104.179,
        text: '拙い祈りが織りなす波',
        translation: '笨拙的祈愿交织而成汹涌的巨浪',
        romaji: 'tsu ta na i i no ri ga o ri na su na mi',
        words: [
          { text: '拙', start: 98.981, end: 99.565, romaji: '' },
          { text: 'い', start: 99.565, end: 99.837, romaji: '' },
        ],
        romajiWords: [
          { text: 'tsu ', start: 98.981, end: 99.033 },
          { text: 'ta ', start: 99.033, end: 99.521 },
        ],
      },
    ] as LyricLine[];

    const amlLines = convertLyricsToAmlLines(lines, true, true) as Array<ReturnType<typeof convertLyricsToAmlLines>[number] & {
      romajiWords?: Array<{ text: string; startTime: number; endTime: number }>;
    }>;

    expect(amlLines[0]?.romanLyric).toBe('tsu ta na i i no ri ga o ri na su na mi');
    expect(amlLines[0]?.romajiWords).toEqual([
      { text: 'tsu ', startTime: 98981, endTime: 99033 },
      { text: 'ta ', startTime: 99033, endTime: 99521 },
    ]);
  });

  it('renders per-word romaji as ruby text even when romajiWords exist', () => {
    const lines = [
      {
        time: 54.353,
        endTime: 59.487,
        text: '本当の世界で笑えるか?',
        translation: '在现实世界里还能够展颜欢笑吗',
        romaji: 'ho n to u no se ka i de wa ra e ru ka',
        words: [
          { text: '本', start: 54.664, end: 54.944, romaji: 'ho n ' },
          { text: '当', start: 54.944, end: 54.981, romaji: 'to u ' },
          { text: 'の', start: 54.981, end: 55.597, romaji: 'no ' },
        ],
        romajiWords: [
          { text: 'ho ', start: 54.353, end: 54.508 },
          { text: 'n ', start: 54.508, end: 54.663 },
          { text: 'to ', start: 54.664, end: 54.803 },
        ],
      },
    ] as LyricLine[];

    const amlLines = convertLyricsToAmlLines(lines, true, true);

    expect(amlLines[0]?.romanLyric).toBe('');
    expect(amlLines[0]?.words.map((word) => word.romanWord)).toEqual(['ho n ', 'to u ', 'no ']);
  });

  it('adds visual separators between adjacent AML ruby romaji fragments', () => {
    const separator = '\u00a0';
    const lines = [
      {
        time: 54.353,
        endTime: 59.487,
        text: '本当の世界で笑えるか?',
        translation: '在现实世界里还能够展颜欢笑吗',
        romaji: 'ho n to u no se ka i de wa ra e ru ka',
        words: [
          { text: '本', start: 54.664, end: 54.944, romaji: 'ho n' },
          { text: '当', start: 54.944, end: 54.981, romaji: 'to u' },
          { text: 'の', start: 54.981, end: 55.597, romaji: 'no' },
          { text: '世', start: 55.597, end: 56.024, romaji: 'se' },
          { text: '界', start: 56.024, end: 56.514, romaji: 'ka i' },
          { text: 'で', start: 56.514, end: 56.932, romaji: 'de' },
          { text: '笑', start: 56.932, end: 57.538, romaji: 'wa ra' },
          { text: 'え', start: 57.538, end: 58.094, romaji: 'e' },
          { text: 'る', start: 58.094, end: 58.703, romaji: 'ru' },
          { text: 'か', start: 58.703, end: 59.104, romaji: 'ka' },
          { text: '?', start: 59.104, end: 59.487, romaji: '?' },
        ],
      },
    ] as LyricLine[];

    const amlLines = convertLyricsToAmlLines(lines, true, true);

    expect(amlLines[0]?.romanLyric).toBe('');
    expect(amlLines[0]?.words.map((word) => word.romanWord)).toEqual([
      `ho n${separator}`,
      `to u${separator}`,
      `no${separator}`,
      `se${separator}`,
      `ka i${separator}`,
      `de${separator}`,
      `wa ra${separator}`,
      `e${separator}`,
      `ru${separator}`,
      `ka${separator}`,
      '?',
    ]);
  });

  it('falls back to line-level roman lyric when any main word is missing romaji', () => {
    const lines = [
      {
        time: 12.651,
        endTime: 18.056,
        text: 'か弱い光が指差す先',
        translation: '追寻着那道微弱光线所指的方向',
        romaji: 'ka yo wa i hi ka ri ga yu bi sa su sa ki',
        words: [
          { text: 'か', start: 12.651, end: 12.884, romaji: 'ka' },
          { text: '弱', start: 12.884, end: 13.476, romaji: 'yo wa' },
          { text: 'い', start: 13.476, end: 13.678, romaji: '' },
        ],
      },
    ] as LyricLine[];

    const amlLines = convertLyricsToAmlLines(lines, true, true);

    expect(amlLines[0]?.romanLyric).toBe('ka yo wa i hi ka ri ga yu bi sa su sa ki');
    expect(amlLines[0]?.words.map((word) => word.romanWord || '')).toEqual(['', '', '']);
  });

  it('keeps numeric main words in per-word romaji mode', () => {
    const separator = '\u00a0';
    const lines = [
      {
        time: 25.014,
        endTime: 30.710,
        text: '6/8のリズム 掻き乱される',
        translation: '八六原本平和的旋律开始被打乱',
        romaji: 'ha chi ro ku no ri zu mu ka ki mi da sa re ru',
        words: [
          { text: '6', start: 25.014, end: 25.654, romaji: 'ha chi' },
          { text: '/', start: 25.654, end: 25.654, romaji: '' },
          { text: '8', start: 25.654, end: 26.056, romaji: 'ro ku' },
          { text: 'の', start: 26.056, end: 26.459, romaji: 'no' },
          { text: 'リ', start: 26.459, end: 26.471, romaji: 'ri' },
          { text: 'ズ', start: 26.471, end: 26.799, romaji: 'zu' },
          { text: 'ム', start: 26.799, end: 27.199, romaji: 'mu' },
          { text: ' ', start: 27.199, end: 27.199, romaji: '' },
          { text: '掻', start: 27.199, end: 27.551, romaji: 'ka' },
          { text: 'き', start: 27.551, end: 27.572, romaji: 'ki' },
          { text: '乱', start: 27.572, end: 29.186, romaji: 'mi da' },
          { text: 'さ', start: 29.186, end: 29.450, romaji: 'sa' },
          { text: 'れ', start: 29.450, end: 29.921, romaji: 're' },
          { text: 'る', start: 29.921, end: 30.428, romaji: 'ru' },
        ],
      },
    ] as LyricLine[];

    const amlLines = convertLyricsToAmlLines(lines, true, true);

    expect(amlLines[0]?.romanLyric).toBe('');
    expect(amlLines[0]?.words.map((word) => word.romanWord || '')).toEqual([
      `ha chi${separator}`,
      '',
      `ro ku${separator}`,
      `no${separator}`,
      `ri${separator}`,
      `zu${separator}`,
      `mu${separator}`,
      '',
      `ka${separator}`,
      `ki${separator}`,
      `mi da${separator}`,
      `sa${separator}`,
      `re${separator}`,
      'ru',
    ]);
  });

  it('produces complete per-word romaji for the Avid LRC line', () => {
    const semantic: SemanticLine = {
      startMs: 44915,
      endMs: 51121,
      mainText: 'あの日なくした Avidity',
      mainWords: [
        { text: 'あ', startMs: 44915, endMs: 45077, romanText: 'a' },
        { text: 'の', startMs: 45077, endMs: 45349, romanText: 'no' },
        { text: '日', startMs: 45349, endMs: 45379, romanText: 'hi' },
        { text: 'な', startMs: 45379, endMs: 45672, romanText: 'na' },
        { text: 'く', startMs: 45672, endMs: 45993, romanText: 'ku' },
        { text: 'し', startMs: 45993, endMs: 46601, romanText: 'shi' },
        { text: 'た', startMs: 46601, endMs: 47769, romanText: 'ta' },
        { text: ' ', startMs: 47769, endMs: 47769, romanText: '' },
        { text: 'Avidity', startMs: 47769, endMs: 51121, romanText: 'Avidity' },
      ],
      romanText: 'a no hi na ku shi ta Avidity',
      romanWords: [
        { text: 'a', startMs: 44915, endMs: 45076 },
        { text: 'no', startMs: 45076, endMs: 45348 },
        { text: 'hi', startMs: 45348, endMs: 45378 },
        { text: 'na', startMs: 45378, endMs: 45671 },
        { text: 'ku', startMs: 45671, endMs: 45992 },
        { text: 'shi', startMs: 45992, endMs: 46600 },
        { text: 'ta', startMs: 46600, endMs: 47767 },
        { text: 'Avidity', startMs: 47768, endMs: 51120 },
      ],
      translationText: '还有那一日我所遗失的热忱',
      confidence: 'explicit',
    };

    const lyric = semanticLineToLyricLine(semantic);

    // All 9 main words preserved (including zero-duration space)
    expect(lyric.words).toHaveLength(9);
    expect(lyric.words!.map((w) => ({ text: w.text, romaji: w.romaji }))).toEqual([
      { text: 'あ', romaji: 'a' },
      { text: 'の', romaji: 'no' },
      { text: '日', romaji: 'hi' },
      { text: 'な', romaji: 'na' },
      { text: 'く', romaji: 'ku' },
      { text: 'し', romaji: 'shi' },
      { text: 'た', romaji: 'ta' },
      { text: ' ', romaji: '' },
      { text: 'Avidity', romaji: 'Avidity' },
    ]);

    // Conversion to AML lines with aligned romaji
    const amlLines = convertLyricsToAmlLines([lyric], true, true);
    expect(amlLines).toHaveLength(1);

    const aml = amlLines[0]!;
    // Per-word romaji mode — romanLyric should be empty
    expect(aml.romanLyric).toBe('');
    // Each word carries its romanWord
    const amlWordData = aml.words.map((w) => ({
      word: w.word,
      romanWord: stripAmlRomajiSeparators(w.romanWord),
    }));
    // Whitespace word preserved for segmenter word-boundary detection
    expect(amlWordData).toEqual([
      { word: 'あ', romanWord: 'a' },
      { word: 'の', romanWord: 'no' },
      { word: '日', romanWord: 'hi' },
      { word: 'な', romanWord: 'na' },
      { word: 'く', romanWord: 'ku' },
      { word: 'し', romanWord: 'shi' },
      { word: 'た', romanWord: 'ta' },
      { word: ' ', romanWord: '' },
      { word: 'Avidity', romanWord: 'Avidity' },
    ]);
  });

  it('still maps romaji through overlap alignment even when main word romanText is empty', () => {
    // Scenario: Rust parser produces romanWords with all entries but
    // the Avidity main word lacks romanText (parser only sets romanText
    // for kana words, not latin words).
    const semantic: SemanticLine = {
      startMs: 44915,
      endMs: 51121,
      mainText: 'あの日なくした Avidity',
      mainWords: [
        { text: 'あ', startMs: 44915, endMs: 45077, romanText: 'a' },
        { text: 'の', startMs: 45077, endMs: 45349, romanText: 'no' },
        { text: '日', startMs: 45349, endMs: 45379, romanText: 'hi' },
        { text: 'な', startMs: 45379, endMs: 45672, romanText: 'na' },
        { text: 'く', startMs: 45672, endMs: 45993, romanText: 'ku' },
        { text: 'し', startMs: 45993, endMs: 46601, romanText: 'shi' },
        { text: 'た', startMs: 46601, endMs: 47769, romanText: 'ta' },
        { text: ' ', startMs: 47769, endMs: 47769 },
        { text: 'Avidity', startMs: 47769, endMs: 51121 }, // no romanText
      ],
      romanText: 'a no hi na ku shi ta Avidity',
      romanWords: [
        { text: 'a', startMs: 44915, endMs: 45076 },
        { text: 'no', startMs: 45076, endMs: 45348 },
        { text: 'hi', startMs: 45348, endMs: 45378 },
        { text: 'na', startMs: 45378, endMs: 45671 },
        { text: 'ku', startMs: 45671, endMs: 45992 },
        { text: 'shi', startMs: 45992, endMs: 46600 },
        { text: 'ta', startMs: 46600, endMs: 47767 },
        { text: 'Avidity', startMs: 47768, endMs: 51120 },
      ],
      translationText: '还有那一日我所遗失的热忱',
      confidence: 'explicit',
    };

    const lyric = semanticLineToLyricLine(semantic);
    // Overlap alignment maps romanWords[7] (Avidity) → mainWords[8] (Avidity)
    expect(lyric.words![8]!.romaji).toBe('Avidity');
    expect(lyric.words![7]!.romaji).toBe(''); // space still empty

    // Should still enter aligned romaji mode
    const amlLines = convertLyricsToAmlLines([lyric], true, true);
    expect(amlLines[0]!.romanLyric).toBe('');
    expect(amlLines[0]!.words[8]!.romanWord).toBe('Avidity');
    expect(amlLines[0]!.words[7]!.word).toBe(' ');
  });

  it('uses independent timed romaji words for the current romaji display line', () => {
    const displayLines = getCurrentLyricDisplayLines({
      time: 98.981,
      endTime: 104.179,
      text: '拙い祈りが織りなす波',
      translation: '笨拙的祈愿交织而成汹涌的巨浪',
      romaji: 'tsu ta na i',
      words: [
        { text: '拙', start: 98.981, end: 99.565, romaji: '' },
      ],
      romajiWords: [
        { text: 'tsu ', start: 98.981, end: 99.033 },
        { text: 'ta ', start: 99.033, end: 99.521 },
      ],
    }, true, true);

    expect(displayLines[1]?.kind).toBe('romaji');
    expect(displayLines[1]?.words).toEqual([
      { text: 'tsu ', start: 98.981, end: 99.033 },
      { text: 'ta ', start: 99.033, end: 99.521 },
    ]);
  });
});
