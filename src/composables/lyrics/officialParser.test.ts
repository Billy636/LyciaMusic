import { encryptQrcHex } from '@applemusic-like-lyrics/lyric';
import { DOMParser } from '@xmldom/xmldom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import yrcFixture from '../../../src-tauri/src/music/fixtures/lyrics/if_back_then.yrc?raw';
import qrcFixture from '../../../src-tauri/src/music/fixtures/lyrics/baby.qrc?raw';
import lysFixture from '../../../src-tauri/src/music/fixtures/lyrics/from_that_day.lys?raw';
import { parseOfficialLyrics } from './officialParser';
import { amlLineToLegacyLyricLine, applyNativeAmlDisplaySettings } from './ttml';

beforeAll(() => vi.stubGlobal('DOMParser', DOMParser));
afterAll(() => vi.unstubAllGlobals());

describe('official LRC parsing and explicit product policy', () => {
  it('uses the next distinct timestamp and song duration for ordinary line ends', async () => {
    const result = await parseOfficialLyrics('[00:01.000]Hello\n[00:03.000]World', { durationMs: 8000 });
    expect(result.format).toBe('lrc');
    expect(result.lines.map((line) => [line.startTime, line.endTime])).toEqual([[1000, 3000], [3000, 8000]]);
    expect(result.lines[0].words).toHaveLength(1);
  });

  it('keeps colon fractions, repeated timestamps and source ordering', async () => {
    const result = await parseOfficialLyrics('[00:22:05][00:28:20]重复\n[00:25:20]中间', { durationMs: 30000 });
    expect(result.lines.map((line) => [line.words[0].word, line.startTime, line.endTime])).toEqual([
      ['重复', 22050, 25200], ['中间', 25200, 28200], ['重复', 28200, 30000],
    ]);
  });

  it('keeps all same-time unlabelled lines and each original word timing', async () => {
    const result = await parseOfficialLyrics([
      '[00:01.000]<00:01.000>ro <00:01.300>man<00:02.000>',
      '[00:01.000]<00:01.100>正<00:01.600>文<00:02.200>',
      '[00:01.000]译文',
      '[00:03.000]next',
    ].join('\n'), { durationMs: 5000 });
    expect(result.lines).toHaveLength(4);
    expect(result.lines[0].words.map((word) => [word.word, word.startTime, word.endTime])).toEqual([
      ['ro ', 1000, 1300], ['man', 1300, 2000],
    ]);
    expect(result.lines[1].words.map((word) => [word.word, word.startTime, word.endTime])).toEqual([
      ['正', 1100, 1600], ['文', 1600, 2200],
    ]);
    expect(result.lines.slice(0, 3).map((line) => line.translatedLyric)).toEqual(['', '', '']);
    expect(result.issues).toContain('同时间的未标注歌词保留为独立行。');
  });

  it('does not infer that the second Latin line is a translation or romanization', async () => {
    const result = await parseOfficialLyrics('[00:01]English\n[00:01]French\n[00:01]Spanish');
    expect(result.lines.map((line) => line.words[0].word)).toEqual(['English', 'French', 'Spanish']);
    expect(result.lines.every((line) => !line.translatedLyric && !line.romanLyric)).toBe(true);
  });

  it('attaches only explicit auxiliary markers to a unique same-time main line', async () => {
    const result = await parseOfficialLyrics('[00:01]Main\n[00:01][tr]译文\n[romaji][00:01]main', { durationMs: 4000 });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].translatedLyric).toBe('译文');
    expect(result.lines[0].romanLyric).toBe('main');
    expect(result.lines[0].words[0].romanWord).toBe('');
    expect(amlLineToLegacyLyricLine(result.lines[0]).romaji).toBe('main');
  });

  it('supports an explicitly labelled untimed translation without guessing unlabelled text', async () => {
    const result = await parseOfficialLyrics('[00:01]Main\n【译文】中文\nUnlabelled notes', { durationMs: 5000 });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].translatedLyric).toBe('中文');
    expect(result.issues.some((issue) => issue.includes('没有时间戳'))).toBe(true);
  });

  it('retains an independent romanization timing grid without overlap guesses', async () => {
    const result = await parseOfficialLyrics([
      '[00:01]<00:01>漢<00:02>字<00:03>',
      '[00:01][romaji]<00:01>kan <00:01.400>ji<00:02.700>',
    ].join('\n'));
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].romanLyric).toBe('kan ji');
    expect(result.lines[0].words.map((word) => word.romanWord)).toEqual(['', '']);
    expect(amlLineToLegacyLyricLine(result.lines[0]).romajiWords).toEqual([
      { text: 'kan ', start: 1, end: 1.4 }, { text: 'ji', start: 1.4, end: 2.7 },
    ]);
  });

  it('attaches an explicitly timed translation losslessly but does not guess an ambiguous main', async () => {
    const timed = await parseOfficialLyrics('[00:01]Main\n[00:01][tr]<00:01>译<00:02>文<00:03>');
    expect(timed.lines).toHaveLength(1);
    expect(timed.lines[0].translationWords?.map((word) => [word.word, word.startTime, word.endTime]))
      .toEqual([['译', 1000, 2000], ['文', 2000, 3000]]);
    const ambiguous = await parseOfficialLyrics('[00:01]A\n[00:01]B\n[00:01][tr]中文');
    expect(ambiguous.lines).toHaveLength(3);
    expect(ambiguous.lines.every((line) => !line.translatedLyric)).toBe(true);
  });

  it('applies the last valid raw offset exactly once, including repeated values and suffixes', async () => {
    const result = await parseOfficialLyrics('[offset:+100]\n[offset:+300]\n[offset:invalid]\n[OFFSET : +100ms]\n[00:01]One', { durationMs: 6000 });
    expect(result.lines[0]).toMatchObject({ startTime: 1100, endTime: 6000 });
    expect(result.lines[0].words[0]).toMatchObject({ startTime: 1100, endTime: 6000 });
  });

  it('clamps negative offset once without altering relative valid word timing', async () => {
    const result = await parseOfficialLyrics('[offset:-500]\n[00:00.250]<00:00.250>A<00:00.750>B<00:01.250>');
    expect(result.lines[0].words.map((word) => [word.startTime, word.endTime])).toEqual([[0, 250], [250, 750]]);
  });

  it('honours an explicit end-only marker instead of extending to the next lyric', async () => {
    const result = await parseOfficialLyrics('[00:01]One\n[00:02]\n[00:04]Two', { durationMs: 5000 });
    expect(result.lines.map((line) => [line.startTime, line.endTime])).toEqual([
      [1000, 2000], [2000, 4000], [4000, 5000],
    ]);
    const legacy = result.lines.map(amlLineToLegacyLyricLine).sort((left, right) => left.time - right.time);
    expect(legacy.filter((line) => line.time <= 3).slice(-1)[0].text).toBe('');
    expect(applyNativeAmlDisplaySettings(result.lines, true, true)
      .map((line) => [line.words[0].word, line.startTime, line.endTime]))
      .toEqual([['One', 1000, 2000], ['Two', 4000, 5000]]);
    expect(result.lines).toHaveLength(3);
  });

  it('keeps an early background vocal adjacent to its LRC main vocal', async () => {
    const result = await parseOfficialLyrics('[00:01]MAIN\n[00:00.500](BG)\n[00:02]NEXT', { durationMs: 5000 });
    expect(result.lines.map((line) => [line.words[0].word, line.startTime, line.isBG])).toEqual([
      ['MAIN', 1000, false], ['BG', 500, true], ['NEXT', 2000, false],
    ]);
  });

  it('preserves delayed enhanced single-word starts without creating a repeated line', async () => {
    const result = await parseOfficialLyrics('[00:01]<00:02>A\n[00:05]B', { durationMs: 8000 });
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ startTime: 1000, endTime: 5000 });
    expect(result.lines[0].words).toHaveLength(1);
    expect(result.lines[0].words[0]).toMatchObject({ word: 'A', startTime: 2000, endTime: 5000 });
  });

  it('parses the existing v1 enhanced fixture and retains same-time plain fallback lines', async () => {
    const result = await parseOfficialLyrics([
      '[00:13.749]v1:<00:13.749>海<00:14.062>平<00:14.409>面<00:14.867>远<00:15.359>方<00:15.691>开<00:16.027>始<00:16.589>阴<00:17.060>霾<00:18.432>',
      '[00:13.749]海平面远方开始阴霾',
      '[00:20.280]v1:<00:20.280>悲<00:20.599>伤<00:21.018>要<00:21.441><00:21.442>怎么<00:22.263>平静<00:23.121>纯<00:23.755>白<00:24.659>',
    ].join('\n'));
    expect(result.format).toBe('enhanced_lrc');
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0].words.map((word) => word.word).join('')).toBe('海平面远方开始阴霾');
    expect(result.lines[0].words[0]).toMatchObject({ word: '海', startTime: 13749, endTime: 14062 });
    expect(result.lines[2].words.find((word) => word.word === '怎么')).toMatchObject({ startTime: 21442, endTime: 22263 });
  });

  it('preserves square-timestamp ESLyric gaps, spaces and punctuation', async () => {
    const result = await parseOfficialLyrics('[00:07.545]A[00:07.721][00:07.722] B![00:07.852][00:07.853]C[00:08.022]');
    expect(result.format).toBe('eslrc');
    expect(result.lines[0].words.map((word) => [word.word, word.startTime, word.endTime])).toEqual([
      ['A', 7545, 7721], [' B!', 7722, 7852], ['C', 7853, 8022],
    ]);
  });

  it('uses duration only for an inferred final end and leaves explicit overlap intact', async () => {
    const result = await parseOfficialLyrics('[00:01]<00:01>A<00:03>B\n[00:02]<00:02>C<00:05>', { durationMs: 4500 });
    expect(result.lines[0].words[1]).toMatchObject({ startTime: 3000, endTime: 4500 });
    expect(result.lines[1].endTime).toBe(5000);
  });

  it('ends an unfinished word at the next compatible line after overlapping starts', async () => {
    const result = await parseOfficialLyrics('[00:01]<00:01>A<00:03>B\n[00:02]<00:02>C<00:02.500>\n[00:04]D', { durationMs: 8000 });
    expect(result.lines[0].words[1]).toMatchObject({ startTime: 3000, endTime: 4000 });
  });

  it('repairs reversed word intervals and reports them while preserving valid timestamps', async () => {
    const result = await parseOfficialLyrics('[00:01]<00:01>A<00:00.500>B<00:02>');
    expect(result.lines[0].words[0]).toMatchObject({ startTime: 1000, endTime: 1000 });
    expect(result.lines[0].words[1]).toMatchObject({ startTime: 500, endTime: 2000 });
    expect(result.issues.some((issue) => issue.includes('无效时间'))).toBe(true);
  });
});

