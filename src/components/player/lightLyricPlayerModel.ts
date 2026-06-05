import type { LyricLine, LyricWord } from '../../composables/lyrics';

export const LIGHT_LYRIC_VISIBLE_BEFORE = 3;
export const LIGHT_LYRIC_VISIBLE_AFTER = 4;
export const LIGHT_LYRIC_PROGRESS_FRAME_MS = 33;

export interface LightLyricVisibleLine {
  index: number;
  line: LyricLine;
  isActive: boolean;
}

export interface LightLyricActiveWord {
  index: number;
  progress: number;
}

export interface LightLyricRenderableWord {
  index: number;
  word: LyricWord;
}

const DEFAULT_LINE_DURATION_SECONDS = 3;

function hasTimedWord(word: LyricWord) {
  return word.text.length > 0 && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start;
}

function clampProgress(value: number) {
  return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}

export function findLightLyricIndexByTime(lines: LyricLine[], currentTime: number) {
  if (lines.length === 0) return -1;

  let left = 0;
  let right = lines.length - 1;
  let answer = -1;

  while (left <= right) {
    const mid = (left + right) >> 1;
    if (lines[mid].time <= currentTime) {
      answer = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return answer;
}

export function getLightLyricVisibleWindow(
  lines: LyricLine[],
  activeIndex: number,
  before = LIGHT_LYRIC_VISIBLE_BEFORE,
  after = LIGHT_LYRIC_VISIBLE_AFTER,
): LightLyricVisibleLine[] {
  if (lines.length === 0) return [];

  const normalizedActiveIndex = activeIndex >= 0 ? activeIndex : 0;
  const start = Math.max(0, normalizedActiveIndex - before);
  const end = Math.min(lines.length, normalizedActiveIndex + after + 1);

  return lines.slice(start, end).map((line, offset) => {
    const index = start + offset;
    return {
      index,
      line,
      isActive: index === activeIndex,
    };
  });
}

export function resolveLightLyricActiveWord(
  line: LyricLine | undefined,
  currentTime: number,
): LightLyricActiveWord | null {
  if (!line?.words || line.words.length === 0) return null;

  for (let index = 0; index < line.words.length; index += 1) {
    const word = line.words[index];
    if (!hasTimedWord(word)) continue;
    if (currentTime < word.start || currentTime > word.end) continue;

    return {
      index,
      progress: clampProgress((currentTime - word.start) / (word.end - word.start)),
    };
  }

  return null;
}

export function resolveLightLyricWordFillProgress(
  line: LyricLine | undefined,
  wordIndex: number,
  currentTime: number,
): number {
  const word = line?.words?.[wordIndex];
  if (!word || !hasTimedWord(word)) return 0;
  return clampProgress((currentTime - word.start) / (word.end - word.start));
}

export function resolveLightLyricLineProgress(
  line: LyricLine | undefined,
  nextLine: LyricLine | undefined,
  currentTime: number,
): number {
  if (!line) return 0;

  const start = line.time;
  const nextStart = nextLine?.time;
  const explicitEnd = line.endTime > line.time ? line.endTime : undefined;
  const end = nextStart && nextStart > start
    ? nextStart
    : explicitEnd ?? start + DEFAULT_LINE_DURATION_SECONDS;

  if (end <= start) return currentTime >= start ? 1 : 0;
  return clampProgress((currentTime - start) / (end - start));
}

export function getLightLyricRenderableWords(line: LyricLine): LightLyricRenderableWord[] {
  return (line.words ?? [])
    .map((word, index) => ({ index, word }))
    .filter(({ word }) => word.text.length > 0);
}
