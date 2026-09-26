import type {
  LyricLine as CoreAmlLyricLine,
  LyricWord as CoreAmlLyricWord,
} from '@applemusic-like-lyrics/core';
import type {
  AmllLyricLine,
  AmllLyricWord,
} from '@applemusic-like-lyrics/ttml';

import type { LyricLine } from './types';
import { withAlignedRomanization } from './romanization';

export interface NativeAmlRubyWord {
  word: string;
  startTime: number;
  endTime: number;
}

export type ParsedTtmlWord = AmllLyricWord;

export type ParsedTtmlLine = Omit<AmllLyricLine, 'words'> & {
  words: ParsedTtmlWord[];
  emptyBeat?: number;
};

export type NativeAmlLyricWord = CoreAmlLyricWord & {
  ruby?: NativeAmlRubyWord[];
  emptyBeat?: number;
};

export type NativeAmlLyricLine = Omit<CoreAmlLyricLine, 'words'> & {
  words: NativeAmlLyricWord[];
  /** Rendering-only seek anchor, before the official player's lead-in layout. */
  sourceStartTimeMs?: number;
  /** Original explicitly labelled romanization, with its own timing grid. */
  romanWords?: NativeAmlLyricWord[];
  /** Original translation words; their timing is independent of the main line. */
  translationWords?: NativeAmlLyricWord[];
  emptyBeat?: number;
};

export function hasRenderableLyricContent(line: NativeAmlLyricLine): boolean {
  return Boolean(line.words.some((word) => word.word.trim() || word.romanWord?.trim())
    || line.translatedLyric.trim() || line.romanLyric.trim()
    || line.romanWords?.some((word) => word.word.trim())
    || line.translationWords?.some((word) => word.word.trim()));
}

function sanitizeTime(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function isTtmlLyrics(raw: string): boolean {
  const source = raw.replace(/^\uFEFF/, '').trimStart();
  const withoutDeclaration = source
    .replace(/^(?:<\?xml\s[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*)+/i, '');
  return /^<(?:[\w.-]+:)?tt(?=[\s/>])/i.test(withoutDeclaration);
}

export function sanitizeNativeTtmlLines(
  lines: ParsedTtmlLine[],
  issues: string[] = [],
): NativeAmlLyricLine[] {
  return lines.map((line, index) => {
    let repaired = false;
    const safeTime = (value: number, fallback: number) => {
      const result = sanitizeTime(value, fallback);
      if (result !== value) repaired = true;
      return result;
    };
    const originalStartTime = safeTime(line.startTime, 0);
    const words = (line.words ?? []).map((word) => {
      const wordStartTime = safeTime(word.startTime, originalStartTime);
      const rawWordEndTime = safeTime(word.endTime, wordStartTime);
      if (rawWordEndTime < wordStartTime) repaired = true;

      return {
        ...word,
        startTime: wordStartTime,
        endTime: Math.max(wordStartTime, rawWordEndTime),
        word: word.word ?? '',
        romanWord: word.romanWord ?? '',
        obscene: word.obscene ?? false,
        ruby: word.ruby?.map((ruby) => {
          const rubyStartTime = safeTime(ruby.startTime, wordStartTime);
          const rubyEndTime = safeTime(ruby.endTime, rubyStartTime);
          if (rubyEndTime < rubyStartTime) repaired = true;
          return {
            ...ruby,
            startTime: rubyStartTime,
            endTime: Math.max(rubyStartTime, rubyEndTime),
          };
        }),
      };
    });
    const startTime = words.reduce(
      (earliestStartTime, word) => Math.min(earliestStartTime, word.startTime),
      originalStartTime,
    );
    const latestWordEndTime = words.reduce(
      (latestEndTime, word) => Math.max(latestEndTime, word.endTime),
      startTime,
    );
    const rawEndTime = safeTime(line.endTime, startTime);
    // AMLL requires every timed word to stay inside its parent line. Overlapping
    // TTML vocal parts can make the parser-provided line end precede its final
    // word; passing that invalid timeline through can collapse the whole layout.
    const endTime = Math.max(startTime, rawEndTime, latestWordEndTime);
    if (startTime !== originalStartTime || endTime !== rawEndTime) repaired = true;
    if (repaired) issues.push(`第 ${index + 1} 行的无效时间已修复。`);

    return {
      ...line,
      startTime,
      endTime,
      words,
      translatedLyric: line.translatedLyric ?? '',
      romanLyric: line.romanLyric ?? '',
      isBG: line.isBG ?? false,
      isDuet: line.isDuet ?? false,
    };
  });
}

function normalizeTtmlElementNames(xml: Document): void {
  const namespace = 'http://www.w3.org/ns/ttml';
  const unqualifiedTtmlNames = new Set([
    'tt', 'head', 'metadata', 'body', 'div', 'p', 'span', 'br',
    'styling', 'style', 'layout', 'region', 'set',
  ]);
  for (const element of Array.from(xml.getElementsByTagName('*'))) {
    const name = element.localName || element.nodeName;
    const isPrefixedTtml = element.namespaceURI === namespace && Boolean(element.prefix);
    const isUnqualifiedTtml = !element.namespaceURI && unqualifiedTtmlNames.has(name);
    if (!isPrefixedTtml && !isUnqualifiedTtml) continue;
    // The official parser looks up several TTML tags by unprefixed tagName.
    // Normalize only TTML elements in this temporary DOM; retain metadata,
    // attributes and other namespaces verbatim instead of rewriting XML text.
    const replacement = xml.createElementNS(namespace, name);
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.namespaceURI) {
        replacement.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
      } else {
        replacement.setAttribute(attribute.name, attribute.value);
      }
    }
    while (element.firstChild) replacement.appendChild(element.firstChild);
    element.parentNode?.replaceChild(replacement, element);
  }
}

