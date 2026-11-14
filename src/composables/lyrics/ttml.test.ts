import { DOMParser } from '@xmldom/xmldom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => vi.stubGlobal('DOMParser', DOMParser));
afterAll(() => vi.unstubAllGlobals());

import {
  amlLineToLegacyLyricLine,
  applyNativeAmlDisplaySettings,
  hasRenderableLyricContent,
  isTtmlLyrics,
  parseNativeTtml,
  sanitizeNativeTtmlLines,
  type NativeAmlLyricLine,
  type ParsedTtmlLine,
} from './ttml';

const TTML_FIXTURE = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>
  <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
    <head>
      <metadata>
        <ttm:agent type="person" xml:id="v1" />
        <ttm:agent type="other" xml:id="v2" />
      </metadata>
    </head>
    <body dur="4.000">
      <div>
        <p begin="1.000" end="3.000" ttm:agent="v1">
          <span begin="1.000" end="2.000">你</span><span begin="2.000" end="3.000">好</span>
          <span ttm:role="x-translation" xml:lang="zh-CN">Hello</span>
          <span ttm:role="x-roman">ni hao</span>
        </p>
        <p begin="3.000" end="4.000" ttm:agent="v2">
          <span begin="3.000" end="4.000">唱</span>
          <span ttm:role="x-bg" begin="3.200" end="3.900">
            <span begin="3.200" end="3.900">和</span>
          </span>
        </p>
      </div>
    </body>
  </tt>`;

function createNativeLine(): NativeAmlLyricLine {
  return {
    startTime: 1000,
    endTime: 4200,
    translatedLyric: 'translation',
    romanLyric: 'romanization',
    isBG: true,
    isDuet: true,
    emptyBeat: 12,
    words: [{
      startTime: 1250,
      endTime: 2750,
      word: '歌词',
      romanWord: 'ge ci',
      obscene: true,
      emptyBeat: 8,
      ruby: [{ word: '注音', startTime: 1300, endTime: 2600 }],
    }],
  };
}

describe('isTtmlLyrics', () => {
  it.each([
    '<tt></tt>',
    '  <tt xmlns="http://www.w3.org/ns/ttml"></tt>',
    '\uFEFF<tt></tt>',
    '<?xml version="1.0"?>\n<tt></tt>',
    '<?xml version="1.0"?><!-- lyrics -->\n<tt:tt xmlns:tt="http://www.w3.org/ns/ttml"></tt:tt>',
    '\uFEFF  <?xml version="1.0" encoding="UTF-8"?>\n  <tt xmlns="urn:test"></tt>',
  ])('detects a TTML root element in %j', (source) => {
    expect(isTtmlLyrics(source)).toBe(true);
  });

  it.each([
    '[00:01.00]ordinary lrc',
    '<?xml version="1.0"?><lyrics><tt>nested text</tt></lyrics>',
    'metadata before <tt></tt>',
  ])('does not classify non-TTML input %j', (source) => {
    expect(isTtmlLyrics(source)).toBe(false);
  });
});

describe('native TTML parsing', () => {
  it('normalizes milliseconds and explicit durations before the official time parser', async () => {
    const lines = await parseNativeTtml('<tt><body><div><p begin="1000ms" dur="1500ms">A</p><p begin="3s" end="4000ms">B</p></div></body></tt>');
    expect(lines.map((line) => [line.startTime, line.endTime])).toEqual([[1000, 2500], [3000, 4000]]);
    expect(lines[0].words[0]).toMatchObject({ startTime: 1000, endTime: 2500 });
  });

  it('fills missing line ends from the following line and song duration', async () => {
    const lines = await parseNativeTtml('<tt><body><div><p begin="1s">A</p><p begin="3s">B</p></div></body></tt>', [], 5500);
    expect(lines.map((line) => [line.startTime, line.endTime])).toEqual([[1000, 3000], [3000, 5500]]);
  });

  it('inherits starts and resolves partial word endings without dropping word text', async () => {
    const lines = await parseNativeTtml('<tt><body><div><p begin="1s" end="4s"><span begin="1s">A</span><span begin="2s">B</span><span end="4s">C</span></p></div></body></tt>');
    expect(lines[0].words.map((word) => [word.word, word.startTime, word.endTime]))
      .toEqual([['A', 1000, 2000], ['B', 2000, 4000], ['C', 1000, 4000]]);
  });

  it('resolves a span duration against its inherited start instead of zero', async () => {
    const lines = await parseNativeTtml('<tt><body><div><p begin="1s" end="4s"><span dur="2s">A</span></p></div></body></tt>');
    expect(lines[0].words[0]).toMatchObject({ word: 'A', startTime: 1000, endTime: 3000 });
  });

  it('retains unsynchronized TTML prose as a diagnostic rather than a fabricated 0ms lyric', async () => {
    const issues: string[] = [];
    expect(await parseNativeTtml('<tt><body><div><p>Untimed text</p></div></body></tt>', issues)).toEqual([]);
    expect(issues).toContain('TTML 段落没有同步时间，已保留原文。');
  });

  it('inherits the owning main interval for background vocals without their own timing', async () => {
    const lines = await parseNativeTtml('<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="1s" end="3s"><span begin="1s" end="3s">MAIN</span><span ttm:role="x-bg">BG</span></p></div></body></tt>');
    expect(lines[1]).toMatchObject({ startTime: 1000, endTime: 3000, isBG: true });
    expect(lines[1].words[0]).toMatchObject({ word: 'BG', startTime: 1000, endTime: 3000 });
  });

  it('unwraps only transparent spans so nested timed words are not flattened', async () => {
    const lines = await parseNativeTtml('<tt><body><div><p begin="1s" end="4s"><span><span begin="1s" end="2s">A</span><span begin="2s" end="4s">B</span></span></p></div></body></tt>');
    expect(lines[0].words.map((word) => [word.word, word.startTime, word.endTime]))
      .toEqual([['A', 1000, 2000], ['B', 2000, 4000]]);
  });
  it.each([
    '<tt:tt xmlns:tt="http://www.w3.org/ns/ttml"><tt:body><tt:div><tt:p begin="1s" end="2s">TTML</tt:p></tt:div></tt:body></tt:tt>',
    '<tt><body><div><p begin="1s" end="2s">TTML</p></div></body></tt>',
  ])('normalizes TTML element prefixes without changing its timing: %s', async (source) => {
    const lines = await parseNativeTtml(source);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ startTime: 1000, endTime: 2000 });
    expect(lines[0].words[0]).toMatchObject({ word: 'TTML', startTime: 1000, endTime: 2000 });
  });

  it('keeps official parser timing, translation, duet, and background lines', async () => {
    const lines = await parseNativeTtml(TTML_FIXTURE);

    expect(lines).toHaveLength(3);
    expect(lines.some((line) => line.isDuet)).toBe(true);
    expect(lines.some((line) => line.isBG)).toBe(true);
    expect(lines[0]?.translatedLyric).toBe('Hello');
    expect(lines[0]?.romanLyric).toBe('ni hao');
    expect(lines[0]?.startTime).toBe(1000);
    expect(lines[0]?.endTime).toBe(3000);
    const firstTimedWord = lines[0]?.words.find((word) => word.word === '你');
    expect(firstTimedWord?.startTime).toBe(1000);
    expect(firstTimedWord?.endTime).toBe(2000);
    expect(lines[2]?.startTime).toBe(3200);
    expect(lines[2]?.endTime).toBe(3900);
  });

  it('retains metadata namespaces and vocal roles when normalizing prefixed TTML', async () => {
    const prefixed = TTML_FIXTURE
      .replace(/<(\/?)(tt|head|metadata|body|div|p|span)(?=[\s>])/g, '<$1tt:$2')
      .replace('xmlns="http://www.w3.org/ns/ttml"', 'xmlns:tt="http://www.w3.org/ns/ttml"');
    expect(await parseNativeTtml(prefixed)).toEqual(await parseNativeTtml(TTML_FIXTURE));
  });

  it('repairs only invalid timing while preserving extended fields', () => {
    const source = {
      ...createNativeLine(),
      startTime: Number.NaN,
      endTime: -1,
      customLineField: 'keep-line',
      words: [{
        ...createNativeLine().words[0]!,
        startTime: 2500,
        endTime: 2000,
        customWordField: 'keep-word',
      }],
    } as ParsedTtmlLine & {
      customLineField: string;
      words: Array<ParsedTtmlLine['words'][number] & { customWordField: string }>;
    };

    const [line] = sanitizeNativeTtmlLines([source]);

    expect(line?.startTime).toBe(0);
    expect(line?.endTime).toBe(2500);
    expect(line?.words[0]?.startTime).toBe(2500);
    expect(line?.words[0]?.endTime).toBe(2500);
    expect(line?.words[0]?.romanWord).toBe('ge ci');
    expect(line?.words[0]?.obscene).toBe(true);
    expect(line?.words[0]?.emptyBeat).toBe(8);
    expect(line?.words[0]?.ruby?.[0]?.word).toBe('注音');
    expect((line as typeof line & { customLineField: string }).customLineField).toBe('keep-line');
    expect((line?.words[0] as typeof line.words[0] & { customWordField: string }).customWordField)
      .toBe('keep-word');
  });

  it('keeps overlapping vocal words inside their native AMLL line boundary', () => {
    const source = [{
      startTime: 66768,
      endTime: 67586,
      translatedLyric: '',
      romanLyric: '',
      isBG: false,
      isDuet: false,
      words: [
        { word: '你有话', startTime: 66768, endTime: 68243, romanWord: '' },
        { word: '说不出来', startTime: 68243, endTime: 70465, romanWord: '' },
      ],
    }] as ParsedTtmlLine[];

    const [line] = sanitizeNativeTtmlLines(source);

    expect(line?.endTime).toBe(70465);
    expect(line?.words.every(word => word.endTime <= line.endTime)).toBe(true);
  });

  it('prefers declared Chinese translations for both lead and background vocals', async () => {
    const lines = await parseNativeTtml(`<tt xmlns="http://www.w3.org/ns/ttml"
      xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
      <p begin="1s" end="3s"><span begin="1s" end="3s">歌</span>
        <span ttm:role="x-translation" xml:lang="en">English</span>
        <span ttm:role="x-translation" xml:lang="zh-Hans">中文</span>
        <span ttm:role="x-bg" begin="1.2s" end="2.5s">和声
          <span ttm:role="x-translation" xml:lang="en">Backing</span>
          <span ttm:role="x-translation" xml:lang="zh-CN">背景翻译</span>
        </span>
      </p></div></body></tt>`);

    expect(lines[0].translatedLyric).toBe('中文');
    expect(lines[1].translatedLyric).toBe('背景翻译');
    expect(lines[1]).toMatchObject({ isBG: true, startTime: 1200, endTime: 2500 });
  });

  it('parses official ruby, obscene and empty-beat extensions without casting them away', async () => {
    const lines = await parseNativeTtml(`<tt xmlns="http://www.w3.org/ns/ttml"
      xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:amll="http://www.example.com/ns/amll">
      <body><div><p begin="1s" end="2s">
        <span tts:ruby="container" amll:obscene="true" amll:empty-beat="3">
          <span tts:ruby="base">詮</span>
          <span tts:ruby="textContainer">
            <span tts:ruby="text" begin="1.2s" end="1.5s">せ</span>
            <span tts:ruby="text" begin="1.5s" end="1.8s">ん</span>
          </span>
        </span>
      </p></div></body></tt>`);

    expect(lines[0].words[0]).toMatchObject({
      word: '詮', startTime: 1200, endTime: 1800, obscene: true, emptyBeat: 3,
      ruby: [
        { word: 'せ', startTime: 1200, endTime: 1500 },
        { word: 'ん', startTime: 1500, endTime: 1800 },
      ],
    });
  });

  it('preserves the independent sidecar romanization grid for desktop projection', async () => {
    const lines = await parseNativeTtml(`<tt xmlns="http://www.w3.org/ns/ttml"
      xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
      <head><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
        <transliterations><transliteration xml:lang="ja-Latn"><text for="L1">
          <span xmlns="http://www.w3.org/ns/ttml" begin="1s" end="1.4s">kan</span>
          <span xmlns="http://www.w3.org/ns/ttml" begin="1.4s" end="1.8s">ji</span>
        </text></transliteration></transliterations>
      </iTunesMetadata></head>
      <body><div><p xml:id="L1" begin="1s" end="2s">
        <span begin="1s" end="2s">漢字</span>
      </p></div></body></tt>`);
    const legacy = amlLineToLegacyLyricLine(lines[0]);

    expect(legacy.romajiWords).toEqual([
      { text: 'kan', start: 1, end: 1.4 },
      { text: 'ji', start: 1.4, end: 1.8 },
    ]);
    expect(lines[0].words[0]).toMatchObject({ word: '漢字', startTime: 1000, endTime: 2000 });
    expect(legacy.romaji).toBe('kanji');
  });
});

describe('native TTML rendering adapters', () => {
  it('retains an empty lead anchor for a real background-only vocal group', async () => {
    const lines = await parseNativeTtml('<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="1s" end="3s"><span ttm:role="x-bg">BG</span></p></div></body></tt>');
    expect(lines).toHaveLength(2);
    expect(hasRenderableLyricContent(lines[0])).toBe(false);
    const displayed = applyNativeAmlDisplaySettings(lines, true, true);
    expect(displayed).toHaveLength(2);
    expect(displayed[0].isBG).toBe(false);
    expect(displayed[1].isBG).toBe(true);
  });
  it('shares one content definition for empty documents and render filtering', () => {
    const blank = { ...createNativeLine(), translatedLyric: '', romanLyric: '', words: [] };
    expect(hasRenderableLyricContent(blank)).toBe(false);
    expect(hasRenderableLyricContent({ ...blank, translatedLyric: '译文' })).toBe(true);
    expect(hasRenderableLyricContent({ ...blank, romanWords: createNativeLine().words })).toBe(true);
    expect(applyNativeAmlDisplaySettings([blank], true, true)).toEqual([]);
  });
  it('hides optional text without mutating timing or native fields', () => {
    const source = [createNativeLine()];
    const displayed = applyNativeAmlDisplaySettings(source, false, false);

    expect(displayed[0]?.translatedLyric).toBe('');
    expect(displayed[0]?.romanLyric).toBe('');
    expect(displayed[0]?.words[0]?.romanWord).toBe('');
    expect(displayed[0]?.isBG).toBe(true);
    expect(displayed[0]?.isDuet).toBe(true);
    expect(displayed[0]?.startTime).toBe(1000);
    expect(displayed[0]?.sourceStartTimeMs).toBe(1000);
    expect(displayed[0]?.endTime).toBe(4200);
    expect(displayed[0]?.words[0]?.startTime).toBe(1250);
    expect(displayed[0]?.words[0]?.endTime).toBe(2750);
    expect(source[0]?.translatedLyric).toBe('translation');
    expect(source[0]?.words[0]?.romanWord).toBe('ge ci');
    expect(source[0]?.sourceStartTimeMs).toBeUndefined();
    displayed[0].words[0].ruby![0].word = 'modified display copy';
    expect(source[0].words[0].ruby![0].word).toBe('注音');
  });

  it('creates a compatible desktop and light lyrics line without losing extensions', () => {
    const legacy = amlLineToLegacyLyricLine(createNativeLine());

    expect(legacy.time).toBe(1);
    expect(legacy.endTime).toBe(4.2);
    expect(legacy.isBG).toBe(true);
    expect(legacy.isDuet).toBe(true);
    expect(legacy.words?.[0]).toMatchObject({
      start: 1.25,
      end: 2.75,
      romaji: 'ge ci',
      obscene: true,
      emptyBeat: 8,
    });
    expect(legacy.words?.[0]?.ruby?.[0]).toEqual({
      text: '注音',
      start: 1.3,
      end: 2.6,
    });
  });
});
