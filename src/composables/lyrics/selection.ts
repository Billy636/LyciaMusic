import type { LyricLine } from './types';

/** Compact displays use the foreground; a background-only document still works. */
export function foregroundLyricLines(lines: readonly LyricLine[]): LyricLine[] {
  const timed = lines.filter((line) => Number.isFinite(line.time));
  return timed.some((line) => !line.isBG && line.text.trim())
    ? timed.filter((line) => !line.isBG)
    : timed;
}

/** Hold the last phrase until another cue, including an explicit timed blank. */
export function findDisplayLyricIndex(
  lines: readonly LyricLine[],
  time: number,
  previewBeforeFirst = false,
): number {
  const candidates = foregroundLyricLines(lines);
  const target = Number.isFinite(time) ? time : 0;
  let latest: LyricLine | undefined;
  let singing: LyricLine | undefined;
  let first: LyricLine | undefined;
  let blankTime = Number.NEGATIVE_INFINITY;

  for (const line of candidates) {
    const meaningful = Boolean(line.text.trim());
    if (meaningful && (!first || line.time < first.time)) first = line;
    if (line.time > target) continue;
    if (!meaningful) blankTime = Math.max(blankTime, line.time);
    if (!latest || line.time > latest.time || (
      line.time === latest.time && (meaningful || !latest.text.trim())
    )) latest = line;
    if (meaningful && Number.isFinite(line.endTime) && line.endTime > target
      && (!singing || line.time >= singing.time)) singing = line;
  }

  // A later blank ends the phrase, but a same-time empty/background row must not
  // erase an ongoing foreground voice. Expired voices do not replace a longer overlap.
  if (singing && singing.time >= blankTime) return lines.indexOf(singing);
  if (latest) return lines.indexOf(latest);
  return previewBeforeFirst && first ? lines.indexOf(first) : -1;
}