function unwrapTransparentTtmlSpans(xml: Document): void {
  for (const span of Array.from(xml.getElementsByTagNameNS('http://www.w3.org/ns/ttml', 'span'))) {
    if (Array.from(span.attributes).some((attribute) => attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/')) continue;
    if (!Array.from(span.childNodes).some((node) => node.nodeType === 1)) continue;
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  }
}

function ttmlTimeAttribute(element: Element, attribute: string): number | undefined {
  const raw = element.getAttribute(attribute)?.trim();
  if (!raw) return undefined;
  const milliseconds = /^(\d+(?:\.\d+)?)ms$/.exec(raw);
  const clock = raw.replace(/s$/, '');
  if (!milliseconds && !/^(?:\d+:){0,2}\d+(?:\.\d+)?$/.test(clock)) {
    throw new Error(`不支持的 TTML 时间：${raw}`);
  }
  const value = milliseconds ? Number(milliseconds[1]) : clock.split(':').reverse()
    .reduce((sum, part, index) => sum + Number(part) * (60 ** index) * 1000, 0);
  if (!Number.isFinite(value)) throw new Error('TTML 时间超出有效范围');
  return value;
}

function setTtmlTime(element: Element, attribute: string, value: number): void {
  element.setAttribute(attribute, `${value / 1000}s`);
}

function nearestTtmlTime(element: Element, attribute: string): number | undefined {
  let parent = element.parentNode;
  while (parent?.nodeType === 1) {
    const time = ttmlTimeAttribute(parent as Element, attribute);
    if (time !== undefined) return time;
    parent = parent.parentNode;
  }
  return undefined;
}

function normalizeTtmlTiming(
  xml: Document,
  paragraphs: Element[],
  durationMs: number | undefined,
  issues: string[],
): void {
  const namespace = 'http://www.w3.org/ns/ttml';
  for (const element of Array.from(xml.getElementsByTagNameNS(namespace, '*'))) {
    for (const attribute of ['begin', 'end', 'dur']) {
      const time = ttmlTimeAttribute(element, attribute);
      if (time !== undefined) setTtmlTime(element, attribute, time);
    }
    const duration = ttmlTimeAttribute(element, 'dur');
    if (duration !== undefined && !element.hasAttribute('end')) {
      const begin = ttmlTimeAttribute(element, 'begin') ?? nearestTtmlTime(element, 'begin') ?? 0;
      if (!element.hasAttribute('begin')) setTtmlTime(element, 'begin', begin);
      setTtmlTime(element, 'end', begin + duration);
    }
  }
  const timings = paragraphs.map((paragraph) => {
    const descendants = Array.from(paragraph.getElementsByTagNameNS(namespace, '*'));
    const childStarts = descendants.map((element) => ttmlTimeAttribute(element, 'begin'))
      .filter((time): time is number => time !== undefined);
    const inheritedEnd = nearestTtmlTime(paragraph, 'end');
    const start = ttmlTimeAttribute(paragraph, 'begin')
      ?? (childStarts.length ? Math.min(...childStarts) : nearestTtmlTime(paragraph, 'begin'))
      ?? (paragraph.hasAttribute('end') || inheritedEnd !== undefined ? 0 : undefined);
    return { paragraph, descendants, start, inheritedEnd };
  });
  for (const { paragraph, descendants, start, inheritedEnd } of timings) {
    if (start === undefined) continue;
    if (!paragraph.hasAttribute('begin')) setTtmlTime(paragraph, 'begin', start);
    if (!paragraph.hasAttribute('end')) {
      const childEnds = descendants.map((element) => ttmlTimeAttribute(element, 'end'))
        .filter((time): time is number => time !== undefined);
      const missingWordEnd = descendants.some((element) => element.hasAttribute('begin') && !element.hasAttribute('end'));
      const nextStart = timings.map((entry) => entry.start)
        .filter((time): time is number => time !== undefined && time > start).sort((a, b) => a - b)[0];
      const end = childEnds.length && !missingWordEnd ? Math.max(...childEnds)
        : nextStart ?? inheritedEnd ?? durationMs ?? start + 5000;
      setTtmlTime(paragraph, 'end', Math.max(start, end));
      issues.push('已补充 TTML 缺失的结束时间。');
    }
    // Missing background timing inherits its owning vocal, while supplied
    // timings and child-derived intervals remain authoritative.
    for (const element of descendants) {
      const role = element.getAttributeNS('http://www.w3.org/ns/ttml#metadata', 'role')
        || element.getAttribute('ttm:role');
      if (role === 'x-bg') {
        const children = Array.from(element.getElementsByTagNameNS(namespace, '*'));
        for (const attribute of ['begin', 'end']) {
          if (element.hasAttribute(attribute)) continue;
          const childTimes = children.map((child) => ttmlTimeAttribute(child, attribute))
            .filter((time): time is number => time !== undefined);
          const inherited = ttmlTimeAttribute(paragraph, attribute);
          const time = childTimes.length
            ? attribute === 'begin' ? Math.min(...childTimes) : Math.max(...childTimes)
            : inherited;
          if (time !== undefined) setTtmlTime(element, attribute, time);
        }
      }
      if (!element.hasAttribute('begin') && element.hasAttribute('end')) {
        const inherited = nearestTtmlTime(element, 'begin');
        if (inherited !== undefined) setTtmlTime(element, 'begin', inherited);
      }
      const wordStart = ttmlTimeAttribute(element, 'begin');
      if (wordStart === undefined || element.hasAttribute('end')) continue;
      let next = element.nextSibling;
      let end: number | undefined;
      while (next) {
        if (next.nodeType === 1) {
          const candidate = next as Element;
          const candidateRole = candidate.getAttributeNS('http://www.w3.org/ns/ttml#metadata', 'role');
          const nextStart = candidateRole ? undefined : ttmlTimeAttribute(candidate, 'begin');
          if (nextStart !== undefined && nextStart >= wordStart) { end = nextStart; break; }
        }
        next = next.nextSibling;
      }
      end ??= nearestTtmlTime(element, 'end');
      if (end !== undefined) {
        setTtmlTime(element, 'end', Math.max(wordStart, end));
        issues.push('已补充 TTML 缺失的结束时间。');
      }
    }
  }
}

export async function parseNativeTtml(
  raw: string,
  issues: string[] = [],
  durationMs?: number,
): Promise<NativeAmlLyricLine[]> {
  // Use the official rich TTML types instead of lyric's narrower convenience
  // signature, which does not expose ruby / obscene / emptyBeat to TypeScript.
  const { TTMLParser, toAmllLyrics } = await import('@applemusic-like-lyrics/ttml');
  const source = raw.replace(/^\uFEFF/, '').trimStart();
  const xml = new DOMParser().parseFromString(source, 'application/xml');
  const root = xml.documentElement;
  if (xml.getElementsByTagName('parsererror').length || !root || root.localName !== 'tt'
    || (root.namespaceURI && root.namespaceURI !== 'http://www.w3.org/ns/ttml')) {
    throw new Error('无效的 TTML 文档');
  }
  normalizeTtmlElementNames(xml);
  unwrapTransparentTtmlSpans(xml);
  const itunesNamespace = 'http://music.apple.com/lyric-ttml-internal';
  const body = xml.getElementsByTagNameNS('http://www.w3.org/ns/ttml', 'body')[0];
  const paragraphs = Array.from(body?.getElementsByTagNameNS('http://www.w3.org/ns/ttml', 'p') ?? []);
  normalizeTtmlTiming(xml, paragraphs, durationMs, issues);
  const getKey = (element: Element) => element.getAttributeNS(itunesNamespace, 'key')
    || element.getAttribute('itunes:key') || element.getAttribute('key');
  const keys = new Set(paragraphs.map(getKey).filter(Boolean));
  let generated = 0;
  for (const paragraph of paragraphs) {
    if (!paragraph.hasAttribute('begin') && !paragraph.hasAttribute('end')) {
      // Unsynchronized prose is retained in the saved source, not fabricated
      // into an instantaneous 0ms line by the official convenience conversion.
      paragraph.parentNode?.removeChild(paragraph);
      issues.push('TTML 段落没有同步时间，已保留原文。');
      continue;
    }
    if (getKey(paragraph)) continue;
    // The official parser requires an iTunes key even for valid plain TTML.
    // Add an internal ID only; the saved source and all timing stay untouched.
    let key = paragraph.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id')
      || paragraph.getAttribute('xml:id') || '';
    if (!key || keys.has(key)) {
      do { key = `lycia-line-${++generated}`; } while (keys.has(key));
    }
    paragraph.setAttributeNS(itunesNamespace, 'itunes:key', key);
    keys.add(key);
  }
  const parser = new TTMLParser({ domParser: { parseFromString: () => xml } });
  const document = parser.parse(source);
  for (const line of document.lines) {
    for (const vocal of [line, line.backgroundVocal]) {
      if (!vocal?.translations) continue;
      // Product policy: prefer a supplied Chinese translation, otherwise keep
      // the official first-translation fallback. Never infer a language.
      vocal.translations = [...vocal.translations].sort((left, right) =>
        Number(/^zh(?:-|$)/i.test(right.language ?? ''))
        - Number(/^zh(?:-|$)/i.test(left.language ?? '')));
    }
  }
  const lines = sanitizeNativeTtmlLines(toAmllLyrics(document).lines, issues);
  const vocals = document.lines.flatMap((line) => line.backgroundVocal ? [line, line.backgroundVocal] : [line]);
  for (const [index, vocal] of vocals.entries()) {
    const roman = vocal.romanizations?.[0];
    if (!roman?.words?.length) continue;
    // The official renderer aligns romanization onto main words. Retain the
    // original auxiliary grid too, so desktop/light projections remain lossless.
    lines[index].romanWords = sanitizeNativeTtmlLines([{
      ...lines[index],
      startTime: roman.words.reduce((start, word) =>
        Number.isFinite(word.startTime) && word.startTime >= 0 ? Math.min(start, word.startTime) : start,
      lines[index].startTime),
      endTime: roman.words.reduce((end, word) =>
        Number.isFinite(word.endTime) ? Math.max(end, word.endTime) : end, lines[index].endTime),
      words: roman.words.map((word) => ({
        word: word.text + (word.endsWithSpace ? ' ' : ''),
        startTime: word.startTime,
        endTime: word.endTime,
      })),
    }], issues)[0].words;
    // The published converter selects at most one phonetic fragment per main
    // word. Aggregate the complete source grid before handing it to Core.
    lines[index] = withAlignedRomanization(lines[index], issues);
  }
  return lines;
}

export function amlLineToLegacyLyricLine(line: NativeAmlLyricLine): LyricLine {
  const words = line.words.map((word) => ({
    text: word.word,
    start: word.startTime / 1000,
    end: word.endTime / 1000,
    romaji: word.romanWord,
    ruby: word.ruby?.map((ruby) => ({
      text: ruby.word,
      start: ruby.startTime / 1000,
      end: ruby.endTime / 1000,
    })),
    obscene: word.obscene,
    emptyBeat: word.emptyBeat,
  }));
  const hasWordRomaji = words.some((word) => Boolean(word.romaji));
  const romanText = line.romanLyric || (line.romanWords
    ? line.romanWords.map((word) => word.word).join('')
    : words.map((word) => word.romaji?.trim()).filter(Boolean).join(' '));

  return {
    time: line.startTime / 1000,
    endTime: line.endTime / 1000,
    text: words.map((word) => word.text).join(''),
    translation: line.translatedLyric || line.translationWords?.map((word) => word.word).join('') || '',
    translationWords: line.translationWords?.map((word) => ({
      text: word.word,
      start: word.startTime / 1000,
      end: word.endTime / 1000,
      romaji: word.romanWord,
      obscene: word.obscene,
      emptyBeat: word.emptyBeat,
      ruby: word.ruby?.map((ruby) => ({
        text: ruby.word, start: ruby.startTime / 1000, end: ruby.endTime / 1000,
      })),
    })),
    romaji: romanText,
    isBG: line.isBG,
    isDuet: line.isDuet,
    words: words.length > 0 ? words : undefined,
    romajiWords: line.romanWords?.map((word) => ({
      text: word.word,
      start: word.startTime / 1000,
      end: word.endTime / 1000,
    })) ?? (hasWordRomaji
      ? words.map((word) => ({
          text: word.romaji || '',
          start: word.start,
          end: word.end,
        }))
      : undefined),
  };
}

export function applyNativeAmlDisplaySettings(
  lines: NativeAmlLyricLine[],
  showTranslation: boolean,
  showRomaji: boolean,
): NativeAmlLyricLine[] {
  return lines.filter((line, index) => hasRenderableLyricContent(line)
    // An empty lead can own real background vocals. Preserve its group anchor;
    // standalone clear markers still do not occupy space in the AMLL view.
    || (!line.isBG && lines[index + 1]?.isBG)).map((line) => ({
    ...line,
    sourceStartTimeMs: line.startTime,
    translatedLyric: showTranslation ? line.translatedLyric : '',
    translationWords: showTranslation ? line.translationWords?.map((word) => ({
      ...word,
      ruby: word.ruby?.map((ruby) => ({ ...ruby })),
    })) : undefined,
    romanLyric: showRomaji ? line.romanLyric : '',
    romanWords: showRomaji ? line.romanWords?.map((word) => ({
      ...word,
      ruby: word.ruby?.map((ruby) => ({ ...ruby })),
    })) : undefined,
    words: line.words.map((word) => ({
      ...word,
      romanWord: showRomaji ? word.romanWord : '',
      ruby: word.ruby?.map((ruby) => ({ ...ruby })),
    })),
  }));
}
