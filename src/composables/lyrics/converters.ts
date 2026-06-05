import type { LyricLine as CoreAmlLyricLine } from '@applemusic-like-lyrics/core';

import type {
  CurrentLyricDisplayLine,
  DisplayFragment,
  LyricLine,
  LyricWord,
  RenderLine,
  SemanticLine,
} from './types';

function toMs(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1000));
}

const MAX_AML_LINE_LEAD_IN_MS = 300;
const AML_LINE_LEAD_IN_RATIO = 0.25;
const MIN_AML_LINE_DURATION_MS = 40;
const AML_ROMAJI_FRAGMENT_SEPARATOR = '\u00a0';

type AmlLineWithTimedRomaji = CoreAmlLyricLine & {
  romajiWords?: Array<{
    text: string;
    startTime: number;
    endTime: number;
  }>;
};

function getAdaptiveAmlLineLeadInMs(currentStartTime: number, nextStartTime: number): number {
  const gap = nextStartTime - currentStartTime;
  if (gap <= 0) return 0;

  return Math.min(MAX_AML_LINE_LEAD_IN_MS, Math.round(gap * AML_LINE_LEAD_IN_RATIO));
}

function hasRenderableWordRomaji(word: LyricWord | undefined): boolean {
  return Boolean(
    word
    && word.text.trim().length > 0
    && word.end > word.start
    && word.romaji
    && word.romaji.trim().length > 0,
  );
}

function getAmlRomanWord(words: LyricWord[], wordIndex: number): string {
  const romanWord = words[wordIndex]?.romaji || '';
  if (!romanWord.trim()) return '';
  if (/\s$/.test(romanWord)) return romanWord;

  const hasFollowingRomaji = words
    .slice(wordIndex + 1)
    .some(hasRenderableWordRomaji);

  return hasFollowingRomaji ? `${romanWord}${AML_ROMAJI_FRAGMENT_SEPARATOR}` : romanWord;
}

function hasCompleteWordRomaji(words: LyricWord[] | undefined): words is LyricWord[] {
  if (!words || words.length === 0) return false;
  const relevantWords = words.filter((word) => word.text.trim().length > 0 && word.end > word.start);
  return relevantWords.length > 0
    && relevantWords.every((word) => Boolean(word.romaji && word.romaji.trim().length > 0));
}

function createPlainFragment(text: string): DisplayFragment[] | undefined {
  return text ? [{ text }] : undefined;
}

function createFragmentsFromWords(words: SemanticLine['mainWords']): DisplayFragment[] | undefined {
  if (!words || words.length === 0) return undefined;

  return words.map((word) => ({
    text: word.text,
    startMs: word.startMs,
    endMs: word.endMs,
  }));
}

function createRomanFragments(line: SemanticLine): DisplayFragment[] | undefined {
  if (line.romanWords && line.romanWords.length > 0) {
    return line.romanWords.map((word) => ({
      text: word.text,
      startMs: word.startMs,
      endMs: word.endMs,
    }));
  }

  return createPlainFragment(line.romanText || '');
}

export function toRenderLine(line: SemanticLine, options?: {
  showTranslation?: boolean;
  showRomaji?: boolean;
}): RenderLine {
  const showTranslation = options?.showTranslation ?? true;
  const showRomaji = options?.showRomaji ?? true;

  return {
    startMs: line.startMs,
    endMs: line.endMs,
    main: createFragmentsFromWords(line.mainWords) ?? [{ text: line.mainText }],
    translation: showTranslation ? createPlainFragment(line.translationText || '') : undefined,
    roman: showRomaji ? createRomanFragments(line) : undefined,
    secondary: line.secondaryTexts?.map((text) => ({ text })),
  };
}

const ROMAN_ALIGNMENT_TOLERANCE_MS = 80;

function buildRomajiText(line: SemanticLine): string {
  if (line.romanText) return line.romanText;
  if (!line.romanWords || line.romanWords.length === 0) return '';
  return line.romanWords.map((word) => word.text).join('');
}

