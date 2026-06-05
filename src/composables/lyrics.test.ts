import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
});

vi.mock('@applemusic-like-lyrics/lyric/pkg/amll_lyric.js', async () => {
  // @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
  const fs = await import('node:fs/promises');
  // @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
  const os = await import('node:os');
  // @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
  const path = await import('node:path');
  // @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
  const { pathToFileURL } = await import('node:url');
  const cwd = (globalThis as any).process?.cwd?.() ?? '.';

  const pkgDir = path.resolve(cwd, 'node_modules', '@applemusic-like-lyrics', 'lyric', 'pkg');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lycia-amll-'));
  const tempModulePath = path.join(tempDir, 'amll_lyric_bg.mjs');

  await fs.copyFile(path.join(pkgDir, 'amll_lyric_bg.js'), tempModulePath);

  const wrapper = await import(pathToFileURL(tempModulePath).href);
  const wasmBytes = await fs.readFile(path.join(pkgDir, 'amll_lyric_bg.wasm'));
  const { instance } = await WebAssembly.instantiate(wasmBytes, {
    './amll_lyric_bg.js': { ...wrapper },
  });

  wrapper.__wbg_set_wasm(instance.exports);
  wrapper.wasm_start();

  return wrapper;
});

describe('normalizeEslrcSource', async () => {
  const { normalizeEslrcSource } = await import('./lyrics');

  it('keeps valid inline timestamps untouched', () => {
    const input = '[00:07.310]A[00:07.520]B[00:07.780]C[00:07.890]D[00:08.450]E[00:08.650]';

    expect(normalizeEslrcSource(input)).toBe(input);
  });

  it('preserves empty timing gaps before a word with an invisible placeholder', () => {
    const input = '[00:07.545]A[00:07.721][00:07.722]B[00:07.852][00:07.853]C[00:08.022]';

    expect(normalizeEslrcSource(input)).toBe('[00:07.545]A[00:07.721]\u2063[00:07.722]B[00:07.852]\u2063[00:07.853]C[00:08.022]');
  });
});

describe('lyrics font preset normalization', async () => {
  const { normalizeLyricsFontPreset } = await import('./lyrics');

  it('keeps custom system font names', () => {
    expect(normalizeLyricsFontPreset('Maple Mono NF CN')).toBe('Maple Mono NF CN');
  });

  it('falls back for blank values', () => {
    expect(normalizeLyricsFontPreset('   ')).toBe('system');
  });
});

describe('enhanced lrc parser', async () => {
  const {
    isEnhancedLrcLine,
    mergeEnhancedLinesIntoBaseLines,
    parseEnhancedLrc,
    parseEnhancedLrcLine,
    parseTimestampToMs,
  } = await import('./lyrics');

  it('parses enhanced timestamp strings to milliseconds', () => {
    expect(parseTimestampToMs('00:36.111')).toBe(36111);
    expect(parseTimestampToMs('01:02.3')).toBe(62300);
    expect(parseTimestampToMs('bad')).toBeNull();
  });

  it('detects enhanced lrc lines by angle-bracket timestamps', () => {
    expect(isEnhancedLrcLine('[00:36.111]<00:36.111>A<00:36.551>B<00:37.111>')).toBe(true);
    expect(isEnhancedLrcLine('[00:36.111]plain line')).toBe(false);
    expect(isEnhancedLrcLine('[ar:Artist]')).toBe(false);
  });

  it('parses a standard enhanced lrc line into words and line timing', () => {
    const parsed = parseEnhancedLrcLine('[00:36.111]<00:36.111>A<00:36.551>B<00:36.991>C<00:37.421>');

    expect(parsed).not.toBeNull();
    expect(parsed?.startTime).toBe(36111);
    expect(parsed?.endTime).toBe(37421);
    expect(parsed?.words.map((word) => ({
      text: word.word,
      start: word.startTime,
      end: word.endTime,
    }))).toEqual([
      { text: 'A', start: 36111, end: 36551 },
      { text: 'B', start: 36551, end: 36991 },
      { text: 'C', start: 36991, end: 37421 },
    ]);
  });

  it('allows line start time and first word time to differ', () => {
    const parsed = parseEnhancedLrcLine('[00:36.000]<00:36.111>Lead<00:36.551>In<00:36.991>');

    expect(parsed).not.toBeNull();
    expect(parsed?.startTime).toBe(36000);
    expect(parsed?.words[0].startTime).toBe(36111);
    expect(parsed?.endTime).toBe(36991);
  });

  it('supports spaces and punctuation inside enhanced word text', () => {
    const parsed = parseEnhancedLrcLine(`[00:19.960]<00:19.960>Composer:<00:21.292> Yang<00:22.624>${'\uFF1A'}<00:23.956> OK<00:25.288>!<00:26.620>`);

    expect(parsed).not.toBeNull();
    expect(parsed?.words.map((word) => word.word)).toEqual([
      'Composer:',
      ' Yang',
      '\uFF1A',
      ' OK',
      '!',
    ]);
  });

  it('skips zero-length segments created by consecutive enhanced timestamps', () => {
    const parsed = parseEnhancedLrcLine('[00:00.000]<00:00.000>ma<00:00.100><00:00.101>ga<00:00.200><00:00.201>shi<00:00.300>');

    expect(parsed).not.toBeNull();
    expect(parsed?.words.map((word) => ({
      text: word.word,
      start: word.startTime,
      end: word.endTime,
    }))).toEqual([
      { text: 'ma', start: 0, end: 100 },
      { text: 'ga', start: 101, end: 200 },
      { text: 'shi', start: 201, end: 300 },
    ]);
  });

  it('tolerates tiny backward enhanced timestamps when the skipped segment is empty', () => {
    const parsed = parseEnhancedLrcLine('[01:20.847]<01:20.847>「<01:21.063>sha shi <01:21.255>n <01:21.439>wa <01:21.615>ni ga <01:21.964>te <01:22.143>na <01:22.239>n <01:22.335><01:22.336>da <01:22.783><01:22.782>」<01:22.783>');

    expect(parsed).not.toBeNull();
    expect(parsed?.words.map((word) => word.word)).toEqual([
      '「',
      'sha shi ',
      'n ',
      'wa ',
      'ni ga ',
      'te ',
      'na ',
      'n ',
      'da ',
      '」',
    ]);
  });

  it('falls back on malformed enhanced lines while preserving valid enhanced lines', () => {
    const parsed = parseEnhancedLrc([
      '[00:36.111]<00:36.111>A<00:36.551>B<00:36.991>',
      '[00:40.000]<00:40.000>Broken<00:40.500>Line',
      '[00:41.000]plain line',
    ].join('\n'));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].startTime).toBe(36111);
  });

  it('merges enhanced lines into a plain lrc baseline without dropping ordinary lines', () => {
    const enhancedLines = parseEnhancedLrc('[00:10.000]<00:10.000>A<00:10.500>B<00:11.000>');
    const baseLines = [
      {
        words: [{
          startTime: 10000,
          endTime: 11000,
          word: '<00:10.000>A<00:10.500>B<00:11.000>',
          romanWord: '',
        }],
        translatedLyric: '',
        romanLyric: '',
        isBG: false,
        isDuet: false,
        startTime: 10000,
        endTime: 11000,
      },
      {
        words: [{
          startTime: 12000,
          endTime: 13000,
          word: 'Plain line',
          romanWord: '',
        }],
        translatedLyric: '',
        romanLyric: '',
        isBG: false,
        isDuet: false,
        startTime: 12000,
        endTime: 13000,
      },
    ];

    const merged = mergeEnhancedLinesIntoBaseLines(enhancedLines, baseLines);

    expect(merged).toHaveLength(2);
    expect(merged[0].words.map((word) => word.word)).toEqual(['A', 'B']);
    expect(merged[1].words[0]?.word).toBe('Plain line');
  });
});