describe('reading-order parsing integration', () => {
  it('reads a three-line Japanese verse and two-line English verse using one convention', async () => {
    const result = await parseOfficialLyrics([
      '[00:01]wasure nai', '[00:01]忘れない', '[00:01]不会忘记',
      '[00:10]Never forget', '[00:10]永不遗忘',
      '[00:20]Solo',
    ].join('\n'), { readingOrder: 'roman-main-translation', durationMs: 30000 });
    expect(result.lines).toHaveLength(3);
    const projected = result.lines.map(amlLineToLegacyLyricLine);
    expect(projected[0]).toMatchObject({ text: '忘れない', translation: '不会忘记', romaji: 'wasure nai' });
    expect(projected[1]).toMatchObject({ text: 'Never forget', translation: '永不遗忘', romaji: '' });
    expect(projected[2]).toMatchObject({ text: 'Solo', translation: '', romaji: '' });
    const native = applyNativeAmlDisplaySettings(result.lines, true, true);
    expect(native[0].words.map((word) => word.word).join('')).toBe('忘れない');
    expect(native[0].translatedLyric).toBe('不会忘记');
    expect(native[0].romanLyric).toBe('wasure nai');
    expect(native[0].words[0].romanWord).toBe('');
  });

  it('keeps main/translation relative order after removing roman for two rows', async () => {
    const result = await parseOfficialLyrics('[00:01]中文\n[00:01]English', { readingOrder: 'translation-main-roman' });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].words[0].word).toBe('English');
    expect(result.lines[0].translatedLyric).toBe('中文');
  });

  it('lets explicit main/original/tr/romaji labels override the selected source order', async () => {
    const result = await parseOfficialLyrics('[00:01][tr]Translation\n[romaji][00:01]Roman\n[00:01][original]Main', {
      readingOrder: 'main-translation-roman',
    });
    expect(result.lines).toHaveLength(1);
    expect(amlLineToLegacyLyricLine(result.lines[0])).toMatchObject({ text: 'Main', translation: 'Translation', romaji: 'Roman' });
    const partial = await parseOfficialLyrics('[00:01][main]Main\n[00:01]Translation\n[00:01]Roman', {
      readingOrder: 'translation-roman-main',
    });
    expect(amlLineToLegacyLyricLine(partial.lines[0])).toMatchObject({ text: 'Main', translation: 'Translation', romaji: 'Roman' });
  });

  it('retains malformed conflicting markers instead of overriding explicit roles', async () => {
    const result = await parseOfficialLyrics('[tr][00:01][main]A\n[00:01]B', { readingOrder: 'main-translation-roman' });
    expect(result.lines.map((item) => item.words[0].word)).toEqual(['A', 'B']);
    expect(result.issues).toContain('歌词角色标记冲突，已保留原内容。');
  });

  it('preserves timed translations in the canonical document and legacy projection', async () => {
    const result = await parseOfficialLyrics('[00:01]<00:01>Main<00:05>\n[00:01]<00:01.200>译<00:02>文<00:03.500>', {
      readingOrder: 'main-translation-roman',
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ startTime: 1000, endTime: 5000, translatedLyric: '译文' });
    expect(result.lines[0].words[0]).toMatchObject({ startTime: 1000, endTime: 5000 });
    expect(amlLineToLegacyLyricLine(result.lines[0]).translationWords?.map((word) => [word.text, word.start, word.end]))
      .toEqual([['译', 1.2, 2], ['文', 2, 3.5]]);
    expect(applyNativeAmlDisplaySettings(result.lines, false, true)[0].translationWords).toBeUndefined();
    expect(result.lines[0].translationWords).toHaveLength(2);
  });

  it('does not count background, duet, or explicit clearing records as language rows', async () => {
    const result = await parseOfficialLyrics('[00:01]Translation\n[00:01]Main\n[00:00.500](BG)\n[00:02]\n[00:03]Next', {
      readingOrder: 'translation-main-roman', durationMs: 5000,
    });
    expect(result.lines.map((item) => [item.words[0].word, item.isBG])).toEqual([
      ['Main', false], ['BG', true], ['', false], ['Next', false],
    ]);
    expect(result.lines[0].translatedLyric).toBe('Translation');
    const duet = await parseOfficialLyrics('[00:01]v1:<00:01>Lead<00:02>\n[00:01]v2:<00:01>Duet<00:02>', {
      readingOrder: 'translation-main-roman',
    });
    expect(duet.lines.map((item) => [item.words[0].word, item.isDuet, item.translatedLyric]))
      .toEqual([['Lead', false, ''], ['Duet', true, '']]);
  });

  it('does not merge distinct source times clamped to zero by a negative offset', async () => {
    const result = await parseOfficialLyrics('[offset:-1000]\n[00:00.100]A\n[00:00.200]B', {
      readingOrder: 'main-translation-roman',
    });
    expect(result.lines).toHaveLength(2);
    expect(result.lines.map((item) => [item.words[0].word, item.startTime, item.translatedLyric]))
      .toEqual([['A', 0, ''], ['B', 0, '']]);
  });

  it('does not reinterpret native TTML roles or LYS vocal flags using LRC reading order', async () => {
    const source = '<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="1s" end="3s">Main<span ttm:role="x-roman">Roman</span><span ttm:role="x-translation">Translation</span></p></div></body></tt>';
    const plain = await parseOfficialLyrics(source);
    expect((await parseOfficialLyrics(source, { readingOrder: 'translation-roman-main' })).lines).toEqual(plain.lines);
    expect((await parseOfficialLyrics(lysFixture, { readingOrder: 'translation-roman-main' })).lines)
      .toEqual((await parseOfficialLyrics(lysFixture)).lines);
  });

  it.each([
    ['yrc', '[1000,2000](1000,2000,0)TRANS\n[1000,2000](1000,2000,0)ROMAN\n[1000,2000](1000,2000,0)MAIN\n[500,1000](500,1000,0)(BG)'],
    ['qrc', '[1000,2000]TRANS(1000,2000)\n[1000,2000]ROMAN(1000,2000)\n[1000,2000]MAIN(1000,2000)\n[500,1000](BG)(500,1000)'],
  ])('applies the same unlabelled reading convention to %s while retaining native BG', async (format, source) => {
    const result = await parseOfficialLyrics(source, { format, readingOrder: 'translation-roman-main' });
    expect(result.lines).toHaveLength(2);
    expect(amlLineToLegacyLyricLine(result.lines[0])).toMatchObject({
      text: 'MAIN', translation: 'TRANS', romaji: 'ROMAN', time: 1, endTime: 3,
    });
    expect(result.lines[1]).toMatchObject({ isBG: true, startTime: 500, endTime: 1500 });
    expect(result.lines[0].translationWords?.[0]).toMatchObject({ startTime: 1000, endTime: 3000 });
  });
});

