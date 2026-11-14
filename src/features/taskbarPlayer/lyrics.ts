import type { LyricLine, LyricWord } from '../../composables/lyrics/types';
import { findDisplayLyricIndex, foregroundLyricLines } from '../../composables/lyrics/selection';

interface TaskbarPlaybackClockPayload {
  playbackTime: number;
  syncedAt: number;
  isPlaying: boolean;
}

/** Select a single foreground line without changing the shared lyric document. */
export function resolveTaskbarLyricLine(lines: LyricLine[], time: number): LyricLine | null {
  const line = lines[findDisplayLyricIndex(lines, time, true)];
  return line?.text.trim() ? line : null;
}

/** Preview the next foreground cue while explicit blank cues still clear both rows. */
export function resolveTaskbarDoubleLyricLines(lines: LyricLine[], time: number): LyricLine[] {
  const current = resolveTaskbarLyricLine(lines, time);
  if (!current) return [];

  const after = Math.max(current.time, Number.isFinite(time) ? time : 0);
  let next: LyricLine | undefined;
  for (const line of foregroundLyricLines(lines)) {
    if (!line.text.trim() || line.time <= after) continue;
    // Match the shared selector's last meaningful voice at the same timestamp.
    if (!next || line.time <= next.time) next = line;
  }
  return next ? [current, next] : [current];
}

/** Resolve a source-timed rest without guessing where an inferred LRC phrase ends. */
export function resolveTaskbarLyricInterlude(
  lines: LyricLine[],
  time: number,
): { start: number; end: number } | null {
  const target = Number.isFinite(time) ? time : 0;
  const cues = foregroundLyricLines(lines).sort((left, right) => left.time - right.time);
  let occupiedEnd = 0;

  for (let index = 0; index < cues.length;) {
    const start = Math.max(0, cues[index].time);
    let groupEnd = index + 1;
    while (groupEnd < cues.length && cues[groupEnd].time === cues[index].time) groupEnd++;
    const group = cues.slice(index, groupEnd);
    // A clear ends earlier voices, but never a meaningful row at this same cue.
    // Repeated clears cannot move an already established rest's beginning.
    if (group.some(line => !line.text.trim())) occupiedEnd = Math.min(occupiedEnd, start);
    const vocals = group.filter(line => line.text.trim());

    if (vocals.length && start > target) {
      return start - occupiedEnd >= 6 && target >= occupiedEnd
        ? { start: occupiedEnd, end: start } : null;
    }
    for (const line of vocals) {
      const end = (line.words ?? []).reduce((latest, word) =>
        Number.isFinite(word.end) ? Math.max(latest, word.end) : latest,
      Number.isFinite(line.endTime) ? Math.max(start, line.endTime) : start);
      occupiedEnd = Math.max(occupiedEnd, end);
    }
    index = groupEnd;
  }
  return null;
}

const MAX_ESTIMATED_LINE_DURATION = 15;
const MAX_ESTIMATED_WORD_DURATION = 4;

function timingText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
}

