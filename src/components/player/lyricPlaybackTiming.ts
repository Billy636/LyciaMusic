interface SourceTimedLyricLine {
  startTime: number;
  sourceStartTimeMs?: number;
}

/** AMLL may advance its display start for scrolling; clicks must use source timing. */
export function getAmlLineSourceStartTime(line: SourceTimedLyricLine): number {
  const sourceTime = line.sourceStartTimeMs;
  if (typeof sourceTime === 'number' && Number.isFinite(sourceTime) && sourceTime >= 0) {
    return sourceTime;
  }
  return Number.isFinite(line.startTime) ? Math.max(0, line.startTime) : 0;
}
