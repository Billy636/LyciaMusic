export const TIMED_ROMAJI_SUBLINE_OPACITY = '1';
export const TIMED_ROMAJI_BASE_OPACITY = '0.3';
export const TIMED_ROMAJI_HIGHLIGHT_OPACITY = '1';

type InlineRomajiWord = {
  word: string;
  romanWord: string;
  startTime?: number;
  endTime?: number;
};

export function getInlineRomajiPatchPlan(
  renderedWords: string[],
  sourceWords: InlineRomajiWord[],
) {
  const plan: Array<{ elementIndex: number; romanWord: string }> = [];
  let sourceIndex = 0;

  for (let elementIndex = 0; elementIndex < renderedWords.length; elementIndex += 1) {
    const renderedWord = renderedWords[elementIndex];
    while (
      sourceIndex < sourceWords.length
      && sourceWords[sourceIndex]?.word !== renderedWord
    ) {
      sourceIndex += 1;
    }

    const sourceWord = sourceWords[sourceIndex];
    if (!sourceWord) break;

    if (sourceWord.romanWord.trim().length > 0) {
      plan.push({ elementIndex, romanWord: sourceWord.romanWord });
    }

    sourceIndex += 1;
  }

  return plan;
}

export function shouldRebuildTimedRomajiDom(
  currentSignature: string | undefined,
  nextSignature: string,
  currentWordCount: number,
  nextWordCount: number,
) {
  return currentSignature !== nextSignature || currentWordCount !== nextWordCount;
}

export function getTimedRomajiProgress(currentTime: number, startTime: number, endTime: number) {
  const duration = endTime - startTime;
  if (!Number.isFinite(duration) || duration <= 0) {
    return currentTime >= startTime ? 1 : 0;
  }

  return Math.max(0, Math.min(1, (currentTime - startTime) / duration));
}

export function getTimedRomajiFillProgress(
  currentTime: number,
  lineEndTime: number,
  wordStartTime: number,
  wordEndTime: number,
) {
  if (Number.isFinite(lineEndTime) && currentTime >= lineEndTime) {
    return 0;
  }

  return getTimedRomajiProgress(currentTime, wordStartTime, wordEndTime);
}