function textLength(text: string): number {
  return Math.max(1, Array.from(timingText(text)).length);
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function estimateFinalLineDuration(line: LyricLine, previous: LyricLine[]): number {
  // A repeated chorus is a better reference than the remaining track length.
  const repeated = previous.filter(candidate => timingText(candidate.text) === timingText(line.text));
  const repeatedDuration = median(repeated.map(candidate => candidate.endTime - candidate.time)
    .filter((duration, index) => Number.isFinite(duration) && duration > 0
      && (!repeated[index].endTimeInferred || duration <= MAX_ESTIMATED_LINE_DURATION)));
  if (repeatedDuration !== undefined) return repeatedDuration;

  // Nearby phrase rates adapt to the song; long instrumental gaps are excluded.
  const rates = previous.filter(candidate => {
    const duration = candidate.endTime - candidate.time;
    return Number.isFinite(duration) && duration >= 0.5 && duration <= MAX_ESTIMATED_LINE_DURATION;
  }).slice(-8).map(candidate => (candidate.endTime - candidate.time) / textLength(candidate.text));
  const estimated = (median(rates) ?? 0.35) * textLength(line.text);
  return Math.max(1.5, Math.min(MAX_ESTIMATED_LINE_DURATION, estimated));
}

function estimateFinalWordDuration(line: LyricLine, previous: LyricLine[]): number {
  const words = line.words ?? [];
  const lastWord = words[words.length - 1];
  if (!lastWord) return 1;

  const repeated = previous.filter(candidate => timingText(candidate.text) === timingText(line.text));
  const repeatedDuration = median(repeated.flatMap(candidate => {
    const word = candidate.words?.[candidate.words.length - 1];
    if (!word || timingText(word.text) !== timingText(lastWord.text)) return [];
    const duration = word.end - word.start;
    return Number.isFinite(duration) && duration > 0
      && (!candidate.endTimeInferred || duration <= MAX_ESTIMATED_WORD_DURATION) ? [duration] : [];
  }));
  if (repeatedDuration !== undefined) return repeatedDuration;

  // Enhanced LRC already times the preceding words: estimate only the missing tail.
  const rates = words.slice(0, -1).filter(word => {
    const duration = word.end - word.start;
    return word.text.trim() && Number.isFinite(duration) && duration > 0 && duration <= MAX_ESTIMATED_WORD_DURATION;
  }).slice(-8).map(word => (word.end - word.start) / textLength(word.text));
  const rate = median(rates);
  const estimated = rate === undefined ? 1 : rate * textLength(lastWord.text);
  return Math.max(0.2, Math.min(MAX_ESTIMATED_WORD_DURATION, estimated));
}

/** Shorten only the taskbar's inferred final highlight; keep source timing intact. */
export function createTaskbarLyricDisplayLines(lines: LyricLine[]): LyricLine[] {
  const foreground = foregroundLyricLines(lines).filter(line => line.text.trim())
    .sort((left, right) => left.time - right.time);
  const finalTime = foreground[foreground.length - 1]?.time;
  const finalLines = new Set(foreground.filter(line => line.time === finalTime));

  return lines.map(line => {
    if (!finalLines.has(line) || !line.endTimeInferred || !Number.isFinite(line.endTime)) return line;
    const previous = foreground.filter(candidate => candidate.time < line.time
      && Boolean(candidate.isDuet) === Boolean(line.isDuet));
    const words = line.words ?? [];
    const lastWord = words[words.length - 1];
    const start = line.endTimeInferred === 'word' ? lastWord?.start : line.time;
    if (start === undefined || !Number.isFinite(start)) return line;
    const duration = line.endTimeInferred === 'word'
      ? estimateFinalWordDuration(line, previous) : estimateFinalLineDuration(line, previous);
    const end = Math.min(line.endTime, start + duration);
    if (end <= start || (lastWord && (!Number.isFinite(lastWord.end) || end >= lastWord.end))) return line;

    const displayWords = words.map((word, index) => index === words.length - 1 ? { ...word, end } : word);
    return {
      ...line,
      endTime: displayWords.reduce((latest, word) => Math.max(latest, word.end), end),
      ...(lastWord ? { words: displayWords } : {}),
    };
  });
}

/** Whole-line LRC words use display estimates; explicit word timing is retained. */
export function getTaskbarLyricWordProgress(word: LyricWord, time: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(word.start) || !Number.isFinite(word.end)) {
    return 0;
  }
  if (time < word.start) return 0;
  if (word.end <= word.start || time >= word.end) return 1;

  const progress = (time - word.start) / (word.end - word.start);
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
}

/** Retain the sample's age when the hidden main window sends an unchanged time. */
export function createTaskbarPlaybackClockTracker(now = () => Date.now()) {
  let sampledPlaybackTime: number | null = null;
  const initialTimestamp = now();
  let sampledAt = Number.isFinite(initialTimestamp) ? initialTimestamp : 0;

  const markPlaybackTimeSample = (playbackTime: number) => {
    if (!Number.isFinite(playbackTime)) return;

    sampledPlaybackTime = Math.max(0, playbackTime);
    const timestamp = now();
    if (Number.isFinite(timestamp)) sampledAt = timestamp;
  };

  const resolveSyncedAt = (playbackTime: number) => {
    if (
      Number.isFinite(playbackTime)
      && (sampledPlaybackTime === null || Math.abs(Math.max(0, playbackTime) - sampledPlaybackTime) > 0.000_001)
    ) {
      markPlaybackTimeSample(playbackTime);
    }

    return sampledAt;
  };

  return { markPlaybackTimeSample, resolveSyncedAt };
}

/** Project an absolute sample so seeks work in both directions and pauses stop. */
export function projectTaskbarPlaybackTime(
  payload: TaskbarPlaybackClockPayload,
  now = Date.now(),
): number {
  if (!Number.isFinite(payload.playbackTime)) return 0;
  const playbackTime = Math.max(0, payload.playbackTime);
  if (!payload.isPlaying || !Number.isFinite(payload.syncedAt) || !Number.isFinite(now)) {
    return playbackTime;
  }

  const elapsed = Math.max(0, (now - payload.syncedAt) / 1000);
  const projectedTime = playbackTime + elapsed;
  return Number.isFinite(projectedTime) ? projectedTime : playbackTime;
}
