import type { NativeAmlLyricLine, NativeAmlLyricWord } from './ttml';

// Match the published TTML converter's timestamp precision, without snapping or
// extending either source grid. This is not a fuzzy lyric-line grouping window.
const TIMING_TOLERANCE_MS = 2;
const ALIGNMENT_ISSUE = '逐字音译无法可靠对齐，已保留完整整行音译。';

function validTime(word: NativeAmlLyricWord): boolean {
  return Number.isFinite(word.startTime) && Number.isFinite(word.endTime)
    && word.startTime >= 0 && word.endTime >= word.startTime;
}

function findOwner(mainWords: readonly NativeAmlLyricWord[], roman: NativeAmlLyricWord): number | undefined {
  let owner: number | undefined;
  let greatestOverlap = -1;
  let ambiguous = false;
  mainWords.forEach((main, index) => {
    // Core renders whitespace main words as bare text nodes, ignoring romanWord.
    if (!main.word.trim() || !validTime(main)) return;
    if (roman.startTime < main.startTime - TIMING_TOLERANCE_MS
      || roman.endTime > main.endTime + TIMING_TOLERANCE_MS) return;
    const overlap = Math.min(main.endTime, roman.endTime) - Math.max(main.startTime, roman.startTime);
    // A timestamp near a word is not evidence that a disjoint fragment belongs
    // to it. Zero-duration fragments are legal only at an actually shared time.
    if (overlap < 0 || (overlap === 0 && roman.endTime > roman.startTime)) return;
    if (overlap > greatestOverlap) {
      owner = index;
      greatestOverlap = overlap;
      ambiguous = false;
    } else if (overlap === greatestOverlap) {
      ambiguous = true;
    }
  });
  return ambiguous ? undefined : owner;
}

function alignWords(
  mainWords: readonly NativeAmlLyricWord[],
  romanWords: readonly NativeAmlLyricWord[],
): string[] | undefined {
  const owners: Array<number | undefined> = [];
  let previousOwner = -1;
  let previousStart = -1;
  for (const [index, roman] of romanWords.entries()) {
    if (!roman.word.trim()) continue;
    if (!validTime(roman) || roman.startTime < previousStart) return undefined;
    const owner = findOwner(mainWords, roman);
    // Do not shift the remaining phonetic text by array index when a main word
    // has no romanization, or silently reorder an overlapping source grid.
    if (owner === undefined || owner < previousOwner) return undefined;
    owners[index] = owner;
    previousOwner = owner;
    previousStart = roman.startTime;
  }
  const firstOwner = owners.find((owner) => owner !== undefined);
  if (firstOwner === undefined) return undefined;

  const aligned = mainWords.map(() => '');
  // Keep separators verbatim too. They carry no pronounceable text, so attach
  // them to the preceding matched fragment (or the first for leading spaces).
  let owner = firstOwner;
  romanWords.forEach((roman, index) => {
    owner = owners[index] ?? owner;
    aligned[owner] += roman.word;
  });
  // Every source fragment must survive exactly once and in source order. Using
  // source indices, not text deduplication, also preserves repeated syllables.
  return aligned.join('') === romanWords.map((word) => word.word).join('') ? aligned : undefined;
}

/**
 * Project an independent romanization grid into AMLL's public romanWord field.
 * Several phonetic fragments may share one main word's animation; their raw
 * timing remains in romanWords. No renderer internals or source times change.
 */
export function withAlignedRomanization(
  line: NativeAmlLyricLine,
  issues: string[] = [],
): NativeAmlLyricLine {
  const romanWords = line.romanWords;
  if (!romanWords?.length) return line;
  // Plain LRC / a single whole-line word can enter Core's non-dynamic path,
  // which does not draw romanWord. Preserve the full-line auxiliary in that case.
  const hasWordTiming = line.words.length > 1 && romanWords.length > 1;
  const aligned = hasWordTiming ? alignWords(line.words, romanWords) : undefined;
  if (hasWordTiming && !aligned && romanWords.some((word) => word.word.trim())) {
    issues.push(ALIGNMENT_ISSUE);
  }
  return {
    ...line,
    words: line.words.map((word, index) => ({
      ...word,
      // Clear any partial alignment from the official TTML converter on fallback
      // so it cannot be shown again alongside the complete romanLyric.
      romanWord: aligned ? aligned[index] : word.romanWord === undefined ? undefined : '',
    })),
    romanLyric: aligned ? '' : romanWords.map((word) => word.word).join(''),
  };
}
