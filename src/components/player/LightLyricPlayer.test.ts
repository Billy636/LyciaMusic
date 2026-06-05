import { describe, expect, it } from 'vitest';

import source from './LightLyricPlayer.vue?raw';
import {
  LIGHT_LYRIC_VISIBLE_AFTER,
  LIGHT_LYRIC_VISIBLE_BEFORE,
  getLightLyricVisibleWindow,
  resolveLightLyricLineProgress,
  resolveLightLyricActiveWord,
} from './lightLyricPlayerModel';
import type { LyricLine } from '../../composables/lyrics';

const lines: LyricLine[] = [
  { time: 0, endTime: 1, text: 'zero', translation: '', romaji: '' },
  { time: 1, endTime: 2, text: 'one', translation: '一', romaji: 'ichi' },
  {
    time: 2,
    endTime: 4,
    text: 'hello world',
    translation: '你好世界',
    romaji: 'hello world',
    words: [
      { text: 'hello', start: 2, end: 3 },
      { text: ' ', start: 3, end: 3 },
      { text: 'world', start: 3, end: 4 },
    ],
  },
  { time: 4, endTime: 5, text: 'three', translation: '', romaji: '' },
  { time: 5, endTime: 6, text: 'four', translation: '', romaji: '' },
  { time: 6, endTime: 7, text: 'five', translation: '', romaji: '' },
  { time: 7, endTime: 8, text: 'six', translation: '', romaji: '' },
  { time: 8, endTime: 9, text: 'seven', translation: '', romaji: '' },
];

describe('light lyric player model', () => {
  it('keeps a bounded lyric window around the active line', () => {
    expect(LIGHT_LYRIC_VISIBLE_BEFORE).toBe(3);
    expect(LIGHT_LYRIC_VISIBLE_AFTER).toBe(4);

    const visible = getLightLyricVisibleWindow(lines, 3);

    expect(visible.map(item => item.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(visible.find(item => item.index === 3)?.isActive).toBe(true);
  });

  it('marks the active word and fill progress for word-timed lyrics', () => {
    const active = resolveLightLyricActiveWord(lines[2], 3.25);

    expect(active).toEqual({ index: 2, progress: 0.25 });
  });

  it('returns no active word for line-only lyrics', () => {
    expect(resolveLightLyricActiveWord(lines[1], 1.5)).toBeNull();
  });

  it('resolves line-level progress for lyrics without word timing', () => {
    expect(resolveLightLyricLineProgress(lines[1], lines[2], 1.25)).toBe(0.25);
    expect(resolveLightLyricLineProgress(lines[1], lines[2], 2.5)).toBe(1);
  });
});

describe('LightLyricPlayer component source', () => {
  it('renders translation, romaji, and word fill layers', () => {
    expect(source).toContain('showTranslation');
    expect(source).toContain('showRomaji');
    expect(source).toContain('light-lyric-word-fill');
    expect(source).toContain('--word-progress');
  });

  it('uses a throttled animation loop for word progress only while needed', () => {
    expect(source).toContain('LIGHT_LYRIC_PROGRESS_FRAME_MS');
    expect(source).toContain('requestAnimationFrame');
    expect(source).toContain('stopProgressLoop');
  });

  it('renders the full lyric list with custom padding for 50% physical alignment', () => {
    expect(source).toContain('lyricLines');
    expect(source).toContain('lyricLineRefs');
    expect(source).toContain('v-for="(line, index) in lyricLines"');
  });

  it('clips line-level fill without changing text wrapping', () => {
    expect(source).toContain('clip-path: inset(0 calc(100% - var(--line-progress, 0%)) 0 0);');
    expect(source).not.toContain('width: var(--line-progress, 0%);');
  });

  it('clips word-level fill without changing text wrapping', () => {
    expect(source).toContain('clip-path: inset(0 calc(100% - var(--word-progress, 0%)) 0 0);');
    expect(source).not.toContain('width: var(--word-progress, 0%);');
  });
});
