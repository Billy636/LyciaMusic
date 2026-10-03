import { parseOfficialLyrics as parseLyrics, type OfficialLyricsOptions as LyricsParseOptions } from './officialParser';
import { amlLineToLegacyLyricLine as toDisplayLyricLine, type NativeAmlLyricLine as TimedLyricLine } from './ttml';
import type { ActiveLyricsFormat, LyricLine } from './types';

export interface LyricsReadingPreview {
  lines: LyricLine[];
  metadata: Array<{ key: string; label: string; value: string }>;
  unparsedLines: string[];
  format: ActiveLyricsFormat;
  issues: string[];
  error?: string;
  /** Display-only fallback. Never use this projection to save or export lyrics. */
  plainText: string;
}

const METADATA_LABELS: Record<string, string> = {
  ti: '歌曲',
  ar: '歌手',
  al: '专辑',
  au: '作者',
  by: '歌词制作',
  offset: '时间偏移',
  length: '时长',
  re: '制作软件',
  ve: '软件版本',
  tool: '制作工具',
  la: '语言',
  language: '语言',
};

const TIME_MARKER = String.raw`(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,6})?\]|<\d{1,3}:\d{1,2}(?:[.:]\d{1,6})?>)`;
const EMPTY_TIMED_LINE = new RegExp(`^(?:${TIME_MARKER}\\s*)+$`);
const LRC_FORMATS = new Set<ActiveLyricsFormat>(['lrc', 'enhanced_lrc', 'eslrc']);
const OTHER_LINE_PREFIXES: Partial<Record<ActiveLyricsFormat, RegExp>> = {
  yrc: /^\[\d+,\d+\]\s*\(\d+,\d+,0\)/,
  qrc: /^\[\d+,\d+\]/,
  lys: /^\[[0-8]\].*\(\d+,\d+\)/,
};

function readMetadata(line: string): LyricsReadingPreview['metadata'][number] | undefined {
  const trimmed = line.trim();
  const match = /^\[\s*([a-z]+)\s*:(.*)\]$/i.exec(trimmed);
  if (!match) return undefined;
  const key = match[1].toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(METADATA_LABELS, key)) return undefined;

  // Require one complete tag, while allowing titles/artists containing [brackets].
  // Adjacent tags or a tag followed by lyric text are not standalone metadata.
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === '[') depth += 1;
    if (trimmed[index] === ']') depth -= 1;
    if (depth === 0 && index < trimmed.length - 1) return undefined;
  }
  if (depth !== 0) return undefined;
  return { key, label: METADATA_LABELS[key], value: match[2].trim() };
}

function toReadingLine(source: TimedLyricLine): LyricLine {
  const line = toDisplayLyricLine(source);
  // Keep optional auxiliary text if a parser supplies it in addition to its roles.
  const secondary = (source as TimedLyricLine & { secondary?: unknown }).secondary;
  if (Array.isArray(secondary)) {
    line.secondary = secondary.filter((text): text is string => typeof text === 'string');
  }
  return line;
}

function hasReadableText(line: LyricLine): boolean {
  return Boolean(line.text.trim() || line.translation.trim() || line.romaji.trim()
    || line.secondary?.some((text) => text.trim()));
}

/**
 * Read-only presentation of this exact draft, independent of the playing song.
 * The caller owns the untouched source and must always save that source instead.
 */
export async function parseLyricsReadingPreview(
  raw: string,
  options: LyricsParseOptions = {},
): Promise<LyricsReadingPreview> {
  const result = await parseLyrics(raw, options);
  // Match the parser's normalization so its one-based diagnostics identify the
  // correct physical line even with a BOM, CRLF, or leading blank lines.
  const source = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const sourceLines = source ? source.split('\n') : [];
  const metadata: LyricsReadingPreview['metadata'] = [];
  const metadataIndexes = new Set<number>();
  if (result.format !== 'ttml') {
    sourceLines.forEach((line, index) => {
      const entry = readMetadata(line);
      if (!entry) return;
      metadata.push(entry);
      metadataIndexes.add(index);
    });
  }

  // Do not independently sort or combine rows: that would break main/BG vocal
  // adjacency and the user's explicit original/translation/romanization order.
  const lines = result.lines.map(toReadingLine).filter(hasReadableText);
  const unparsedIndexes = new Set<number>();
  if (LRC_FORMATS.has(result.format)) {
    for (const issue of result.issues) {
      for (const match of issue.matchAll(/第\s*(\d+)\s*行(?:没有时间戳|无法解析)/g)) {
        const index = Number(match[1]) - 1;
        if (sourceLines[index]?.trim() && !metadataIndexes.has(index)) unparsedIndexes.add(index);
      }
    }
    sourceLines.forEach((line, index) => {
      if (metadataIndexes.has(index)) return;
      // The parser silently skips comments and unknown bracket metadata. Keep
      // those original rows available instead of treating them as lyric credits.
      if (/^(?:#|\/\/)|^\[\s*[a-z]+\s*:.*\]$/i.test(line.trim())) unparsedIndexes.add(index);
    });
  } else {
    const linePrefix = OTHER_LINE_PREFIXES[result.format];
    // Apply this only to plain line-based documents, not QRC XML or encrypted
    // QRC: those must be interpreted as a complete document by their parser.
    if (linePrefix && sourceLines.some((line) => linePrefix.test(line.trim()))
      && !/<QrcInfos\b|\bLyricContent\s*=/i.test(source)) {
      sourceLines.forEach((line, index) => {
        if (line.trim() && !metadataIndexes.has(index) && !linePrefix.test(line.trim())) {
          unparsedIndexes.add(index);
        }
      });
    }
  }

  const structuredSource = /<[^>\n]+>|^\s*\{|^\s*\[\s*["{[]/m.test(source);
  let plainText = '';
  if (result.error) {
    plainText = raw;
  } else if (!lines.length) {
    // Unknown XML/structured content is not safe to simplify as plain lyrics.
    plainText = structuredSource && !LRC_FORMATS.has(result.format)
      ? raw
      : sourceLines.filter((line, index) => !metadataIndexes.has(index)
        && !EMPTY_TIMED_LINE.test(line.trim())).join('\n').trim();
  }

  return {
    lines,
    metadata,
    unparsedLines: lines.length && !result.error
      ? [...unparsedIndexes].sort((left, right) => left - right).map((index) => sourceLines[index])
      : [],
    format: result.format,
    // Unsynchronized plain text is a normal reading mode, not a format error.
    issues: result.format === 'unknown' && !structuredSource && !result.error
      ? result.issues.filter((issue) => issue !== '无法识别歌词格式，已保留原文。')
      : result.issues,
    ...(result.error ? { error: result.error } : {}),
    plainText,
  };
}
