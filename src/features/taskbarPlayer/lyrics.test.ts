import { describe, expect, it } from 'vitest';

import type { LyricLine, LyricWord } from '../../composables/lyrics/types';
import {
  createTaskbarPlaybackClockTracker,
  getTaskbarLyricWordProgress,
  projectTaskbarPlaybackTime,
  resolveTaskbarLyricLine,
} from './lyrics';

function line(time: number, text: string, extra: Partial<LyricLine> = {}): LyricLine {
  return { time, endTime: time + 4, text, translation: '', romaji: '', ...extra };
}

describe('resolveTaskbarLyricLine', () => {
  it('previews the first foreground line, switches at its exact start, and holds the last line', () => {
    const lines = [line(2, 'first'), line(6, 'second')];

    expect(resolveTaskbarLyricLine(lines, 0)).toBe(lines[0]);
    expect(resolveTaskbarLyricLine(lines, 2)).toBe(lines[0]);
    expect(resolveTaskbarLyricLine(lines, 5.999)).toBe(lines[0]);
    expect(resolveTaskbarLyricLine(lines, 6)).toBe(lines[1]);
    expect(resolveTaskbarLyricLine(lines, 100)).toBe(lines[1]);
  });

  it('clears an ended phrase at a timed blank instead of keeping its old text', () => {
    const lines = [line(1, 'phrase'), line(4, ' \t '), line(8, 'next')];

    expect(resolveTaskbarLyricLine(lines, 3.9)).toBe(lines[0]);
    expect(resolveTaskbarLyricLine(lines, 4)).toBeNull();
    expect(resolveTaskbarLyricLine(lines, 7)).toBeNull();
    expect(resolveTaskbarLyricLine(lines, 8)).toBe(lines[2]);
  });

  it('previews the first meaningful line when the document starts with a future blank', () => {
    const lines = [line(2, ''), line(4, 'first phrase')];

    expect(resolveTaskbarLyricLine(lines, 0)).toBe(lines[1]);
    expect(resolveTaskbarLyricLine(lines, 2)).toBeNull();
  });

  it('does not let a later background vocal replace the foreground or its preview', () => {
    const lines = [
      line(1, 'background introduction', { isBG: true }),
      line(3, 'foreground'),
      line(3.5, 'overlapping background', { isBG: true }),
      line(6, 'next foreground'),
    ];

    expect(resolveTaskbarLyricLine(lines, 0)).toBe(lines[1]);
    expect(resolveTaskbarLyricLine(lines, 2)).toBe(lines[1]);
    expect(resolveTaskbarLyricLine(lines, 4)).toBe(lines[1]);
    expect(resolveTaskbarLyricLine(lines, 6)).toBe(lines[3]);
  });

  it('uses background lines when the document has no foreground', () => {
    const lines = [line(1, 'background', { isBG: true }), line(4, 'next', { isBG: true })];

    expect(resolveTaskbarLyricLine(lines, 0)).toBe(lines[0]);
    expect(resolveTaskbarLyricLine(lines, 4)).toBe(lines[1]);
  });

  it('preserves plain LRC text, emoji, combining characters and source order without synthesizing words', () => {
    const lastLine = line(8, '在山的另一头呼喊 👩🏽‍🎤 café e\u0301');
    const firstLine = line(2, 'first');
    const lines = [lastLine, firstLine];
    const original = JSON.stringify(lines);

    Object.freeze(lastLine);
    Object.freeze(firstLine);
    Object.freeze(lines);

    expect(resolveTaskbarLyricLine(lines, 0)).toBe(firstLine);
    expect(resolveTaskbarLyricLine(lines, 8)).toBe(lastLine);
    expect(lastLine.words).toBeUndefined();
    expect(JSON.stringify(lines)).toBe(original);
  });

  it('ignores malformed line timestamps and treats malformed playback time as the start', () => {
    const valid = line(3, 'valid');
    const lines = [line(Number.NaN, 'invalid'), valid, line(Number.POSITIVE_INFINITY, 'invalid')];

    expect(resolveTaskbarLyricLine(lines, 4)).toBe(valid);
    expect(resolveTaskbarLyricLine(lines, Number.NaN)).toBe(valid);
    expect(resolveTaskbarLyricLine(lines, Number.POSITIVE_INFINITY)).toBe(valid);
    expect(resolveTaskbarLyricLine([line(Number.NaN, 'invalid')], 4)).toBeNull();
    expect(resolveTaskbarLyricLine([], 4)).toBeNull();
    expect(resolveTaskbarLyricLine([line(2, '')], 0)).toBeNull();
  });
});