function alignRomanWordsToMainWords(
  mainWords: SemanticLine['mainWords'],
  romanWords: SemanticLine['romanWords'],
): Array<{ text: string }> | undefined {
  if (!mainWords || mainWords.length === 0 || !romanWords || romanWords.length === 0) return undefined;

  // Fast path: exact match (same count, same timing)
  if (mainWords.length === romanWords.length
    && mainWords.every((w, i) => w.startMs === romanWords[i].startMs && w.endMs === romanWords[i].endMs)
  ) {
    return romanWords.map((w) => ({ text: w.text }));
  }

  // Overlap-based alignment — skip zero-duration main words (spaces/punctuation)
  // so they don't steal romaji fragments from substantive words.
  const mergedTexts = mainWords.map(() => '');

  for (const romanWord of romanWords) {
    const romajiCenter = (romanWord.startMs + romanWord.endMs) / 2;
    let bestIndex = -1;
    let bestOverlap = Number.NEGATIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < mainWords.length; index += 1) {
      const mainWord = mainWords[index];

      // Skip zero-duration words (whitespace, punctuation artifacts)
      if (mainWord.endMs - mainWord.startMs < 1) continue;

      const expandedStart = mainWord.startMs - ROMAN_ALIGNMENT_TOLERANCE_MS;
      const expandedEnd = mainWord.endMs + ROMAN_ALIGNMENT_TOLERANCE_MS;
      const overlap = Math.min(expandedEnd, romanWord.endMs) - Math.max(expandedStart, romanWord.startMs);
      const mainCenter = (mainWord.startMs + mainWord.endMs) / 2;
      const distance = Math.abs(mainCenter - romajiCenter);

      if (
        overlap > bestOverlap
        || (overlap === bestOverlap && distance < bestDistance)
      ) {
        bestIndex = index;
        bestOverlap = overlap;
        bestDistance = distance;
      }
    }

    if (bestIndex >= 0 && mergedTexts[bestIndex] !== undefined) {
      mergedTexts[bestIndex] += romanWord.text;
    }
  }

  return mergedTexts.map((text) => ({ text: text.replace(/\s+/g, ' ').trim() }));
}

export function semanticLineToLyricLine(line: SemanticLine): LyricLine {
  const renderLine = toRenderLine(line);
  const alignedRoman = alignRomanWordsToMainWords(line.mainWords, line.romanWords);

  const words = (line.mainWords || []).map((word, i) => {
    const romaji = alignedRoman?.[i]?.text || word.romanText || '';

    return {
      text: word.text,
      start: word.startMs / 1000,
      end: word.endMs / 1000,
      romaji,
    } satisfies LyricWord;
  });

  return {
    time: line.startMs / 1000,
    endTime: line.endMs / 1000,
    text: line.mainText || renderLine.main[0]?.text || '',
    translation: line.translationText || '',
    romaji: buildRomajiText(line),
    words: words.length > 0 ? words : undefined,
    romajiWords: line.romanWords?.map((word) => ({
      text: word.text,
      start: word.startMs / 1000,
      end: word.endMs / 1000,
    })),
    secondary: line.secondaryTexts ? [...line.secondaryTexts] : undefined,
  };
}

function getOrderedSecondaryLyrics(
  line: Pick<LyricLine, 'translation' | 'romaji'>,
  showTranslation: boolean,
  showRomaji: boolean,
): string[] {
  const orderedLines: string[] = [];
  if (showRomaji && line.romaji) orderedLines.push(line.romaji);
  if (showTranslation && line.translation) orderedLines.push(line.translation);
  return orderedLines;
}