describe('mergePreparedLines', async () => {
  const {
    getCurrentLyricDisplayLines,
    getDisplaySubtitles,
    getLineScriptProfile,
    mergePreparedLines,
  } = await import('./lyrics');

  it('keeps the earlier source line as the main line for bilingual groups', () => {
    const merged = mergePreparedLines([
      {
        startMs: 35308,
        endMs: 45395,
        text: 'I sit by myself talking to the moon',
        translation: '',
        romaji: '',
        words: [{
          text: 'I sit by myself talking to the moon',
          start: 35.308,
          end: 45.395,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 35308,
        endMs: 45390,
        text: '\u6211\u72ec\u81ea\u5750\u7740 \u5411\u768e\u6d01\u7684\u6708\u4eae\u503e\u8bc9\u5fc3\u58f0',
        translation: '',
        romaji: '',
        words: [{
          text: '\u6211\u72ec\u81ea\u5750\u7740 \u5411\u768e\u6d01\u7684\u6708\u4eae\u503e\u8bc9\u5fc3\u58f0',
          start: 35.308,
          end: 45.39,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('I sit by myself talking to the moon');
    expect(merged[0].translation).toBe('\u6211\u72ec\u81ea\u5750\u7740 \u5411\u768e\u6d01\u7684\u6708\u4eae\u503e\u8bc9\u5fc3\u58f0');
  });

  it('still prefers explicit translation-bearing lines as the main carrier', () => {
    const merged = mergePreparedLines([
      {
        startMs: 1000,
        endMs: 3000,
        text: 'Main',
        translation: '\u526f\u884c',
        romaji: '',
        words: [{
          text: 'Main',
          start: 1,
          end: 3,
          romaji: '',
        }],
        sourceIndex: 1,
      },
      {
        startMs: 1000,
        endMs: 2990,
        text: 'Alt',
        translation: '',
        romaji: '',
        words: [{
          text: 'Alt',
          start: 1,
          end: 2.99,
          romaji: '',
        }],
        sourceIndex: 0,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('Main');
    expect(merged[0].translation).toBe('\u526f\u884c');
  });

  it('classifies japanese lyric groups by content instead of source order', () => {
    const merged = mergePreparedLines([
      {
        startMs: 43802,
        endMs: 46596,
        text: 'so no hi ka ra na ni mo ka mo',
        translation: '',
        romaji: '',
        words: [{
          text: 'so no hi ka ra na ni mo ka mo',
          start: 43.802,
          end: 46.596,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 43802,
        endMs: 46596,
        text: '\u305d\u306e\u65e5\u304b\u3089\u4f55\u3082\u304b\u3082',
        translation: '',
        romaji: '',
        words: [{
          text: '\u305d\u306e\u65e5\u304b\u3089\u4f55\u3082\u304b\u3082',
          start: 43.802,
          end: 46.596,
          romaji: '',
        }],
        sourceIndex: 1,
      },
      {
        startMs: 43802,
        endMs: 46844,
        text: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
        translation: '',
        romaji: '',
        words: [{
          text: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
          start: 43.802,
          end: 46.844,
          romaji: '',
        }],
        sourceIndex: 2,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('\u305d\u306e\u65e5\u304b\u3089\u4f55\u3082\u304b\u3082');
    expect(merged[0].translation).toBe('\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e');
    expect(merged[0].romaji).toBe('so no hi ka ra na ni mo ka mo');
    expect(merged[0].words?.[0]?.romaji).toBe('so no hi ka ra na ni mo ka mo');
  });

  it('keeps english bilingual groups stable without treating english as romaji', () => {
    const merged = mergePreparedLines([
      {
        startMs: 24139,
        endMs: 26668,
        text: 'You are all I had',
        translation: '',
        romaji: '',
        words: [{
          text: 'You are all I had',
          start: 24.139,
          end: 26.668,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 24139,
        endMs: 28900,
        text: '\u4f60\u662f\u6211\u62e5\u6709\u7684\u4e00\u5207',
        translation: '',
        romaji: '',
        words: [{
          text: '\u4f60\u662f\u6211\u62e5\u6709\u7684\u4e00\u5207',
          start: 24.139,
          end: 28.9,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('You are all I had');
    expect(merged[0].translation).toBe('\u4f60\u662f\u6211\u62e5\u6709\u7684\u4e00\u5207');
    expect(merged[0].romaji).toBe('');
  });

  it('classifies chinese-dominant mixed lines as translations for latin main lines', () => {
    const merged = mergePreparedLines([
      {
        startMs: 74530,
        endMs: 78000,
        text: 'A-Z Looser-KrankheitWas IS das?',
        translation: '',
        romaji: '',
        words: [{
          text: 'A-Z Looser-KrankheitWas IS das?',
          start: 74.53,
          end: 78,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 74530,
        endMs: 78000,
        text: 'A-Z \u5931\u8d25\u8005-\u75be\u75c5-\u662f\u4ec0\u4e48\uff1f',
        translation: '',
        romaji: '',
        words: [{
          text: 'A-Z \u5931\u8d25\u8005-\u75be\u75c5-\u662f\u4ec0\u4e48\uff1f',
          start: 74.53,
          end: 78,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      text: 'A-Z Looser-KrankheitWas IS das?',
      translation: 'A-Z \u5931\u8d25\u8005-\u75be\u75c5-\u662f\u4ec0\u4e48\uff1f',
      romaji: '',
    });
    expect(merged[0]?.secondary).toBeUndefined();
  });

  it('classifies korean lyric groups as main plus chinese translation', () => {
    const merged = mergePreparedLines([
      {
        startMs: 12000,
        endMs: 15000,
        text: '\uadf8\ub7f0 \ub0a0\uc774 \uc788\uc5c8\uc9c0',
        translation: '',
        romaji: '',
        words: [{
          text: '\uadf8\ub7f0 \ub0a0\uc774 \uc788\uc5c8\uc9c0',
          start: 12,
          end: 15,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 12000,
        endMs: 15000,
        text: '\u90a3\u6837\u7684\u65e5\u5b50\u66fe\u7ecf\u5b58\u5728',
        translation: '',
        romaji: '',
        words: [{
          text: '\u90a3\u6837\u7684\u65e5\u5b50\u66fe\u7ecf\u5b58\u5728',
          start: 12,
          end: 15,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('\uadf8\ub7f0 \ub0a0\uc774 \uc788\uc5c8\uc9c0');
    expect(merged[0].translation).toBe('\u90a3\u6837\u7684\u65e5\u5b50\u66fe\u7ecf\u5b58\u5728');
    expect(merged[0].romaji).toBe('');
  });

  it('treats chinese plus latin as latin main and chinese translation', () => {
    const merged = mergePreparedLines([
      {
        startMs: 5000,
        endMs: 8000,
        text: '\u5fc3\u91cc\u6709\u4e00\u4e2a\u68a6',
        translation: '',
        romaji: '',
        words: [{
          text: '\u5fc3\u91cc\u6709\u4e00\u4e2a\u68a6',
          start: 5,
          end: 8,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 5000,
        endMs: 8000,
        text: 'xin li you yi ge meng',
        translation: '',
        romaji: '',
        words: [{
          text: 'xin li you yi ge meng',
          start: 5,
          end: 8,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('xin li you yi ge meng');
    expect(merged[0].translation).toBe('\u5fc3\u91cc\u6709\u4e00\u4e2a\u68a6');
    expect(merged[0].romaji).toBe('');
  });

  it('treats chinese plus non-latin foreign text as foreign main and chinese translation', () => {
    const merged = mergePreparedLines([
      {
        startMs: 9000,
        endMs: 12000,
        text: '\u4f60\u662f\u6211\u7684\u7231',
        translation: '',
        romaji: '',
        words: [{
          text: '\u4f60\u662f\u6211\u7684\u7231',
          start: 9,
          end: 12,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 9000,
        endMs: 12000,
        text: '\u042f \u043b\u044e\u0431\u043b\u044e \u0442\u0435\u0431\u044f',
        translation: '',
        romaji: '',
        words: [{
          text: '\u042f \u043b\u044e\u0431\u043b\u044e \u0442\u0435\u0431\u044f',
          start: 9,
          end: 12,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('\u042f \u043b\u044e\u0431\u043b\u044e \u0442\u0435\u0431\u044f');
    expect(merged[0].translation).toBe('\u4f60\u662f\u6211\u7684\u7231');
    expect(merged[0].romaji).toBe('');
  });

  it('keeps non-latin foreign text as main when it appears before chinese', () => {
    const merged = mergePreparedLines([
      {
        startMs: 13000,
        endMs: 16000,
        text: '\u042f \u043b\u044e\u0431\u043b\u044e \u0442\u0435\u0431\u044f',
        translation: '',
        romaji: '',
        words: [{
          text: '\u042f \u043b\u044e\u0431\u043b\u044e \u0442\u0435\u0431\u044f',
          start: 13,
          end: 16,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 13000,
        endMs: 16000,
        text: '\u4f60\u662f\u6211\u7684\u7231',
        translation: '',
        romaji: '',
        words: [{
          text: '\u4f60\u662f\u6211\u7684\u7231',
          start: 13,
          end: 16,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('\u042f \u043b\u044e\u0431\u043b\u044e \u0442\u0435\u0431\u044f');
    expect(merged[0].translation).toBe('\u4f60\u662f\u6211\u7684\u7231');
    expect(merged[0].romaji).toBe('');
  });

  it('keeps enhanced main-word timing while attaching a translated line', () => {
    const merged = mergePreparedLines([
      {
        startMs: 1000,
        endMs: 2400,
        text: 'Hello',
        translation: '',
        romaji: '',
        words: [
          { text: 'Hel', start: 1, end: 1.7, romaji: '' },
          { text: 'lo', start: 1.7, end: 2.4, romaji: '' },
        ],
        sourceIndex: 0,
      },
      {
        startMs: 1000,
        endMs: 2400,
        text: '\u4f60\u597d',
        translation: '',
        romaji: '',
        words: [{
          text: '\u4f60\u597d',
          start: 1,
          end: 2.4,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].translation).toBe('\u4f60\u597d');
    expect(merged[0].words).toEqual([
      { text: 'Hel', start: 1, end: 1.7, romaji: '' },
      { text: 'lo', start: 1.7, end: 2.4, romaji: '' },
    ]);
  });

  it('merges bilingual lines with tiny timestamp drift but not beyond the safety cap', () => {
    const merged = mergePreparedLines([
      {
        startMs: 1000,
        endMs: 2400,
        text: 'Main line',
        translation: '',
        romaji: '',
        words: [{
          text: 'Main line',
          start: 1,
          end: 2.4,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 1004,
        endMs: 2400,
        text: '\u526f\u884c',
        translation: '',
        romaji: '',
        words: [{
          text: '\u526f\u884c',
          start: 1.004,
          end: 2.4,
          romaji: '',
        }],
        sourceIndex: 1,
      },
      {
        startMs: 5000,
        endMs: 6400,
        text: 'Next sentence',
        translation: '',
        romaji: '',
        words: [{
          text: 'Next sentence',
          start: 5,
          end: 6.4,
          romaji: '',
        }],
        sourceIndex: 2,
      },
      {
        startMs: 7000,
        endMs: 8200,
        text: 'Standalone',
        translation: '',
        romaji: '',
        words: [{
          text: 'Standalone',
          start: 7,
          end: 8.2,
          romaji: '',
        }],
        sourceIndex: 3,
      },
      {
        startMs: 7065,
        endMs: 8200,
        text: '\u4e0d\u5e94\u8be5\u5408\u5e76',
        translation: '',
        romaji: '',
        words: [{
          text: '\u4e0d\u5e94\u8be5\u5408\u5e76',
          start: 7.065,
          end: 8.2,
          romaji: '',
        }],
        sourceIndex: 4,
      },
      {
        startMs: 12000,
        endMs: 13200,
        text: 'Afterward',
        translation: '',
        romaji: '',
        words: [{
          text: 'Afterward',
          start: 12,
          end: 13.2,
          romaji: '',
        }],
        sourceIndex: 5,
      },
    ]);

    expect(merged[0].translation).toBe('\u526f\u884c');
    expect(merged.map((line) => line.text)).toEqual([
      'Main line',
      'Next sentence',
      'Standalone',
      '\u4e0d\u5e94\u8be5\u5408\u5e76',
      'Afterward',
    ]);
  });

  it('groups rapid same-script lines by timestamp boundaries only', () => {
    const merged = mergePreparedLines([
      {
        startMs: 0,
        endMs: 200,
        text: 'one',
        translation: '',
        romaji: '',
        words: [{ text: 'one', start: 0, end: 0.2, romaji: '' }],
        sourceIndex: 0,
      },
      {
        startMs: 40,
        endMs: 240,
        text: 'two',
        translation: '',
        romaji: '',
        words: [{ text: 'two', start: 0.04, end: 0.24, romaji: '' }],
        sourceIndex: 1,
      },
      {
        startMs: 85,
        endMs: 260,
        text: 'three',
        translation: '',
        romaji: '',
        words: [{ text: 'three', start: 0.085, end: 0.26, romaji: '' }],
        sourceIndex: 2,
      },
    ]);

    expect(merged.map((line) => line.text)).toEqual(['one', 'two']);
    expect(merged[0]?.secondary).toBeUndefined();
    expect(merged[1]?.secondary).toEqual(['three']);
  });

  it('falls back to secondary lines when same-script groups are ambiguous', () => {
    const merged = mergePreparedLines([
      {
        startMs: 2000,
        endMs: 4000,
        text: '\u6211\u4eec\u8fd8\u5728\u8fd9\u91cc',
        translation: '',
        romaji: '',
        words: [{
          text: '\u6211\u4eec\u8fd8\u5728\u8fd9\u91cc',
          start: 2,
          end: 4,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 2000,
        endMs: 4000,
        text: '\u540c\u6b65\u7684\u53e6\u4e00\u884c',
        translation: '',
        romaji: '',
        words: [{
          text: '\u540c\u6b65\u7684\u53e6\u4e00\u884c',
          start: 2,
          end: 4,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].translation).toBe('');
    expect(merged[0].romaji).toBe('');
    expect(merged[0].secondary).toEqual(['\u540c\u6b65\u7684\u53e6\u4e00\u884c']);
  });

  it('keeps every near-identical timestamp line in one group and stores overflow as secondary', () => {
    const merged = mergePreparedLines([
      {
        startMs: 10000,
        endMs: 13000,
        text: 'kimi no na wa',
        translation: '',
        romaji: '',
        words: [{
          text: 'kimi no na wa',
          start: 10,
          end: 13,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 10020,
        endMs: 13000,
        text: '\u541b\u306e\u540d\u306f',
        translation: '',
        romaji: '',
        words: [{
          text: '\u541b\u306e\u540d\u306f',
          start: 10.02,
          end: 13,
          romaji: '',
        }],
        sourceIndex: 1,
      },
      {
        startMs: 10040,
        endMs: 13000,
        text: '\u4f60\u7684\u540d\u5b57',
        translation: '',
        romaji: '',
        words: [{
          text: '\u4f60\u7684\u540d\u5b57',
          start: 10.04,
          end: 13,
          romaji: '',
        }],
        sourceIndex: 2,
      },
      {
        startMs: 10050,
        endMs: 13000,
        text: '\u540c\u6b65\u5907\u7528\u884c',
        translation: '',
        romaji: '',
        words: [{
          text: '\u540c\u6b65\u5907\u7528\u884c',
          start: 10.05,
          end: 13,
          romaji: '',
        }],
        sourceIndex: 3,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      text: '\u541b\u306e\u540d\u306f',
      translation: '\u4f60\u7684\u540d\u5b57',
      romaji: 'kimi no na wa',
      secondary: ['\u540c\u6b65\u5907\u7528\u884c'],
    });
  });

  it('keeps a single chinese line as the main lyric', () => {
    const merged = mergePreparedLines([
      {
        startMs: 10000,
        endMs: 13000,
        text: '\u6211\u66fe\u7ecf\u8de8\u8fc7\u5c71\u548c\u5927\u6d77',
        translation: '',
        romaji: '',
        words: [{
          text: '\u6211\u66fe\u7ecf\u8de8\u8fc7\u5c71\u548c\u5927\u6d77',
          start: 10,
          end: 13,
          romaji: '',
        }],
        sourceIndex: 0,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      text: '\u6211\u66fe\u7ecf\u8de8\u8fc7\u5c71\u548c\u5927\u6d77',
      translation: '',
      romaji: '',
    });
  });

  it('keeps all-latin groups as first line plus secondary lines', () => {
    const merged = mergePreparedLines([
      {
        startMs: 10000,
        endMs: 13000,
        text: 'kimi no na wa',
        translation: '',
        romaji: '',
        words: [{
          text: 'kimi no na wa',
          start: 10,
          end: 13,
          romaji: '',
        }],
        sourceIndex: 0,
      },
      {
        startMs: 10000,
        endMs: 13000,
        text: 'boku wa mada',
        translation: '',
        romaji: '',
        words: [{
          text: 'boku wa mada',
          start: 10,
          end: 13,
          romaji: '',
        }],
        sourceIndex: 1,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      text: 'kimi no na wa',
      translation: '',
      romaji: '',
      secondary: ['boku wa mada'],
    });
  });

  it('detects hangul characters when building the script profile', () => {
    const profile = getLineScriptProfile('\uadf8\ub7f0 \ub0a0\uc774 \uc788\uc5c8\uc9c0');

    expect(profile.hangulCount).toBeGreaterThan(0);
    expect(profile.dominantScript).toBe('hangul');
  });

  it('orders visible sublines as romaji first and translation second', () => {
    const subtitles = getDisplaySubtitles({
      translation: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
      romaji: 'so no hi ka ra na ni mo ka mo',
    }, true, true);

    expect(subtitles).toEqual({
      upper: 'so no hi ka ra na ni mo ka mo',
      lower: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
    });
  });

  it('hides romaji by default while keeping translation visible', () => {
    const subtitles = getDisplaySubtitles({
      translation: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
      romaji: 'so no hi ka ra na ni mo ka mo',
    }, true, false);

    expect(subtitles).toEqual({
      upper: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
      lower: '',
    });
  });

  it('exposes timed romaji words for the secondary display line', () => {
    const displayLines = getCurrentLyricDisplayLines({
      time: 43.802,
      endTime: 46.596,
      text: '\u305d\u306e\u65e5\u304b\u3089\u4f55\u3082\u304b\u3082',
      translation: '\u4ece\u90a3\u5929\u5f00\u59cb\u4f3c\u4e4e',
      romaji: 'so no hi ka ra na ni mo ka mo',
      words: [
        { text: '\u305d\u306e', start: 43.802, end: 44.2, romaji: 'so no ' },
        { text: '\u65e5\u304b\u3089', start: 44.2, end: 45, romaji: 'hi ka ra ' },
        { text: '\u4f55\u3082\u304b\u3082', start: 45, end: 46.596, romaji: 'na ni mo ka mo' },
      ],
    }, true, true);

    expect(displayLines.map((line) => line.kind)).toEqual(['main', 'romaji', 'translation']);
    expect(displayLines[1]?.words).toEqual([
      { text: 'so no ', start: 43.802, end: 44.2 },
      { text: 'hi ka ra ', start: 44.2, end: 45 },
      { text: 'na ni mo ka mo', start: 45, end: 46.596 },
    ]);
  });
});

describe('lyrics settings normalization', async () => {
  const {
    MAX_PLAYER_OFFSET_X,
    MIN_PLAYER_OFFSET_Y,
    normalizeDesktopLyricsSettingsPatch,
    normalizeLyricsSettingsPatch,
  } = await import('./lyrics');

  it('clamps player offsets for migrated player settings', () => {
    const normalized = normalizeLyricsSettingsPatch({
      playerOffsetX: 999,
      playerOffsetY: -999,
    });

    expect(normalized.playerOffsetX).toBe(MAX_PLAYER_OFFSET_X);
    expect(normalized.playerOffsetY).toBe(MIN_PLAYER_OFFSET_Y);
  });

  it('defaults desktop auto-hide on fullscreen to enabled', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.autoHideWhenFullscreen).toBe(true);
  });

  it('defaults desktop auto-hide on pause to disabled', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.autoHideWhenPaused).toBe(false);
  });

  it('defaults desktop double line display to disabled', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.showDoubleLine).toBe(false);
  });

  it('defaults desktop word effect to enabled', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.enableWordEffect).toBe(true);
  });

  it('restores desktop split-corner alignment from migrated settings', () => {
    expect(normalizeDesktopLyricsSettingsPatch({
      playerAlignment: 'split-corners',
    }).playerAlignment).toBe('split-corners');
  });

  it('keeps non-desktop lyric alignment limited to horizontal values', () => {
    const normalized = normalizeLyricsSettingsPatch({
      playerAlignment: 'split-corners' as any,
    });

    expect(normalized.playerAlignment).toBe('left');
  });

  it('restores desktop auto-hide on fullscreen from migrated values', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      autoHideWhenFullscreen: false,
    });

    expect(normalized.autoHideWhenFullscreen).toBe(false);
  });

  it('restores desktop auto-hide on pause from persisted values', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      autoHideWhenPaused: true,
    });

    expect(normalized.autoHideWhenPaused).toBe(true);
  });

  it('restores desktop double line display from migrated values', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      showDoubleLine: true,
    });

    expect(normalized.showDoubleLine).toBe(true);
  });

  it('restores desktop word effect from migrated values', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      enableWordEffect: false,
    });

    expect(normalized.enableWordEffect).toBe(false);
  });

  it('defaults desktop readability settings with independent disabled shadows', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.textOpacity).toBe(1);
    expect(normalized.textShadowColor).toBe('#000000');
    expect(normalized.firstLineTextShadowStrength).toBe(0);
    expect(normalized.secondLineTextShadowStrength).toBe(0);
  });

  it('normalizes desktop readability settings from migrated values', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      textOpacity: 2,
      textShadowColor: 'not-a-color',
      firstLineTextShadowStrength: 180,
      secondLineTextShadowStrength: -20,
    } as any);

    expect(normalized.textOpacity).toBe(1);
    expect(normalized.textShadowColor).toBe('#000000');
    expect(normalized.firstLineTextShadowStrength).toBe(100);
    expect(normalized.secondLineTextShadowStrength).toBe(0);
  });

  it('maps legacy desktop text shadow strength to both lyric lines', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      textShadowStrength: 45,
    } as any);

    expect(normalized.firstLineTextShadowStrength).toBe(45);
    expect(normalized.secondLineTextShadowStrength).toBe(45);
  });
});

describe('raw lyrics samples from the common formats checklist', async () => {
  const {
    buildSemanticLines,
    convertLyricsToAmlLines,
    prepareParsedLyrics,
    semanticLineToLyricLine,
    getCurrentLyricDisplayLines,
  } = await import('./lyrics');

  async function parseRawToLyricLines(raw: string) {
    const parsed = await prepareParsedLyrics(raw);
    return buildSemanticLines(parsed).map(semanticLineToLyricLine);
  }

  function normalizeWhitespace(text: string) {
    return text.replace(/\s+/g, ' ').trim();
  }

  it('parses inline timestamp chinese lrc into timed words', async () => {
    const lines = await parseRawToLyricLines([
      '[00:00.000]如[00:00.375]果[00:00.750]当[00:01.125]时[00:01.500] [00:01.875]-[00:02.250] [00:02.625]许[00:03.000]嵩[00:03.375]',
      '[00:03.380]词[00:04.227]：[00:05.074]许[00:05.921]嵩[00:06.768]',
    ].join('\n'));

    expect(lines).toHaveLength(2);
    expect(lines[0]?.text).toBe('如果当时 - 许嵩');
    expect(lines[0]?.words?.map((word) => word.text)).toEqual([
      '如',
      '果',
      '当',
      '时',
      ' ',
      '-',
      ' ',
      '许',
      '嵩',
    ]);
    expect(lines[0]?.translation).toBe('');
    expect(lines[0]?.romaji).toBe('');
  });

  it('parses plain line-by-line lrc without losing ordering', async () => {
    const lines = await parseRawToLyricLines([
      '[00:00.000]如果当时 - 许嵩',
      '[00:03.380]词：许嵩',
      '[00:06.770]曲：许嵩',
      '[00:10.150]编曲：许嵩',
    ].join('\n'));

    expect(lines.map((line) => line.text)).toEqual([
      '如果当时 - 许嵩',
      '词：许嵩',
      '曲：许嵩',
      '编曲：许嵩',
    ]);
  });

  it('parses enhanced lrc and keeps per-word timing', async () => {
    const lines = await parseRawToLyricLines([
      '[00:00.000]<00:00.000>如<00:00.375>果<00:00.750>当<00:01.125>时<00:01.500> <00:01.875>-<00:02.250> <00:02.625>许<00:03.000>嵩<00:03.375>',
    ].join('\n'));

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('如果当时 - 许嵩');
    expect(lines[0]?.words?.map((word) => ({
      text: word.text,
      start: word.start,
      end: word.end,
    }))).toEqual([
      { text: '如', start: 0, end: 0.375 },
      { text: '果', start: 0.375, end: 0.75 },
      { text: '当', start: 0.75, end: 1.125 },
      { text: '时', start: 1.125, end: 1.5 },
      { text: ' ', start: 1.5, end: 1.875 },
      { text: '-', start: 1.875, end: 2.25 },
      { text: ' ', start: 2.25, end: 2.625 },
      { text: '许', start: 2.625, end: 3 },
      { text: '嵩', start: 3, end: 3.375 },
    ]);
  });

  it('classifies latin plus chinese bilingual lyrics as main plus translation across raw lrc input', async () => {
    const lines = await parseRawToLyricLines([
      '[00:14.727]You know you love me I know you care',
      '[00:14.727]你知道你爱我 我知道你在意',
      '[00:18.389]Just shout whenever and I\'ll be there',
      '[00:18.389]你只要呼唤我 我就会马上出现',
    ].join('\n'));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      text: 'You know you love me I know you care',
      translation: '你知道你爱我 我知道你在意',
      romaji: '',
    });
    expect(lines[1]).toMatchObject({
      text: 'Just shout whenever and I\'ll be there',
      translation: '你只要呼唤我 我就会马上出现',
      romaji: '',
    });
  });

  it('classifies chinese plus latin bilingual lyrics as latin main plus chinese translation across raw lrc input', async () => {
    const lines = await parseRawToLyricLines([
      '[00:21.680]你是我的爱',
      '[00:21.680]You are my love',
    ].join('\n'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      text: 'You are my love',
      translation: '你是我的爱',
      romaji: '',
    });
  });

  it('keeps english enhanced lines and attaches chinese translation from the same timestamp group', async () => {
    const lines = await parseRawToLyricLines([
      '[00:14.727]<00:14.727>You <00:14.896>know <00:15.071>you <00:15.248>love <00:15.576>me <00:16.016><00:16.592>I <00:16.784>know <00:16.992>you <00:17.159>care<00:18.014>',
      '[00:14.727]<00:14.727>你知道你爱我 我知道你在意<00:18.380>',
    ].join('\n'));

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('You know you love me I know you care');
    expect(lines[0]?.translation).toBe('你知道你爱我 我知道你在意');
    expect(lines[0]?.words?.length).toBeGreaterThan(3);
  });

  it('classifies japanese raw lrc groups as main plus romaji plus translation', async () => {
    const lines = await parseRawToLyricLines([
      '[00:43.792]mo u hi to tsu fu ya shi ma sho u ',
      '[00:43.792]もう一つ増やしましょう',
      '[00:43.792]但让我们再多加一个吧',
      '[00:52.399]wa su re ta ku na i ko to ',
      '[00:52.399]忘れたくないこと',
      '[00:52.399]我不愿遗忘',
    ].join('\n'));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      text: 'もう一つ増やしましょう',
      romaji: 'mo u hi to tsu fu ya shi ma sho u',
      translation: '但让我们再多加一个吧',
    });
    expect(lines[1]).toMatchObject({
      text: '忘れたくないこと',
      romaji: 'wa su re ta ku na i ko to',
      translation: '我不愿遗忘',
    });
  });

  it('preserves japanese enhanced word timing and exposes romaji then translation in display order', async () => {
    const lines = await parseRawToLyricLines([
      '[01:01.072]<01:01.072>wa <01:01.336>su <01:01.633>re <01:01.863>ta <01:02.103>ku <01:02.352>na <01:02.577>i <01:02.823>ko <01:03.159>to <01:03.553>',
      '[01:01.072]<01:01.072>忘<01:01.633>れ<01:01.863>た<01:02.103>く<01:02.352>な<01:02.577>い<01:02.823>こ<01:03.159>と<01:03.553>',
      '[01:01.072]<01:01.072>我不愿遗忘<01:03.790>',
    ].join('\n'));

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('忘れたくないこと');
    expect(lines[0]?.romaji).toBe('wa su re ta ku na i ko to');
    expect(lines[0]?.translation).toBe('我不愿遗忘');
    expect(lines[0]?.words?.map((word) => word.text)).toEqual([
      '忘',
      'れ',
      'た',
      'く',
      'な',
      'い',
      'こ',
      'と',
    ]);

    const displayLines = getCurrentLyricDisplayLines(lines[0]!, true, true);
    expect(displayLines.map((line) => line.kind)).toEqual(['main', 'romaji', 'translation']);
  });

  it('keeps mixed kana-kanji enhanced japanese lines as the main lyric even when romaji comes first', async () => {
    const lines = await parseRawToLyricLines([
      '[00:00.624]<00:00.624>ki mi  <00:01.040>ga  <00:01.347>bo ku  <00:02.384>ni  <00:02.945>mi  <00:03.336>se  <00:03.656>te  <00:04.024>ku  <00:04.560>re  <00:05.042>ta <00:05.905>',
      '[00:00.624]<00:00.624>君<00:01.040>が<00:01.347>僕<00:02.384>に<00:02.945>見<00:03.336>せ<00:03.656>て<00:04.024>く<00:04.560>れ<00:05.042>た<00:05.905>',
      '[00:00.624]<00:00.624>是你让我看到了<00:05.905>',
      '[00:05.905]<00:05.905>se ka  <00:06.122>i  <00:06.505>wa  <00:07.000>to  <00:07.272>te  <00:07.600>mo  <00:07.943>ki re  <00:08.559>i  <00:09.311>da  <00:09.587>tsu  <00:09.863>ta  <00:10.367>na <00:11.371>',
      '[00:05.905]<00:05.905>世<00:06.122>界<00:06.505>は<00:07.000>と<00:07.272>て<00:07.600>も<00:07.943>綺<00:08.559>麗<00:09.311>だ<00:09.587>っ<00:09.863>た<00:10.367>な<00:11.371>',
      '[00:05.905]<00:05.905>世界有多么美丽<00:11.371>',
    ].join('\n'));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      text: '君が僕に見せてくれた',
      translation: '是你让我看到了',
    });
    expect(normalizeWhitespace(lines[0]?.romaji || '')).toBe('ki mi ga bo ku ni mi se te ku re ta');
    expect(lines[1]).toMatchObject({
      text: '世界はとても綺麗だったな',
      translation: '世界有多么美丽',
    });
    expect(normalizeWhitespace(lines[1]?.romaji || '')).toBe('se ka i wa to te mo ki re i da tsu ta na');
    expect(lines[1]?.words?.map((word) => word.text)).toEqual([
      '世',
      '界',
      'は',
      'と',
      'て',
      'も',
      '綺',
      '麗',
      'だ',
      'っ',
      'た',
      'な',
    ]);
  });

  it('keeps english-prefixed japanese lines as the main lyric instead of promoting romaji', async () => {
    const lines = await parseRawToLyricLines([
      '[00:18.924]<00:18.924>Silent <00:19.467><00:19.468>haze <00:19.679>ka <00:20.231>su <00:20.269><00:20.270>mi <00:20.606>ga <00:20.989>chi <00:21.041><00:21.042>ni <00:21.411><00:21.412>to <00:21.923>ra <00:22.117><00:22.118>e <00:22.638>ru <00:23.149>ka <00:23.596><00:23.597>ge <00:24.213>',
      '[00:18.924]<00:18.924>Silent <00:19.468>haze <00:19.679>霞<00:20.270>み<00:20.606>が<00:20.990>ち<00:21.043>に<00:21.412>捉<00:22.118>え<00:22.638>る<00:23.150>影<00:24.214>',
      '[00:18.924]<00:18.924>静谧薄雾中捕捉到那朦胧的身影<00:25.010>',
    ].join('\n'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      text: 'Silent haze 霞みがちに捉える影',
      translation: '静谧薄雾中捕捉到那朦胧的身影',
    });
    expect(normalizeWhitespace(lines[0]?.romaji || '')).toBe('Silent haze ka su mi ga chi ni to ra e ru ka ge');
    expect(lines[0]?.words?.map((word) => word.text)).toEqual([
      'Silent ',
      'haze ',
      '霞',
      'み',
      'が',
      'ち',
      'に',
      '捉',
      'え',
      'る',
      '影',
    ]);
  });

  it('keeps numeric-prefixed japanese enhanced lines as main and avoids duplicate romaji rendering', async () => {
    const lines = await parseRawToLyricLines([
      '[00:25.014]<00:25.014>ha <00:25.260><00:25.653>chi <00:25.653>ro <00:25.725><00:25.726>ku <00:26.055>no <00:26.457><00:26.458>ri <00:26.470><00:26.471>zu <00:26.798>mu <00:27.197><00:27.198><00:27.198>ka <00:27.550><00:27.551>ki <00:27.571><00:27.572>mi <00:28.073>da <00:29.185><00:29.186>sa <00:29.449><00:29.450>re <00:29.920>ru <00:30.426>',
      '[00:25.014]<00:25.014>6<00:25.654>/<00:25.654>8<00:26.056>の<00:26.459>リ<00:26.471>ズ<00:26.799>ム<00:27.199> <00:27.199>掻<00:27.551>き<00:27.572>乱<00:29.186>さ<00:29.450>れ<00:29.921>る<00:30.428>',
      '[00:25.014]<00:25.014>八六原本平和的旋律开始被打乱<00:30.710>',
    ].join('\n'));

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('6/8のリズム 掻き乱される');
    expect(normalizeWhitespace(lines[0]?.romaji || '')).toBe('ha chi ro ku no ri zu mu ka ki mi da sa re ru');
    expect(lines[0]?.translation).toBe('八六原本平和的旋律开始被打乱');

    const amlLines = convertLyricsToAmlLines(lines, true, true);
    expect(amlLines[0]?.romanLyric).toBe('ha chi ro ku no ri zu mu ka ki mi da sa re ru');
    expect(amlLines[0]?.words.map((word) => word.word)).toEqual([
      '6',
      '/',
      '8',
      'の',
      'リ',
      'ズ',
      'ム',
      ' ',
      '掻',
      'き',
      '乱',
      'さ',
      'れ',
      'る',
    ]);
    expect(amlLines[0]?.words.map((word) => word.romanWord || '')).toEqual([
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  });

  it('aggregates multi-syllable romaji fragments into timed AML karaoke words', async () => {
    const lines = await parseRawToLyricLines([
      '[01:06.435]<01:06.435>a <01:06.534><01:06.535>o <01:06.718><01:06.719>i <01:06.934>da <01:07.206><01:07.207>so <01:07.535>ra <01:08.127>ga <01:09.118><01:09.119>i <01:09.582><01:09.583>ro <01:10.166>wo <01:10.765><01:10.766>ka <01:11.039><01:11.040>e <01:11.247>ru <01:11.446>ka <01:11.852><01:11.853>ra <01:12.159>',
      '[01:06.435]<01:06.435>仰<01:06.719>い<01:06.935>だ<01:07.207>空<01:08.128>が<01:09.119>色<01:10.167>を<01:10.767>変<01:11.040>え<01:11.247>る<01:11.447>か<01:11.854>ら<01:12.160>',
      '[01:06.435]<01:06.435>仰望的天空终将不复昔日色彩<01:12.570>',
    ].join('\n'));

    expect(lines).toHaveLength(1);
    expect(lines[0]?.words?.map((word) => normalizeWhitespace(word.romaji || ''))).toEqual([
      'a o',
      'i',
      'da',
      'so ra',
      'ga',
      'i ro',
      'wo',
      'ka',
      'e',
      'ru',
      'ka',
      'ra',
    ]);

    const amlLines = convertLyricsToAmlLines(lines, true, true);
    expect(amlLines).toHaveLength(1);
    expect(amlLines[0]?.romanLyric).toBe('');
    expect(amlLines[0]?.words.map((word) => normalizeWhitespace(word.romanWord || ''))).toEqual([
      'a o',
      'i',
      'da',
      'so ra',
      'ga',
      'i ro',
      'wo',
      'ka',
      'e',
      'ru',
      'ka',
      'ra',
    ]);
  });

  it('falls back to whole-line romaji when timed romaji cannot cover every Japanese word', async () => {
    const lines = await parseRawToLyricLines([
      '[00:12.651]<00:12.651>ka <00:12.884>yo <00:13.267>wa <00:13.476>i <00:13.678>hi <00:14.126>ka <00:14.543>ri <00:18.056>',
      '[00:12.651]<00:12.651>か<00:12.884>弱<00:13.476>い<00:13.678>光<00:14.553>が<00:14.897>指<00:15.616>差<00:16.936>す<00:17.007>先<00:18.056>',
      '[00:12.651]<00:12.651>追寻着那道微弱光线所指的方向<00:18.920>',
    ].join('\n'));

    expect(lines).toHaveLength(1);
    expect(lines[0]?.romaji).toBe('ka yo wa i hi ka ri');
    expect(lines[0]?.words?.map((word) => normalizeWhitespace(word.romaji || ''))).toEqual([
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);

    const amlLines = convertLyricsToAmlLines(lines, true, true);
    expect(amlLines[0]?.romanLyric).toBe('ka yo wa i hi ka ri');
    expect(amlLines[0]?.words.map((word) => word.romanWord || '')).toEqual([
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  });

  it('treats accented latin lyrics as the main line and chinese as translation', async () => {
    const lines = await parseRawToLyricLines([
      '[01:06.009]On ira à la foire',
      '[01:06.009]我们将一起前往那欢乐的圣地',
    ].join('\n'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      text: 'On ira à la foire',
      translation: '我们将一起前往那欢乐的圣地',
      romaji: '',
    });
  });
});
