import type { CurrentLyricDisplayLine, LyricLine } from './types';

/** A display projection only: never infer roles or rewrite source timestamps here. */
export function getCurrentLyricDisplayLines(
  line: LyricLine,
  showTranslation: boolean,
  showRomaji: boolean,
): CurrentLyricDisplayLine[] {
  const displayLines: CurrentLyricDisplayLine[] = [{
    kind: 'main',
    text: line.text || line.words?.map((word) => word.text).join('') || '',
    words: line.words,
  }];

  if (showRomaji) {
    const romajiWords = line.romajiWords?.length
      ? line.romajiWords
      : (line.words ?? [])
        .filter((word) => Boolean(word.romaji))
        .map((word) => ({
          text: word.romaji || '',
          start: word.start,
          end: word.end,
        }));
    const text = line.romaji || romajiWords.map((word) => word.text).join(' ');
    if (text) {
      displayLines.push({
        kind: 'romaji',
        text,
        words: romajiWords.length > 0 ? romajiWords : undefined,
      });
    }
  }

  if (showTranslation && line.translation) {
    displayLines.push({
      kind: 'translation',
      text: line.translation,
      words: line.translationWords,
    });
  }

  return displayLines;
}
