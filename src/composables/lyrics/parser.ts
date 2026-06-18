import type {
  LyricLine as AmlLyricLine,
  LyricWord as AmlLyricWord,
} from '@applemusic-like-lyrics/lyric/pkg/amll_lyric.js';

import type {
  ExplicitLineRole,
  ParsedLine,
  ParsedLineSourceFormat,
  ParsedWord,
} from './types';

const TIMESTAMP_BLOCK_PATTERN = /\[(\d{1,}:\d{2}(?:[.:]\d+)?)\]/g;
const ADJACENT_TIMESTAMPS_BEFORE_TEXT_PATTERN = /(?:\[(?:\d{1,}:\d{2}(?:[.:]\d+)?)\])+(?=[^[\]\r\n])/g;
const ESLRC_GAP_PLACEHOLDER = '\u2063';
const ENHANCED_TIMESTAMP_PATTERN = /<(\d{1,}:\d{2}(?:[.:]\d+)?)>/g;
const ENHANCED_TIMESTAMP_TEXT_PATTERN = /<\d{1,}:\d{2}(?:[.:]\d+)?>/;
const LRC_LINE_TIMESTAMP_PATTERN = /^\[(\d{1,}:\d{2}(?:[.:]\d+)?)\](.*)$/;
const ENHANCED_EMPTY_BACKWARD_TOLERANCE_MS = 5;
const ENHANCED_INFERRED_WORD_DEFAULT_DURATION_MS = 300;
const ENHANCED_INFERRED_WORD_MIN_DURATION_MS = 150;
const ENHANCED_INFERRED_WORD_MAX_DURATION_MS = 1000;

type ParserSource = ParsedLineSourceFormat;

interface ParserCandidate {
  source: ParserSource;
  lines: AmlLyricLine[];
}

interface EnhancedLrcParseResult {
  line: AmlLyricLine;
  inferredWordIndex: number | null;
}

const PARSER_PRIORITIES: Record<ParserSource, number> = {
  enhanced_lrc: 6,
  ttml: 5,
  yrc: 4,
  qrc: 3,
  lys: 2,
  eslrc: 1,
  lrc: 0,
};

const EXPLICIT_LINE_MARKERS: Array<{
  role: ExplicitLineRole;
  pattern: RegExp;
}> = [
  {
    role: 'translation',
    pattern: /^(?:\[(?:tr|trans|translation)\]|【(?:翻译|译文)】|(?:翻译|译文)[:：]\s*)/iu,
  },
  {
    role: 'roman',
    pattern: /^(?:\[(?:roma|romaji|roman)\]|【(?:罗马音|罗马字|音译)】|(?:罗马音|罗马字|音译)[:：]\s*)/iu,
  },
];

let amlModule: typeof import('@applemusic-like-lyrics/lyric/pkg/amll_lyric.js') | null = null;

async function getAmlModule() {
  if (!amlModule) {
    amlModule = await import('@applemusic-like-lyrics/lyric/pkg/amll_lyric.js');
  }
  return amlModule;
}

export function sanitizeLineText(text: string): string {
  return text.replace(/\u200b/g, '').trim();
}

export function sanitizeWordText(text: string): string {
  return text.replace(/[\u200b\u2063]/g, '');
}

export function normalizeEslrcSource(source: string): string {
  return source.replace(ADJACENT_TIMESTAMPS_BEFORE_TEXT_PATTERN, (match) => {
    const timestamps = [...match.matchAll(TIMESTAMP_BLOCK_PATTERN)];
    if (timestamps.length <= 1) return match;

    return timestamps
      .map((timestamp, index) => (index === timestamps.length - 1
        ? timestamp[0]
        : `${timestamp[0]}${ESLRC_GAP_PLACEHOLDER}`))
      .join('');
  });
}

export function normalizeLyricTimestamps(source: string): string {
  return source
    .replace(/\[(\d+):(\d{2}):(\d{1,3})\]/g, '[$1:$2.$3]')
    .replace(/<(\d+):(\d{2}):(\d{1,3})>/g, '<$1:$2.$3>');
}

export function parseTimestampToMs(raw: string): number | null {
  const match = /^(\d+):(\d{2})(?:[.:](\d{1,3}))?$/.exec(raw.trim());
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const milliseconds = Number((match[3] ?? '').padEnd(3, '0').slice(0, 3) || '0');

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || !Number.isFinite(milliseconds)) {
    return null;
  }
  if (seconds >= 60) return null;

  return (minutes * 60 * 1000) + (seconds * 1000) + milliseconds;
}

export function isEnhancedLrcLine(line: string): boolean {
  const match = LRC_LINE_TIMESTAMP_PATTERN.exec(line);
  if (!match) return false;

  return ENHANCED_TIMESTAMP_TEXT_PATTERN.test(match[2]);
}

