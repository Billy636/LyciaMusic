import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef, watch, type EffectScope } from 'vue';

import { lyricsSettings } from '../../composables/lyrics/state';
import type { NativeAmlLyricLine } from '../../composables/lyrics/ttml';
import { useSettingsStore } from '../../features/settings/store';
import type { LyricsSettings } from '../../types';
import { useAmlDisplayLines } from './useAmlDisplayLines';

const scopes: EffectScope[] = [];

function lyric(text = '原文'): NativeAmlLyricLine {
  return {
    startTime: 1000,
    endTime: 2000,
    isBG: false,
    isDuet: false,
    translatedLyric: '译文',
    romanLyric: 'yuan wen',
    words: [{ word: text, startTime: 1000, endTime: 2000, romanWord: 'yuan wen', obscene: false }],
  };
}

function createDisplay() {
  const settings = useSettingsStore();
  const source = shallowRef([lyric()]);
  const scope = effectScope();
  scopes.push(scope);
  const displayed = scope.run(() => useAmlDisplayLines(source, () => lyricsSettings))!;
  const rendererUpdate = vi.fn();
  scope.run(() => watch(displayed, rendererUpdate, { flush: 'sync' }));
  return { source, settings, displayed, rendererUpdate };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
  setActivePinia(createPinia());
});

afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.unstubAllGlobals();
});

const appearanceChanges: Array<[string, Partial<LyricsSettings>]> = [
  ['font size', { playerFontScale: 1.5 }],
  ['line gap', { playerLineGap: 2 }],
  ['horizontal offset', { playerOffsetX: 10 }],
  ['vertical offset', { playerOffsetY: -5 }],
  ['alignment', { playerAlignment: 'right' }],
  ['font family', { playerFontPreset: 'Arial' }],
  ['render mode', { playerRenderMode: 'light' }],
];

describe('AMLL display data stability', () => {
  it.each(appearanceChanges)('does not rebuild lyric data when persisting %s', (_name, patch) => {
    const { settings, displayed, rendererUpdate } = createDisplay();
    const originalSettings = settings.settings.lyrics;
    const originalLines = displayed.value;

    settings.patchSettings({ lyrics: patch });

    // Exercise the real store replacement and settings proxy that caused the bug.
    expect(settings.settings.lyrics).not.toBe(originalSettings);
    expect(displayed.value).toBe(originalLines);
    expect(rendererUpdate).not.toHaveBeenCalled();
  });

  it('does not rebuild when root or desktop settings change', () => {
    const { settings, displayed, rendererUpdate } = createDisplay();
    const originalLines = displayed.value;

    settings.patchSettings({ lyricsSyncOffset: 0.25 });
    settings.patchSettings({ desktopLyrics: { playerFontScale: 2 } });

    expect(displayed.value).toBe(originalLines);
    expect(rendererUpdate).not.toHaveBeenCalled();
  });

  it('updates translated text only when its visibility actually changes', () => {
    const { source, settings, displayed, rendererUpdate } = createDisplay();
    const originalLines = displayed.value;
    expect(originalLines[0].translatedLyric).toBe('译文');

    settings.patchSettings({ lyrics: { showTranslation: false } });
    expect(displayed.value).not.toBe(originalLines);
    expect(displayed.value[0].translatedLyric).toBe('');
    expect(rendererUpdate).toHaveBeenCalledOnce();

    const hiddenLines = displayed.value;
    settings.patchSettings({ lyrics: { showTranslation: false } });
    expect(displayed.value).toBe(hiddenLines);
    expect(rendererUpdate).toHaveBeenCalledOnce();

    settings.patchSettings({ lyrics: { showTranslation: true } });
    expect(displayed.value[0].translatedLyric).toBe('译文');
    expect(rendererUpdate).toHaveBeenCalledTimes(2);
    expect(source.value[0].translatedLyric).toBe('译文');
  });

  it('updates line and word romanization without mutating the canonical source', () => {
    const { source, settings, displayed, rendererUpdate } = createDisplay();
    const originalLines = displayed.value;
    expect(originalLines[0].romanLyric).toBe('');
    expect(originalLines[0].words[0].romanWord).toBe('');

    settings.patchSettings({ lyrics: { showRomaji: true } });
    expect(displayed.value).not.toBe(originalLines);
    expect(displayed.value[0].romanLyric).toBe('yuan wen');
    expect(displayed.value[0].words[0].romanWord).toBe('yuan wen');
    expect(rendererUpdate).toHaveBeenCalledOnce();

    settings.patchSettings({ lyrics: { showRomaji: false } });
    expect(displayed.value[0].romanLyric).toBe('');
    expect(displayed.value[0].words[0].romanWord).toBe('');
    expect(rendererUpdate).toHaveBeenCalledTimes(2);
    expect(source.value[0].words[0].romanWord).toBe('yuan wen');
  });

  it('updates when new lyrics arrive and clears data on an empty song', () => {
    const { source, displayed, rendererUpdate } = createDisplay();
    const originalLines = displayed.value;

    source.value = [lyric('新歌')];
    expect(displayed.value).not.toBe(originalLines);
    expect(displayed.value[0].words[0].word).toBe('新歌');
    expect(displayed.value[0].sourceStartTimeMs).toBe(1000);
    expect(rendererUpdate).toHaveBeenCalledOnce();

    source.value = [];
    expect(displayed.value).toEqual([]);
    expect(rendererUpdate).toHaveBeenCalledTimes(2);
  });
});
