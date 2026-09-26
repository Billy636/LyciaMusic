import { DOMParser } from '@xmldom/xmldom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseNativeTtml } from './ttml';

beforeAll(() => vi.stubGlobal('DOMParser', DOMParser));
afterAll(() => vi.unstubAllGlobals());

const TTML_NS = 'http://www.w3.org/ns/ttml';
const word = (text: string, start: number, end: number) =>
  `<span xmlns="${TTML_NS}" begin="${start / 1000}s" end="${end / 1000}s">${text}</span>`;

function fixture(options: {
  main: string;
  roman?: string;
  inlineRoman?: string;
  background?: string;
  agent?: 'v1' | 'v2';
}): string {
  return `<tt xmlns="${TTML_NS}"
    xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xmlns:tts="http://www.w3.org/ns/ttml#styling"
    xmlns:itunes="http://music.apple.com/lyric-ttml-internal"
    xmlns:amll="http://www.example.com/ns/amll">
    <head><metadata>
      <ttm:agent type="person" xml:id="v1"/>
      <ttm:agent type="other" xml:id="v2"/>
    </metadata>${options.roman ? `<iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
      <transliterations><transliteration xml:lang="ja-Latn"><text for="L1">${options.roman}</text></transliteration></transliterations>
    </iTunesMetadata>` : ''}</head>
    <body><div><p itunes:key="L1" ttm:agent="${options.agent ?? 'v1'}" begin="1s" end="5s">${options.main}<span ttm:role="x-translation" xml:lang="zh-Hans">中文翻译</span>${options.inlineRoman ? `<span ttm:role="x-roman">${options.inlineRoman}</span>` : ''}${options.background ? `<span ttm:role="x-bg" begin="1s" end="5s">${options.background}<span ttm:role="x-translation" xml:lang="zh-Hans">背景翻译</span></span>` : ''}</p></div></body>
  </tt>`;
}

const compact = (text: string | undefined) => (text ?? '').replace(/\s/g, '');
const twoWords = word('漢', 1000, 3000) + word('字', 3000, 5000);