describe('getTaskbarLyricWordProgress', () => {
  const word: LyricWord = { text: '歌词', start: 2, end: 4 };

  it.each([
    [0, 0], [2, 0], [2.5, 0.25], [3, 0.5], [4, 1], [10, 1],
  ])('returns %s seconds at progress %s', (time, progress) => {
    expect(getTaskbarLyricWordProgress(word, time)).toBe(progress);
  });

  it('uses an instantaneous step for a zero-duration or reversed-duration word', () => {
    for (const end of [2, 1]) {
      expect(getTaskbarLyricWordProgress({ ...word, end }, 1.9)).toBe(0);
      expect(getTaskbarLyricWordProgress({ ...word, end }, 2)).toBe(1);
    }
  });

  it('never returns NaN or infinity for malformed word or playback timestamps', () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(getTaskbarLyricWordProgress({ ...word, start: invalid }, 3)).toBe(0);
      expect(getTaskbarLyricWordProgress({ ...word, end: invalid }, 3)).toBe(0);
      expect(getTaskbarLyricWordProgress(word, invalid)).toBe(0);
    }
    const overflowWord = { ...word, start: -Number.MAX_VALUE, end: Number.MAX_VALUE };
    expect(Number.isFinite(getTaskbarLyricWordProgress(overflowWord, Number.MAX_VALUE / 2))).toBe(true);
  });
});

describe('taskbar playback clock', () => {
  it('keeps the actual sample timestamp for repeated sends from a hidden main window', () => {
    let now = 1000;
    const tracker = createTaskbarPlaybackClockTracker(() => now);
    tracker.markPlaybackTimeSample(11.35);
    now += 650;

    expect(tracker.resolveSyncedAt(11.35)).toBe(1000);
    expect(projectTaskbarPlaybackTime({
      playbackTime: 11.35,
      syncedAt: tracker.resolveSyncedAt(11.35),
      isPlaying: true,
    }, now)).toBe(12);
    expect(tracker.resolveSyncedAt(12)).toBe(1650);
  });

  it('reanchors changed samples and both directions of seeking', () => {
    let now = 1000;
    const tracker = createTaskbarPlaybackClockTracker(() => now);
    expect(tracker.resolveSyncedAt(10)).toBe(1000);

    now = 2000;
    expect(tracker.resolveSyncedAt(30)).toBe(2000);
    expect(projectTaskbarPlaybackTime({ playbackTime: 30, syncedAt: 2000, isPlaying: true }, 2500)).toBe(30.5);
    now = 3000;
    expect(tracker.resolveSyncedAt(5)).toBe(3000);
    expect(projectTaskbarPlaybackTime({ playbackTime: 5, syncedAt: 3000, isPlaying: true }, 3500)).toBe(5.5);
  });

  it('freezes while paused and supports explicitly reanchoring the same sample on resume', () => {
    let now = 1000;
    const tracker = createTaskbarPlaybackClockTracker(() => now);
    tracker.markPlaybackTimeSample(12);
    now = 61000;

    expect(projectTaskbarPlaybackTime({ playbackTime: 12, syncedAt: 1000, isPlaying: false }, now)).toBe(12);
    tracker.markPlaybackTimeSample(12);
    expect(tracker.resolveSyncedAt(12)).toBe(61000);
    expect(projectTaskbarPlaybackTime({ playbackTime: 12, syncedAt: 61000, isPlaying: true }, 61500)).toBe(12.5);
  });

  it('ignores invalid samples and does not refresh a clamped negative sample on every send', () => {
    let now = 1000;
    const tracker = createTaskbarPlaybackClockTracker(() => now);
    tracker.markPlaybackTimeSample(12);
    now = 2000;
    tracker.markPlaybackTimeSample(Number.NaN);

    expect(tracker.resolveSyncedAt(Number.NaN)).toBe(1000);
    expect(tracker.resolveSyncedAt(Number.POSITIVE_INFINITY)).toBe(1000);
    expect(tracker.resolveSyncedAt(12)).toBe(1000);
    expect(tracker.resolveSyncedAt(-3)).toBe(2000);
    now = 3000;
    expect(tracker.resolveSyncedAt(-3)).toBe(2000);
  });

  it('guards invalid timestamps and future sample times without producing negative playback', () => {
    const payload = { playbackTime: 12, syncedAt: 1000, isPlaying: true };

    expect(projectTaskbarPlaybackTime(payload, 500)).toBe(12);
    expect(projectTaskbarPlaybackTime({ ...payload, playbackTime: -2 }, 1000)).toBe(0);
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(projectTaskbarPlaybackTime({ ...payload, playbackTime: invalid }, 2000)).toBe(0);
      expect(projectTaskbarPlaybackTime({ ...payload, syncedAt: invalid }, 2000)).toBe(12);
      expect(projectTaskbarPlaybackTime(payload, invalid)).toBe(12);
    }
    expect(createTaskbarPlaybackClockTracker(() => Number.NaN).resolveSyncedAt(1)).toBe(0);
  });
});
