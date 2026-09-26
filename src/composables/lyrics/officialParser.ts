import type { LyricLine as ParsedLyricLine } from '@applemusic-like-lyrics/lyric';

import type { ActiveLyricsFormat, LyricsReadingOrder } from './types';
import type { LyricsReadingRole } from './readingOrder';
import { groupLyricsByReadingOrder, type ReadingOrderLyricEntry } from './readingOrderGrouping';
import {
  isTtmlLyrics,
  parseNativeTtml,
  sanitizeNativeTtmlLines,
  type NativeAmlLyricLine,
} from './ttml';

export interface OfficialLyricsOptions {
  format?: string | null;
  durationMs?: number;
  readingOrder?: LyricsReadingOrder;
}

export interface OfficialLyricsResult {
  lines: NativeAmlLyricLine[];
  format: ActiveLyricsFormat;
  issues: string[];
  /** A parsing failure, distinct from an empty or unsynchronized source. */
  error?: string;
}

interface LrcEntry extends ReadingOrderLyricEntry {
  inferredEnd: 'line' | 'word' | null;
}

type OfficialLyricModule = typeof import('@applemusic-like-lyrics/lyric');
const TIME_TAG_SOURCE = String.raw`(?:\[|<)\d{1,3}:\d{1,2}(?:[.:]\d{1,6})?(?:\]|>)`;
const LEADING_TIMES = new RegExp(`^(?:${TIME_TAG_SOURCE})+`);
const TRAILING_TIME = new RegExp(`${TIME_TAG_SOURCE}$`);
const METADATA_LINE = /^\[\s*[a-z]+\s*:.*\]$/i;
const ROLE_PREFIXES: Array<[LyricsReadingRole, RegExp]> = [
  ['main', /^(?:\[(?:main|orig|original)\]|【原文】|原文[:：])\s*/iu],
  ['translation', /^(?:\[(?:tr|trans|translation)\]|【(?:翻译|译文)】|(?:翻译|译文)[:：])\s*/iu],
  ['roman', /^(?:\[(?:roma|romaji|roman)\]|【(?:罗马音|罗马字|音译)】|(?:罗马音|罗马字|音译)[:：])\s*/iu],
];

function formatHint(value?: string | null): ActiveLyricsFormat {
  const hint = value?.toLowerCase().trim().replace(/^\./, '');
  if (hint === 'eqrc') return 'qrc';
  if (hint === 'spl' || hint === 'lrca2' || hint === 'enhanced-lrc') return 'enhanced_lrc';
  if (hint === 'eslyric') return 'eslrc';
  return ['ttml', 'lrc', 'enhanced_lrc', 'eslrc', 'yrc', 'qrc', 'lys'].includes(hint ?? '')
    ? hint as ActiveLyricsFormat
    : 'unknown';
}

function isEncryptedQrc(source: string): boolean {
  const compact = source.replace(/\s/g, '');
  return compact.length > 64 && compact.length % 16 === 0 && /^[\da-f]+$/i.test(compact);
}

function detectFormat(source: string, hint?: string | null): ActiveLyricsFormat {
  const requested = formatHint(hint);
  if (requested !== 'unknown' && !['lrc', 'enhanced_lrc', 'eslrc'].includes(requested)) {
    return requested;
  }
  if (isTtmlLyrics(source)) return 'ttml';
  if (/^\s*\[\d+,\d+\]\s*\(\d+,\d+,0\)/m.test(source)) return 'yrc';
  if (/^\s*\[\d+,\d+\].*\(\d+,\d+\)/m.test(source)
    || /<QrcInfos\b|\bLyricContent\s*=/i.test(source) || isEncryptedQrc(source)) return 'qrc';
  if (/^\s*\[[0-8]\].*\(\d+,\d+\)/m.test(source)) return 'lys';
  if (new RegExp(TIME_TAG_SOURCE).test(source)) {
    if (/<\d{1,3}:\d{1,2}(?:[.:]\d{1,6})?>/.test(source)) return 'enhanced_lrc';
    if (/\]\s*[^[\]\r\n]+\[\d{1,3}:\d{1,2}/.test(source)) return 'eslrc';
    return 'lrc';
  }
  return requested;
}