describe('TTML timed romanization uses the shared lossless mapping', () => {
  it('merges multiple source fragments into one main word while preserving extensions and the raw grid', async () => {
    const ruby = `<span tts:ruby="container" amll:obscene="true" amll:empty-beat="3">
      <span tts:ruby="base">漢</span><span tts:ruby="textContainer">
        <span tts:ruby="text" begin="1s" end="2s">か</span>
        <span tts:ruby="text" begin="2s" end="3s">ん</span>
      </span></span>`;
    const [line] = await parseNativeTtml(fixture({
      main: ruby + word('字', 3000, 5000), agent: 'v2',
      roman: word('ka', 1000, 1600) + word('n', 1600, 3000) + word('ji', 3000, 5000),
    }));

    expect(line.romanLyric).toBe('');
    expect(line.words.map((item) => compact(item.romanWord))).toEqual(['kan', 'ji']);
    expect(line).toMatchObject({
      startTime: 1000, endTime: 5000, translatedLyric: '中文翻译', isBG: false, isDuet: true,
    });
    expect(line.words[0]).toMatchObject({
      word: '漢', startTime: 1000, endTime: 3000, obscene: true, emptyBeat: 3,
      ruby: [
        { word: 'か', startTime: 1000, endTime: 2000 },
        { word: 'ん', startTime: 2000, endTime: 3000 },
      ],
    });
    expect(line.words[1]).toMatchObject({ word: '字', startTime: 3000, endTime: 5000 });
    expect(line.romanWords?.map((item) => [item.word, item.startTime, item.endTime])).toEqual([
      ['ka', 1000, 1600], ['n', 1600, 3000], ['ji', 3000, 5000],
    ]);
  });

  it('allows partial romanization without requiring an annotation for every small kana', async () => {
    const [line] = await parseNativeTtml(fixture({
      main: word('か', 1000, 2000) + word('っ', 2000, 2300) + word('た', 2300, 5000),
      roman: word('ka', 1000, 2000) + word('ta', 2300, 5000),
    }));

    expect(line.romanLyric).toBe('');
    expect(line.words.map((item) => compact(item.romanWord))).toEqual(['ka', '', 'ta']);
    expect(line.romanWords?.map((item) => [item.word, item.startTime, item.endTime]))
      .toEqual([['ka', 1000, 2000], ['ta', 2300, 5000]]);
  });

  it('keeps a normal line-level x-roman as a complete subtitle, not inline annotations', async () => {
    const [line] = await parseNativeTtml(fixture({ main: twoWords, inlineRoman: 'kan ji as a whole line' }));

    expect(line.romanLyric).toBe('kan ji as a whole line');
    expect(line.words.every((item) => !item.romanWord)).toBe(true);
    expect(line.romanWords).toBeUndefined();
    expect(line.translatedLyric).toBe('中文翻译');
  });

  it('keeps timed romanization as a whole subtitle when the main lyric is one line-level word', async () => {
    const [line] = await parseNativeTtml(fixture({
      main: word('漢字', 1000, 5000),
      roman: word('kan', 1000, 3000) + word('ji', 3000, 5000),
    }));

    expect(compact(line.romanLyric)).toBe('kanji');
    expect(line.words).toHaveLength(1);
    expect(line.words[0]).toMatchObject({ word: '漢字', startTime: 1000, endTime: 5000 });
    expect(line.words[0].romanWord).toBe('');
    expect(line.romanWords?.map((item) => [item.word, item.startTime, item.endTime]))
      .toEqual([['kan', 1000, 3000], ['ji', 3000, 5000]]);
  });

  it('falls back completely for a fragment crossing two main words and clears partial official matches', async () => {
    const [line] = await parseNativeTtml(fixture({
      main: twoWords,
      roman: word('good', 1000, 2000) + word('cross', 2500, 3500),
    }));

    expect(compact(line.romanLyric)).toBe('goodcross');
    expect(line.words.every((item) => !item.romanWord)).toBe(true);
    expect(line.romanWords?.map((item) => [item.word, item.startTime, item.endTime]))
      .toEqual([['good', 1000, 2000], ['cross', 2500, 3500]]);
    expect(line.words.map((item) => [item.word, item.startTime, item.endTime]))
      .toEqual([['漢', 1000, 3000], ['字', 3000, 5000]]);
    expect(line.translatedLyric).toBe('中文翻译');
  });

  it('does not drop an out-of-range romanization fragment even when another fragment matches', async () => {
    const [line] = await parseNativeTtml(fixture({
      main: twoWords,
      roman: word('outside', 100, 500) + word('inside', 1500, 2000),
    }));

    expect(compact(line.romanLyric)).toBe('outsideinside');
    expect(line.words.every((item) => !item.romanWord)).toBe(true);
    expect(line.romanWords?.map((item) => [item.word, item.startTime, item.endTime]))
      .toEqual([['outside', 100, 500], ['inside', 1500, 2000]]);
  });

  it('accepts at most two milliseconds of containment tolerance without rewriting timing', async () => {
    const [line] = await parseNativeTtml(fixture({
      main: twoWords,
      roman: word('first', 998, 3002) + word('second', 3002, 4998),
    }));

    expect(line.romanLyric).toBe('');
    expect(line.words.map((item) => compact(item.romanWord))).toEqual(['first', 'second']);
    expect(line.romanWords?.map((item) => [item.startTime, item.endTime])).toEqual([[998, 3002], [3002, 4998]]);
    expect(line.words.map((item) => [item.startTime, item.endTime])).toEqual([[1000, 3000], [3000, 5000]]);
  });

  it('falls back if a source interval exceeds the containment tolerance', async () => {
    const [line] = await parseNativeTtml(fixture({
      main: twoWords,
      roman: word('first', 997, 3003) + word('second', 3003, 4998),
    }));

    expect(compact(line.romanLyric)).toBe('firstsecond');
    expect(line.words.every((item) => !item.romanWord)).toBe(true);
    expect(line.romanWords?.map((item) => [item.startTime, item.endTime])).toEqual([[997, 3003], [3003, 4998]]);
  });

  it('maps background romanization only to its own vocal group', async () => {
    const source = fixture({
      main: twoWords,
      background: word('背', 1000, 3000) + word('景', 3000, 5000),
      roman: word('ma', 1000, 2000) + word('in', 2000, 3000) + word('lead', 3000, 5000)
        + `<span xmlns="${TTML_NS}" ttm:role="x-bg">${word('ba', 1000, 2000)}${word('ck', 2000, 3000)}${word('voice', 3000, 5000)}</span>`,
    });
    const [main, background] = await parseNativeTtml(source);

    expect(main.isBG).toBe(false);
    expect(background.isBG).toBe(true);
    expect(main.words.map((item) => compact(item.romanWord))).toEqual(['main', 'lead']);
    expect(background.words.map((item) => compact(item.romanWord))).toEqual(['back', 'voice']);
    expect(main.romanLyric).toBe('');
    expect(background.romanLyric).toBe('');
    expect(main.romanWords?.map((item) => item.word)).toEqual(['ma', 'in', 'lead']);
    expect(background.romanWords?.map((item) => item.word)).toEqual(['ba', 'ck', 'voice']);
    expect(main.translatedLyric).toBe('中文翻译');
    expect(background.translatedLyric).toBe('背景翻译');
  });
});