describe('official explicit format parsers', () => {
  it('parses the existing YRC fixture with native per-word timing', async () => {
    const result = await parseOfficialLyrics(yrcFixture);
    expect(result.format).toBe('yrc');
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].words.map((word) => word.word).join('')).toBe('如果当时 - 许嵩');
    expect(result.lines[0].words[1]).toMatchObject({ word: '果', startTime: 375, endTime: 750 });
  });

  it('parses QRC words and expands only an invalid enclosing line boundary', async () => {
    const result = await parseOfficialLyrics(qrcFixture);
    expect(result.format).toBe('qrc');
    expect(result.lines[0].words.map((word) => word.word).join('')).toBe('You know you love me I know you care');
    expect(result.lines[0].words[8]).toMatchObject({ word: 'care', startTime: 17159, endTime: 18014 });
    expect(result.lines[0].endTime).toBe(18014);
  });

  it('preserves official LYS duet and background flags', async () => {
    const result = await parseOfficialLyrics(lysFixture, { format: '.lys' });
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ isDuet: true, isBG: false, startTime: 43802, endTime: 46596 });
    expect(result.lines[1]).toMatchObject({ isDuet: true, isBG: true, startTime: 52399, endTime: 53553 });
  });

  it.each([
    ['lys', '[3]MAIN(1000,3000)\n[6]BG(500,1000)\n[3]NEXT(2000,3000)'],
    ['qrc', '[1000,3000]MAIN(1000,3000)\n[500,1000](BG)(500,1000)\n[2000,3000]NEXT(2000,3000)'],
    ['yrc', '[1000,3000](1000,3000,0)MAIN\n[500,1000](500,1000,0)(BG)\n[2000,3000](2000,3000,0)NEXT'],
  ])('sorts %s vocal groups without moving an early BG before its main', async (format, source) => {
    const result = await parseOfficialLyrics(source, { format });
    expect(result.lines.map((line) => [line.words[0].word, line.startTime, line.isBG])).toEqual([
      ['MAIN', 1000, false], ['BG', 500, true], ['NEXT', 2000, false],
    ]);
  });

  it('decodes encrypted QRC with official decryption and preserves XML line breaks', async () => {
    const xml = '<QrcInfos><Lyric_1 LyricContent="[1000,1000]A(1000,1000)\n[2500,1000]B(2500,1000)" /></QrcInfos>';
    const result = await parseOfficialLyrics(encryptQrcHex(xml), { format: 'eqrc' });
    expect(result.format).toBe('qrc');
    expect(result.lines.map((line) => line.words[0].word)).toEqual(['A', 'B']);
  });

  it('decodes XML QRC entities and escaped newlines', async () => {
    const result = await parseOfficialLyrics('<QrcInfos><Lyric_1 LyricContent="[1000,1000]A &amp; B(1000,1000)\\n[2500,1000]C(2500,1000)" /></QrcInfos>');
    expect(result.lines.map((line) => line.words[0].word)).toEqual(['A & B', 'C']);
  });

  it('uses a supplied format rather than trying unrelated parsers', async () => {
    const result = await parseOfficialLyrics('[00:01]This is LRC', { format: 'yrc' });
    expect(result.format).toBe('yrc');
    expect(result.lines).toEqual([]);
    expect(result.issues).not.toEqual([]);
  });

  it('does not manufacture timed lyrics from unknown input', async () => {
    const result = await parseOfficialLyrics('Unsynchronised original text');
    expect(result).toEqual({ lines: [], format: 'unknown', issues: ['无法识别歌词格式，已保留原文。'] });
  });

  it('reports known-format content that has no valid word timestamps as empty', async () => {
    const result = await parseOfficialLyrics('[1000,2000]Not QRC word syntax', { format: 'qrc' });
    expect(result.lines).toEqual([]);
    expect(result.issues).toContain('没有解析到有效时间歌词，已保留原文。');
  });

  it('routes TTML through the real official DOM parser', async () => {
    const result = await parseOfficialLyrics('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="2s">TTML</p></div></body></tt>');
    expect(result.format).toBe('ttml');
    expect(result.lines[0]).toMatchObject({ startTime: 1000, endTime: 2000 });
    expect(result.lines[0].words[0].word).toBe('TTML');
  });

  it('returns an explicit parse error instead of disguising malformed TTML as empty lyrics', async () => {
    const result = await parseOfficialLyrics('<lyrics />', { format: 'ttml' });
    expect(result.lines).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(result.issues).toContain(result.error);
  });

  it('keeps unsupported plain text and empty metadata distinct from a parse error', async () => {
    expect((await parseOfficialLyrics('plain original')).error).toBeUndefined();
    expect((await parseOfficialLyrics('[ar:Artist]\n[ti:Title]', { format: 'lrc' })).error).toBeUndefined();
    expect((await parseOfficialLyrics('<tt/>', { format: 'ttml' })).error).toBeUndefined();
  });

  it('reports encrypted QRC decoding failure as an error', async () => {
    const result = await parseOfficialLyrics('ff'.repeat(64), { format: 'eqrc' });
    expect(result.lines).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('passes song duration to the TTML missing-end repair', async () => {
    const result = await parseOfficialLyrics('<tt><body><div><p begin="1s">A</p></div></body></tt>', { durationMs: 4500 });
    expect(result.lines[0]).toMatchObject({ startTime: 1000, endTime: 4500 });
    expect(result.lines[0].words[0]).toMatchObject({ startTime: 1000, endTime: 4500 });
  });
});
