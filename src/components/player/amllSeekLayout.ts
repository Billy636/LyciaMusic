export interface AmlSeekLayoutTarget {
  resetScroll: () => void;
  setCurrentTime: (time: number, isSeek?: boolean) => void;
  update: (delta?: number) => void;
}

export function normalizeAmlTime(timeMs: number) {
  return Number.isFinite(timeMs) ? Math.max(0, Math.trunc(timeMs)) : 0;
}

export function syncAmlLyricSeekLayout(
  player: AmlSeekLayoutTarget,
  timeMs: number,
) {
  const targetTimeMs = normalizeAmlTime(timeMs);

  // AMLL owns grouping and layout. Its optimized indexes are not indexes into
  // the original lyric document, so seeking uses media time only.
  player.resetScroll();
  player.setCurrentTime(targetTimeMs, true);
  player.update(0);
}

export function getPlaybackSeekSecondsForAmlLine(lineStartTimeMs: number, audioDelaySeconds: number) {
  const lineStartTime = Number.isFinite(lineStartTimeMs) ? lineStartTimeMs : 0;
  const audioDelay = Number.isFinite(audioDelaySeconds) ? audioDelaySeconds : 0;
  return Math.max(0, lineStartTime / 1000 + audioDelay);
}
