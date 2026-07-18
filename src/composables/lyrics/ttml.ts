import type {
  LyricLine as CoreAmlLyricLine,
  LyricWord as CoreAmlLyricWord,
} from '@applemusic-like-lyrics/core';
import type {
  LyricLine as ParsedAmlLyricLine,
  LyricWord as ParsedAmlLyricWord,
} from '@applemusic-like-lyrics/lyric/pkg/amll_lyric.js';

import type { ActiveLyricsFormat, LyricLine } from './types';

export interface NativeAmlRubyWord {
  word: string;
  startTime: number;
  endTime: number;
}

export type ParsedTtmlWord = ParsedAmlLyricWord & {
  ruby?: NativeAmlRubyWord[];
  obscene?: boolean;
  emptyBeat?: number;
};

export type ParsedTtmlLine = Omit<ParsedAmlLyricLine, 'words'> & {
  words: ParsedTtmlWord[];
  emptyBeat?: number;
};

export type NativeAmlLyricWord = CoreAmlLyricWord & {
  ruby?: NativeAmlRubyWord[];
  emptyBeat?: number;
};

export type NativeAmlLyricLine = Omit<CoreAmlLyricLine, 'words'> & {
  words: NativeAmlLyricWord[];
  emptyBeat?: number;
};

export type LegacyAmlConverter = (
  lines: LyricLine[],
  showTranslation: boolean,
  showRomaji: boolean,
) => CoreAmlLyricLine[];

function sanitizeTime(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function isTtmlLyrics(raw: string): boolean {
  const source = raw.replace(/^\uFEFF/, '').trimStart();
  const withoutDeclaration = source.replace(/^<\?xml\s[\s\S]*?\?>/i, '').trimStart();
  return /^<tt(?:\s|>)/i.test(withoutDeclaration);
}

export function sanitizeNativeTtmlLines(lines: ParsedTtmlLine[]): NativeAmlLyricLine[] {
  return lines.map((line) => {
    const startTime = sanitizeTime(line.startTime, 0);
    const words = (line.words ?? []).map((word) => {
      const wordStartTime = sanitizeTime(word.startTime, startTime);
      const rawWordEndTime = sanitizeTime(word.endTime, wordStartTime);

      return {
        ...word,
        startTime: wordStartTime,
        endTime: Math.max(wordStartTime, rawWordEndTime),
        word: word.word ?? '',
        romanWord: word.romanWord ?? '',
        obscene: word.obscene ?? false,
      };
    });
    const latestWordEndTime = words.reduce(
      (latestEndTime, word) => Math.max(latestEndTime, word.endTime),
      startTime,
    );
    const rawEndTime = sanitizeTime(line.endTime, startTime);
    // AMLL requires every timed word to stay inside its parent line. Overlapping
    // TTML vocal parts can make the parser-provided line end precede its final
    // word; passing that invalid timeline through can collapse the whole layout.
    const endTime = Math.max(startTime, rawEndTime, latestWordEndTime);

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

export async function parseNativeTtml(raw: string): Promise<NativeAmlLyricLine[]> {
  // lyric@0.3.0 does not expose a resolver-compatible package root, so isolate its
  // shipped AMLL entry here until the dependency can be upgraded independently.
  const { parseTTML } = await import('@applemusic-like-lyrics/lyric/pkg/amll_lyric.js');
  const document = parseTTML(raw);
  return sanitizeNativeTtmlLines(document.lines as ParsedTtmlLine[]);
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

  return {
    time: line.startTime / 1000,
    endTime: line.endTime / 1000,
    text: words.map((word) => word.text).join(''),
    translation: line.translatedLyric,
    romaji: line.romanLyric,
    isBG: line.isBG,
    isDuet: line.isDuet,
    words: words.length > 0 ? words : undefined,
    romajiWords: hasWordRomaji
      ? words.map((word) => ({
          text: word.romaji || '',
          start: word.start,
          end: word.end,
        }))
      : undefined,
  };
}

export function applyNativeAmlDisplaySettings(
  lines: NativeAmlLyricLine[],
  showTranslation: boolean,
  showRomaji: boolean,
): NativeAmlLyricLine[] {
  return lines.map((line) => ({
    ...line,
    translatedLyric: showTranslation ? line.translatedLyric : '',
    romanLyric: showRomaji ? line.romanLyric : '',
    words: line.words.map((word) => ({
      ...word,
      romanWord: showRomaji ? word.romanWord : '',
    })),
  }));
}

export function selectAmlLyricLines(
  activeFormat: ActiveLyricsFormat,
  nativeLines: NativeAmlLyricLine[],
  legacyLines: LyricLine[],
  showTranslation: boolean,
  showRomaji: boolean,
  convertLegacy: LegacyAmlConverter,
): CoreAmlLyricLine[] {
  if (activeFormat === 'ttml' && nativeLines.length > 0) {
    return applyNativeAmlDisplaySettings(nativeLines, showTranslation, showRomaji);
  }

  return convertLegacy(legacyLines, showTranslation, showRomaji);
}
