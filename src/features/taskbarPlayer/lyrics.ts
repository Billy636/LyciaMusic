import type { LyricLine, LyricWord } from '../../composables/lyrics/types';

interface TaskbarPlaybackClockPayload {
  playbackTime: number;
  syncedAt: number;
  isPlaying: boolean;
}

/** Select a single foreground line without changing the shared lyric document. */
export function resolveTaskbarLyricLine(lines: LyricLine[], time: number): LyricLine | null {
  const timedLines = lines.filter((line) => Number.isFinite(line.time));
  const foregroundLines = timedLines.filter((line) => !line.isBG);
  const candidates = foregroundLines.length > 0 ? foregroundLines : timedLines;
  const targetTime = Number.isFinite(time) ? time : 0;
  let activeLine: LyricLine | null = null;
  let firstMeaningfulLine: LyricLine | null = null;

  for (const line of candidates) {
    if (line.text.trim() && (!firstMeaningfulLine || line.time < firstMeaningfulLine.time)) {
      firstMeaningfulLine = line;
    }
    if (line.time <= targetTime && (!activeLine || line.time >= activeLine.time)) {
      activeLine = line;
    }
  }

  // A timed blank is an intentional interlude, not permission to keep the old line.
  if (activeLine) return activeLine.text.trim() ? activeLine : null;
  return firstMeaningfulLine;
}

/** Actual word timing is optional: ordinary LRC lines remain plain text. */
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