function parseEnhancedLrcLineInternal(line: string): EnhancedLrcParseResult | null {
  const lineMatch = LRC_LINE_TIMESTAMP_PATTERN.exec(line);
  if (!lineMatch) return null;

  const lineStartTime = parseTimestampToMs(lineMatch[1]);
  if (lineStartTime === null) return null;

  const body = lineMatch[2];
  const markers = [...body.matchAll(ENHANCED_TIMESTAMP_PATTERN)];
  if (markers.length < 1) return null;

  const leadingText = body.slice(0, markers[0].index ?? 0);
  if (leadingText.trim().length > 0) return null;

  const words: AmlLyricWord[] = [];
  let explicitEndTime: number | null = null;
  let inferredWordIndex: number | null = null;

  for (let index = 0; index < markers.length; index += 1) {
    const currentMarker = markers[index];
    const nextMarker = markers[index + 1];
    const currentStart = parseTimestampToMs(currentMarker[1]);
    if (currentStart === null) return null;

    const currentMarkerEnd = (currentMarker.index ?? 0) + currentMarker[0].length;
    const nextMarkerIndex = nextMarker?.index ?? body.length;
    const text = body.slice(currentMarkerEnd, nextMarkerIndex);

    if (!nextMarker) {
      if (text.trim().length === 0) {
        explicitEndTime = currentStart;
        continue;
      }

      inferredWordIndex = words.length;
      words.push({
        startTime: currentStart,
        endTime: currentStart,
        word: text,
        romanWord: '',
      });
      continue;
    }

    const nextStart = parseTimestampToMs(nextMarker[1]);
    if (nextStart === null) return null;
    if (nextStart < currentStart) {
      if (text.length === 0 && currentStart - nextStart <= ENHANCED_EMPTY_BACKWARD_TOLERANCE_MS) {
        continue;
      }
      return null;
    }
    if (text.length === 0) continue;

    words.push({
      startTime: currentStart,
      endTime: nextStart,
      word: text,
      romanWord: '',
    });
  }

  if (words.length === 0) return null;

  const endTime = explicitEndTime ?? words[words.length - 1].endTime;
  if (endTime < lineStartTime) return null;

  return {
    line: {
      words,
      translatedLyric: '',
      romanLyric: '',
      isBG: false,
      isDuet: false,
      startTime: lineStartTime,
      endTime,
    },
    inferredWordIndex,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.floor((sorted[middle - 1] + sorted[middle]) / 2);
}

function collectExplicitWordDurations(result: EnhancedLrcParseResult): number[] {
  return result.line.words.flatMap((word, index) => {
    if (index === result.inferredWordIndex) return [];

    const duration = word.endTime - word.startTime;
    return Number.isFinite(duration) && duration > 0 ? [duration] : [];
  });
}

function finalizeEnhancedLrcLine(
  result: EnhancedLrcParseResult,
  contextualDurations: number[],
  nextLineStartTime?: number,
): AmlLyricLine {
  if (result.inferredWordIndex === null) return result.line;

  const words = result.line.words.map((word) => ({ ...word }));
  const inferredWord = words[result.inferredWordIndex];
  const localDurations = collectExplicitWordDurations(result);
  const estimatedDuration = median(localDurations)
    ?? median(contextualDurations)
    ?? ENHANCED_INFERRED_WORD_DEFAULT_DURATION_MS;
  const clampedDuration = Math.min(
    ENHANCED_INFERRED_WORD_MAX_DURATION_MS,
    Math.max(ENHANCED_INFERRED_WORD_MIN_DURATION_MS, estimatedDuration),
  );
  const estimatedEndTime = inferredWord.startTime + clampedDuration;
  inferredWord.endTime = nextLineStartTime !== undefined
    ? Math.max(inferredWord.startTime, Math.min(estimatedEndTime, nextLineStartTime))
    : estimatedEndTime;

  return {
    ...result.line,
    words,
    endTime: inferredWord.endTime,
  };
}

export function parseEnhancedLrcLine(line: string): AmlLyricLine | null {
  const result = parseEnhancedLrcLineInternal(line);
  return result ? finalizeEnhancedLrcLine(result, []) : null;
}

export function parseEnhancedLrc(source: string): AmlLyricLine[] {
  const results: EnhancedLrcParseResult[] = [];

  for (const rawLine of source.split('\n')) {
    if (!isEnhancedLrcLine(rawLine)) continue;

    const parsedLine = parseEnhancedLrcLineInternal(rawLine);
    if (parsedLine) results.push(parsedLine);
  }

  const contextualDurations = results.flatMap(collectExplicitWordDurations);
  const orderedStartTimes = [...new Set(results.map((result) => result.line.startTime))]
    .sort((left, right) => left - right);

  return results.map((result) => {
    const nextLineStartTime = orderedStartTimes.find((startTime) => startTime > result.line.startTime);
    return finalizeEnhancedLrcLine(result, contextualDurations, nextLineStartTime);
  });
}

function lineContainsEnhancedMarkup(line: AmlLyricLine): boolean {
  if (ENHANCED_TIMESTAMP_TEXT_PATTERN.test(line.translatedLyric || '')) return true;
  if (ENHANCED_TIMESTAMP_TEXT_PATTERN.test(line.romanLyric || '')) return true;

  return (line.words || []).some((word) => ENHANCED_TIMESTAMP_TEXT_PATTERN.test(word.word || ''));
}

export function mergeEnhancedLinesIntoBaseLines(
  enhancedLines: AmlLyricLine[],
  baseLines: AmlLyricLine[],
): AmlLyricLine[] {
  if (enhancedLines.length === 0) return baseLines;
  if (baseLines.length === 0) return enhancedLines;

  const enhancedGroups = new Map<number, AmlLyricLine[]>();
  for (const line of enhancedLines) {
    const existingGroup = enhancedGroups.get(line.startTime);
    if (existingGroup) {
      existingGroup.push(line);
    } else {
      enhancedGroups.set(line.startTime, [line]);
    }
  }

  const baseGroups = new Map<number, AmlLyricLine[]>();
  for (const line of baseLines) {
    const existingGroup = baseGroups.get(line.startTime);
    if (existingGroup) {
      existingGroup.push(line);
    } else {
      baseGroups.set(line.startTime, [line]);
    }
  }

  const times = new Set<number>([
    ...enhancedGroups.keys(),
    ...baseGroups.keys(),
  ]);

  return [...times]
    .sort((a, b) => a - b)
    .flatMap((startTime) => {
      const mergedGroup: AmlLyricLine[] = [];
      const enhancedGroup = enhancedGroups.get(startTime) ?? [];
      const baseGroup = baseGroups.get(startTime) ?? [];

      if (enhancedGroup.length > 0) {
        mergedGroup.push(...enhancedGroup);
        mergedGroup.push(...baseGroup.filter((line) => !lineContainsEnhancedMarkup(line)));
      } else {
        mergedGroup.push(...baseGroup);
      }

      return mergedGroup;
    });
}

function compareParserCandidates(left: ParserCandidate, right: ParserCandidate): number {
  const scoreDiff = scoreParsedLines(right.lines) - scoreParsedLines(left.lines);
  if (scoreDiff !== 0) return scoreDiff;

  const lineCountDiff = right.lines.length - left.lines.length;
  if (lineCountDiff !== 0) return lineCountDiff;

  return PARSER_PRIORITIES[right.source] - PARSER_PRIORITIES[left.source];
}

function toSafeMs(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.round(value);
}

function normalizeParsedWord(
  word: AmlLyricWord,
  fallbackStartMs: number,
  fallbackEndMs: number,
): ParsedWord {
  const startMs = toSafeMs(word.startTime, fallbackStartMs);
  const rawEndMs = toSafeMs(word.endTime, fallbackEndMs);
  const endMs = Math.max(startMs, rawEndMs);

  const romanText = sanitizeWordText(word.romanWord || '');

  return {
    text: sanitizeWordText(word.word || ''),
    startMs,
    endMs,
    romanText: romanText || undefined,
  };
}

function detectExplicitRole(text: string): {
  role?: ExplicitLineRole;
  text: string;
} {
  let normalizedText = sanitizeLineText(text);

  for (const marker of EXPLICIT_LINE_MARKERS) {
    if (!marker.pattern.test(normalizedText)) continue;
    normalizedText = sanitizeLineText(normalizedText.replace(marker.pattern, ''));
    return {
      role: marker.role,
      text: normalizedText,
    };
  }

  return {
    text: normalizedText,
  };
}

function prepareParsedLine(
  line: AmlLyricLine,
  sourceFormat: ParsedLineSourceFormat,
  sourceIndex: number,
): ParsedLine | null {
  const fallbackStartMs = toSafeMs(line.startTime, 0);
  const fallbackEndMs = Math.max(fallbackStartMs + 80, toSafeMs(line.endTime, fallbackStartMs + 500));

  const words = (line.words || [])
    .map((word) => normalizeParsedWord(word, fallbackStartMs, fallbackEndMs))
    .filter((word) => word.text.length > 0)
    .sort((left, right) => left.startMs - right.startMs);

  const wordsText = sanitizeLineText((line.words || []).map((word) => word.word || '').join(''));
  const rawText = wordsText || sanitizeLineText(words.map((word) => word.text).join(''));
  const detected = detectExplicitRole(rawText);
  const translatedText = sanitizeLineText(line.translatedLyric || '');
  const romanText = sanitizeLineText(line.romanLyric || '');

  const firstWordStartMs = words.length > 0 ? words[0].startMs : fallbackStartMs;
  const lastWordEndMs = words.length > 0 ? words[words.length - 1].endMs : fallbackEndMs;

  const startMs = toSafeMs(line.startTime, firstWordStartMs);
  const endMs = Math.max(startMs, toSafeMs(line.endTime, lastWordEndMs));

  if (!detected.text && !translatedText && !romanText && words.length === 0) return null;

  return {
    startMs,
    endMs,
    text: detected.text,
    words: words.length > 0 ? words : undefined,
    translatedText: translatedText || undefined,
    romanText: romanText || undefined,
    sourceFormat,
    sourceIndex,
    explicitRole: detected.role,
  };
}

function normalizeParsedLineEndTimes(lines: ParsedLine[]): ParsedLine[] {
  return lines.map((line, index) => {
    if (line.endMs !== undefined && line.endMs >= line.startMs) {
      return {
        ...line,
        endMs: line.endMs,
      };
    }

    const nextStartMs = lines[index + 1]?.startMs;
    const fallbackEndMs = nextStartMs !== undefined
      ? Math.max(line.startMs, nextStartMs)
      : line.startMs + 5000;

    return {
      ...line,
      endMs: fallbackEndMs,
    };
  });
}

function scoreParsedLines(lines: AmlLyricLine[]): number {
  return lines.reduce((score, line) => {
    const hasWords = (line.words || []).some((word) => sanitizeWordText(word.word || '').length > 0);
    const hasTranslation = sanitizeLineText(line.translatedLyric || '').length > 0;
    const hasRomaji = sanitizeLineText(line.romanLyric || '').length > 0;

    return score + (hasWords ? 2 : 0) + (hasTranslation ? 1 : 0) + (hasRomaji ? 1 : 0);
  }, 0);
}

async function parseWithBestCandidate(raw: string): Promise<ParserCandidate | null> {
  const {
    decryptQrcHex,
    parseEslrc,
    parseLrc,
    parseLys,
    parseQrc,
    parseTTML,
    parseYrc,
  } = await getAmlModule();
  const normalizedTimestamps = normalizeLyricTimestamps(raw);
  const source = normalizedTimestamps.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const normalizedEslrcSource = normalizeEslrcSource(source);
  const candidates: ParserCandidate[] = [];

  const collect = (candidateSource: ParserSource, parser: () => AmlLyricLine[]) => {
    try {
      const lines = parser();
      if (Array.isArray(lines) && lines.length > 0) {
        candidates.push({
          source: candidateSource,
          lines,
        });
      }
    } catch {
      // Try next parser.
    }
  };

  if (/<tt[\s>]/i.test(source)) {
    collect('ttml', () => parseTTML(source).lines);
  }

  const compactHex = source.replace(/\s+/g, '');
  if (/^[0-9a-fA-F]+$/.test(compactHex) && compactHex.length > 64 && compactHex.length % 2 === 0) {
    collect('qrc', () => parseQrc(decryptQrcHex(compactHex)));
  }

  collect('yrc', () => parseYrc(source));
  collect('qrc', () => parseQrc(source));
  collect('lys', () => parseLys(source));
  collect('eslrc', () => parseEslrc(normalizedEslrcSource));
  collect('lrc', () => parseLrc(source));

  const enhancedLines = parseEnhancedLrc(source);
  if (enhancedLines.length > 0) {
    const baselineCandidate = [...candidates]
      .filter((candidate) => candidate.source !== 'enhanced_lrc')
      .sort(compareParserCandidates)[0];

    candidates.push({
      source: 'enhanced_lrc',
      lines: baselineCandidate
        ? mergeEnhancedLinesIntoBaseLines(enhancedLines, baselineCandidate.lines)
        : enhancedLines,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort(compareParserCandidates);
  return candidates[0];
}

export async function parseWithAml(raw: string): Promise<AmlLyricLine[]> {
  const candidate = await parseWithBestCandidate(raw);
  return candidate?.lines ?? [];
}

export async function prepareParsedLyrics(raw: string): Promise<ParsedLine[]> {
  const candidate = await parseWithBestCandidate(raw);
  if (!candidate) return [];

  const prepared = candidate.lines
    .map((line, index) => prepareParsedLine(line, candidate.source, index))
    .filter((line): line is ParsedLine => line !== null)
    .sort((left, right) => (
      (left.startMs - right.startMs)
      || (left.sourceIndex - right.sourceIndex)
      || ((left.endMs ?? left.startMs) - (right.endMs ?? right.startMs))
    ));

  return normalizeParsedLineEndTimes(prepared);
}