function stripRole(text: string): { text: string; role?: LyricsReadingRole; roleConflict: boolean } {
  let role: LyricsReadingRole | undefined;
  let roleConflict = false;
  while (true) {
    const found = ROLE_PREFIXES.find(([, pattern]) => pattern.test(text));
    if (!found) break;
    if (role && role !== found[0]) roleConflict = true;
    role ??= found[0];
    text = text.replace(found[1], '');
  }
  return { text, role, roleConflict };
}

function prepareLrcLine(source: string): {
  text: string; role?: LyricsReadingRole; duet: boolean; protectedVocal: boolean; roleConflict: boolean;
} {
  const outer = stripRole(source);
  const prefix = LEADING_TIMES.exec(outer.text)?.[0] ?? '';
  let body = outer.text.slice(prefix.length);
  const inner = stripRole(body.trimStart());
  if (inner.role) body = inner.text;
  // Existing LyciaMusic files use v1:<timestamp> / v2:<timestamp>. This is
  // explicit singer syntax, not a language or translation heuristic.
  const voice = /^\s*v([12])\s*:\s*(?=<\d)/i.exec(body);
  if (voice) body = body.slice(voice[0].length);
  return {
    text: prefix + body,
    role: outer.role ?? inner.role,
    duet: voice?.[1] === '2',
    protectedVocal: Boolean(voice),
    roleConflict: outer.roleConflict || inner.roleConflict
      || Boolean(outer.role && inner.role && outer.role !== inner.role),
  };
}

function timestamp(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor(ms / 1000) % 60;
  return `[${minutes}:${String(seconds).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}]`;
}

function lastLrcOffset(source: string): number {
  let offset = 0;
  // Read the original tags: the official metadata map deduplicates values, so
  // its final item is not necessarily the last tag in the file.
  const pattern = /^\s*\[offset\s*:\s*([+-]?\d+)\s*(?:ms)?\s*\]\s*$/gim;
  for (const match of source.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isSafeInteger(value)) offset = value;
  }
  return offset;
}

function shiftLine(line: NativeAmlLyricLine, offset: number): void {
  if (!offset) return;
  const shift = (value: number) => Math.max(0, value + offset);
  line.startTime = shift(line.startTime);
  line.endTime = shift(line.endTime);
  for (const word of line.words) {
    word.startTime = shift(word.startTime);
    word.endTime = shift(word.endTime);
  }
}

function resolveLrcEnds(entries: LrcEntry[], durationMs: number | undefined): void {
  // Equal-time lines are independent voices, not each other's end markers.
  const starts = [...new Set(entries.map(({ line }) => line.startTime))].sort((a, b) => a - b);
  for (const entry of entries) {
    if (!entry.inferredEnd) continue;
    const { line } = entry;
    const lastWord = line.words[line.words.length - 1];
    if (!lastWord) continue;
    const nextStart = starts.find((start) => start > line.startTime && start >= lastWord.startTime);
    const end = nextStart !== undefined
      ? nextStart
      : durationMs !== undefined && durationMs >= lastWord.startTime
        ? durationMs
        : lastWord.startTime + (entry.inferredEnd === 'word' ? 1000 : 5000);
    lastWord.endTime = end;
    line.endTime = line.words.reduce((latest, word) => Math.max(latest, word.endTime), end);
  }
}

