import { describe, expect, it, vi } from 'vitest';

vi.mock('@applemusic-like-lyrics/lyric/pkg/amll_lyric.js', async () => {
  // @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
  const fs = await import('node:fs/promises');
  // @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
  const os = await import('node:os');
  // @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
  const path = await import('node:path');
  // @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
  const { pathToFileURL } = await import('node:url');
  const cwd = (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ?? '.';
  const packageDirectory = path.resolve(
    cwd,
    'node_modules',
    '@applemusic-like-lyrics',
    'lyric',
    'pkg',
  );
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'lycia-ttml-'));
  const modulePath = path.join(temporaryDirectory, 'amll_lyric_bg.mjs');

  await fs.copyFile(path.join(packageDirectory, 'amll_lyric_bg.js'), modulePath);
  const wrapper = await import(pathToFileURL(modulePath).href);
  const wasmBytes = await fs.readFile(path.join(packageDirectory, 'amll_lyric_bg.wasm'));
  const { instance } = await WebAssembly.instantiate(wasmBytes, {
    './amll_lyric_bg.js': { ...wrapper },
  });

  wrapper.__wbg_set_wasm(instance.exports);
  (instance.exports.__wbindgen_start as () => void)();
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
  return wrapper;
});

import type { LyricLine } from './types';
import {
  amlLineToLegacyLyricLine,
  applyNativeAmlDisplaySettings,
  isTtmlLyrics,
  parseNativeTtml,
  sanitizeNativeTtmlLines,
  selectAmlLyricLines,
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
    expect(line?.endTime).toBe(0);
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
});

describe('native TTML rendering adapters', () => {
  it('hides optional text without mutating timing or native fields', () => {
    const source = [createNativeLine()];
    const displayed = applyNativeAmlDisplaySettings(source, false, false);

    expect(displayed[0]?.translatedLyric).toBe('');
    expect(displayed[0]?.romanLyric).toBe('');
    expect(displayed[0]?.words[0]?.romanWord).toBe('');
    expect(displayed[0]?.isBG).toBe(true);
    expect(displayed[0]?.isDuet).toBe(true);
    expect(displayed[0]?.startTime).toBe(1000);
    expect(displayed[0]?.endTime).toBe(4200);
    expect(displayed[0]?.words[0]?.startTime).toBe(1250);
    expect(displayed[0]?.words[0]?.endTime).toBe(2750);
    expect(source[0]?.translatedLyric).toBe('translation');
    expect(source[0]?.words[0]?.romanWord).toBe('ge ci');
  });

  it('uses native lines for TTML and the legacy converter for ordinary lyrics', () => {
    const nativeLines = [createNativeLine()];
    const legacyLines: LyricLine[] = [{
      time: 1,
      endTime: 2,
      text: 'legacy',
      translation: '',
      romaji: '',
    }];
    const convertLegacy = vi.fn(() => []);

    const ttmlLines = selectAmlLyricLines(
      'ttml',
      nativeLines,
      legacyLines,
      true,
      true,
      convertLegacy,
    );
    expect(ttmlLines[0]?.endTime).toBe(4200);
    expect(convertLegacy).not.toHaveBeenCalled();

    selectAmlLyricLines('lrc', [], legacyLines, true, true, convertLegacy);
    expect(convertLegacy).toHaveBeenCalledOnce();
    expect(convertLegacy).toHaveBeenCalledWith(legacyLines, true, true);
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