export function convertLyricsToAmlLines(
  lines: LyricLine[],
  showTranslation: boolean,
  showRomaji: boolean,
): CoreAmlLyricLine[] {
  return lines.map((line, lineIndex) => {
    const canRenderAlignedRomaji = showRomaji && hasCompleteWordRomaji(line.words);
    const renderLine = {
      startMs: toMs(line.time),
      endMs: toMs(line.endTime || line.time),
      main: line.words?.map((word) => ({
        text: word.text,
        startMs: toMs(word.start),
        endMs: toMs(word.end),
      })) ?? [{ text: line.text }],
      translation: showTranslation && line.translation ? [{ text: line.translation }] : undefined,
      roman: showRomaji && line.romaji
        ? (canRenderAlignedRomaji
          ? line.words!.map((word) => ({
            text: word.romaji || '',
            startMs: toMs(word.start),
            endMs: toMs(word.end),
          }))
          : [{ text: line.romaji }])
        : undefined,
    } satisfies RenderLine;

    const startTime = renderLine.startMs;
    const parsedEndTime = renderLine.endMs;
    const nextLine = lines[lineIndex + 1];
    const nextStartTime = toMs(nextLine?.time ?? line.time + 3);
    const adaptiveLeadIn = nextLine
      ? getAdaptiveAmlLineLeadInMs(startTime, nextStartTime)
      : 0;
    const lineBoundaryEndTime = nextLine
      ? nextStartTime - adaptiveLeadIn
      : Math.max(parsedEndTime, nextStartTime);
    const endTime = Math.max(startTime + MIN_AML_LINE_DURATION_MS, lineBoundaryEndTime);

    const sourceWords = line.words ?? [];
    const convertedWords = sourceWords.map((word, wordIndex) => {
      const wordStart = toMs(word.start);
      const nextWordStart = sourceWords[wordIndex + 1]?.start;
      const rawWordEnd = nextWordStart !== undefined
        ? toMs(nextWordStart)
        : toMs(word.end > word.start ? word.end : endTime / 1000);
      const wordEnd = Math.max(wordStart + 20, Math.min(endTime, rawWordEnd));

      return {
        word: word.text,
        startTime: wordStart,
        endTime: wordEnd,
        romanWord: canRenderAlignedRomaji ? getAmlRomanWord(sourceWords, wordIndex) : '',
        obscene: false,
      };
    }).filter((word) => word.word.length > 0);

    const words = convertedWords.length > 0
      ? convertedWords
      : [{
          word: line.text || renderLine.main[0]?.text || ' ',
          startTime,
          endTime,
          romanWord: '',
          obscene: false,
        }];

    const amlLine: AmlLineWithTimedRomaji = {
      words,
      translatedLyric: renderLine.translation?.[0]?.text || '',
      romanLyric: showRomaji && !canRenderAlignedRomaji ? (line.romaji || '') : '',
      startTime,
      endTime,
      isBG: false,
      isDuet: false,
    };

    if (showRomaji && !canRenderAlignedRomaji && line.romajiWords && line.romajiWords.length > 0) {
      amlLine.romajiWords = line.romajiWords.map((word) => ({
        text: word.text,
        startTime: toMs(word.start),
        endTime: toMs(word.end),
      }));
    }

    return amlLine;
  });
}

export function getCurrentLyricDisplayLines(
  line: LyricLine,
  showTranslation: boolean,
  showRomaji: boolean,
): CurrentLyricDisplayLine[] {
  const displayLines: CurrentLyricDisplayLine[] = [{
    kind: 'main',
    text: line.text || line.words?.map((word) => word.text).join('') || '',
  }];

  if (showRomaji && line.romaji) {
    const romajiWords = line.romajiWords && line.romajiWords.length > 0
      ? line.romajiWords
      : (line.words ?? [])
        .filter((word) => (word.romaji || '').length > 0)
        .map((word) => ({
          text: word.romaji || '',
          start: word.start,
          end: word.end,
        }));

    displayLines.push({
      kind: 'romaji',
      text: line.romaji,
      words: romajiWords.length > 0 ? romajiWords : undefined,
    });
  }

  if (showTranslation && line.translation) {
    displayLines.push({
      kind: 'translation',
      text: line.translation,
    });
  }

  return displayLines;
}

export function getDisplaySubtitles(
  line: Pick<LyricLine, 'translation' | 'romaji'>,
  showTranslation: boolean,
  showRomaji: boolean,
) {
  const orderedLines = getOrderedSecondaryLyrics(line, showTranslation, showRomaji);
  return {
    upper: orderedLines[0] || '',
    lower: orderedLines[1] || '',
  };
}