function sortVocalGroups(lines: NativeAmlLyricLine[]): NativeAmlLyricLine[] {
  const groups: NativeAmlLyricLine[][] = [];
  let mainGroup: NativeAmlLyricLine[] | undefined;
  for (const line of lines) {
    if (line.isBG && mainGroup) {
      mainGroup.push(line);
      continue;
    }
    const group = [line];
    groups.push(group);
    // Clear markers do not become hosts for a following background vocal.
    if (line.words.some((word) => word.word.trim())) mainGroup = group;
  }
  // AMLL determines main/BG ownership from adjacency, not start times. A BG
  // may start before its main vocal; only reorder complete vocal groups.
  return groups.sort((left, right) => left[0].startTime - right[0].startTime).flat();
}

function parseLrcDocument(
  source: string,
  library: OfficialLyricModule,
  durationMs: number | undefined,
  issues: string[],
  readingOrder?: LyricsReadingOrder,
): NativeAmlLyricLine[] {
  const entries: LrcEntry[] = [];
  let previousGroup: LrcEntry[] = [];
  for (const [index, rawLine] of source.split('\n').entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^(?:#|\/\/)/.test(trimmed) || METADATA_LINE.test(trimmed)) continue;
    const prepared = prepareLrcLine(trimmed);
    let text = prepared.text;
    const leading = LEADING_TIMES.exec(text)?.[0] ?? '';
    if (!leading) {
      if (!prepared.role || previousGroup.length === 0) {
        issues.push(`第 ${index + 1} 行没有时间戳，已保留原文。`);
        continue;
      }
      text = timestamp(previousGroup[previousGroup.length - 1].line.startTime) + text;
    }
    const lyricText = text.replace(new RegExp(TIME_TAG_SOURCE, 'g'), '').trim();
    if (!lyricText) {
      const tags = text.match(new RegExp(TIME_TAG_SOURCE, 'g')) ?? [];
      const lastTag = tags[tags.length - 1];
      const previous = previousGroup[previousGroup.length - 1];
      const end = lastTag ? library.parseLrcLike(`${lastTag}x`).lines[0]?.startTime : undefined;
      if (previous?.inferredEnd && end !== undefined && end > previous.line.startTime) {
        const lastWord = previous.line.words[previous.line.words.length - 1];
        if (lastWord && end >= lastWord.startTime) {
          previous.line.endTime = end;
          lastWord.endTime = end;
          previous.inferredEnd = null;
        }
      }
      for (const tag of [...new Set(tags)]) {
        const marker = library.parseLrcLike(`${tag}x`).lines[0];
        if (!marker) continue;
        const [line] = sanitizeNativeTtmlLines([{
          ...marker,
          endTime: marker.startTime,
          words: [{ word: '', startTime: marker.startTime, endTime: marker.startTime }],
        }]);
        // Preserve an explicit blank for start-time-based desktop/taskbar
        // consumers. The AMLL display projection removes this clear record.
        entries.push({ line, sourceTime: line.startTime, inferredEnd: 'line' });
      }
      continue;
    }
    // Parse one physical line at a time. lyric@1.1 intentionally flattens any
    // subsequent same-time line to a single auxiliary word when parsing a whole
    // document. Keeping independent lines avoids that irreversible data loss.
    const prefix = LEADING_TIMES.exec(text)?.[0] ?? '';
    const content = text.slice(prefix.length);
    let parserText = text;
    if (prefix.includes('<') && !new RegExp(TIME_TAG_SOURCE).test(content)) {
      // Without a final timestamp the official parser mistakes [line]<word>A
      // for repeated plain-LRC lines. A zero-length temporary endpoint makes
      // that explicit enhanced syntax unambiguous; resolveLrcEnds fills its
      // missing end from the next line / song duration, never this placeholder.
      const tags = prefix.match(new RegExp(TIME_TAG_SOURCE, 'g')) ?? [];
      parserText += tags[tags.length - 1];
    }
    const parsed = library.parseLrcLike(parserText).lines;
    if (parsed.length === 0) {
      issues.push(`第 ${index + 1} 行无法解析，已保留原文。`);
      continue;
    }
    const lines = sanitizeNativeTtmlLines(parsed, issues);
    const group = lines.map((line): LrcEntry => ({
      line: { ...line, isDuet: prepared.duet },
      role: prepared.role,
      roleConflict: prepared.roleConflict,
      protectedVocal: prepared.protectedVocal,
      sourceTime: line.startTime,
      inferredEnd: TRAILING_TIME.test(text) ? null
        : line.words.length > 1 || line.words[0]?.startTime !== line.startTime ? 'word' : 'line',
    }));
    entries.push(...group);
    if (!prepared.role || prepared.role === 'main') previousGroup = group;
  }
  const offset = lastLrcOffset(source);
  for (const { line } of entries) shiftLine(line, offset);
  resolveLrcEnds(entries, durationMs);
  const grouped = groupLyricsByReadingOrder(entries, readingOrder);
  issues.push(...grouped.issues);
  return sortVocalGroups(grouped.lines);
}

function unwrapQrc(source: string): string {
  if (!/\bLyricContent\s*=/i.test(source)) return source;
  const attribute = /\bLyricContent\s*=\s*(["'])([\s\S]*?)\1/i.exec(source);
  if (!attribute) throw new Error('QRC XML 没有 LyricContent');
  // Parsing an XML attribute normally folds literal newlines into spaces.
  // Decode its entities as a text node so original QRC line breaks survive.
  const document = new DOMParser().parseFromString(`<lyric>${attribute[2]}</lyric>`, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('QRC XML 无效');
  return (document.documentElement.textContent ?? '').replace(/\\r\\n|\\n|\\r/g, '\n');
}

/** Official format parsers plus explicitly documented LyciaMusic policy only. */
export async function parseOfficialLyrics(
  raw: string,
  options: OfficialLyricsOptions = {},
): Promise<OfficialLyricsResult> {
  const source = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const format = detectFormat(source, options.format);
  const issues: string[] = [];
  if (!source) return { lines: [], format, issues };
  if (format === 'unknown') return { lines: [], format, issues: ['无法识别歌词格式，已保留原文。'] };
  try {
    const duration = options.durationMs;
    const durationMs = duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : undefined;
    if (format === 'ttml') {
      const lines = await parseNativeTtml(source, issues, durationMs);
      if (!lines.length) issues.push('没有解析到有效时间歌词，已保留原文。');
      return { lines, format, issues: [...new Set(issues)] };
    }
    const library = await import('@applemusic-like-lyrics/lyric');
    let lines: NativeAmlLyricLine[];
    if (format === 'lrc' || format === 'enhanced_lrc' || format === 'eslrc') {
      lines = parseLrcDocument(source, library, durationMs, issues, options.readingOrder);
    } else {
      let parsed: ParsedLyricLine[];
      if (format === 'qrc') {
        const decoded = isEncryptedQrc(source)
          ? library.decryptQrcHex(source.replace(/\s/g, '')) : source;
        parsed = library.parseQrc(unwrapQrc(decoded));
      } else {
        parsed = format === 'yrc' ? library.parseYrc(source) : library.parseLys(source);
      }
      const contentLines = parsed.filter((line) => line.words.some((word) => word.word.trim()));
      if (contentLines.length !== parsed.length) issues.push('已跳过没有有效歌词文字的时间行。');
      const nativeLines = sanitizeNativeTtmlLines(contentLines, issues);
      if (options.readingOrder !== undefined && (format === 'qrc' || format === 'yrc')) {
        const grouped = groupLyricsByReadingOrder(nativeLines.map((line) => ({ line })), options.readingOrder);
        issues.push(...grouped.issues);
        lines = sortVocalGroups(grouped.lines);
      } else {
        // LYS property flags are native vocal identities, not language slots.
        lines = sortVocalGroups(nativeLines);
      }
    }
    if (lines.length === 0) issues.push('没有解析到有效时间歌词，已保留原文。');
    return { lines, format, issues: [...new Set(issues)] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = `歌词解析失败：${message}`;
    return { lines: [], format, issues: [diagnostic], error: diagnostic };
  }
}
