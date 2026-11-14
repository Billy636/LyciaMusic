import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import type { Song } from '../../types';
import { applyNativeAmlDisplaySettings } from './ttml';
import { loadLyrics, lyricsSource, lyricsStatus, nativeAmlLyrics, parsedLyrics } from './state';

const fixture = [
  '[00:01.000]te su to no ka shi',
  '[00:01.000]テストの歌詞',
  '[00:01.000]这是测试歌词',
  '[00:05.000]Hello sample',
  '[00:05.000]英文夹句的翻译',
  '[00:09.000]只有一行的正文',
].join('\n');
const sampleSong: Song = {
  path: '/reading-order.wav', name: 'reading-order.wav', title: 'Reading order',
  artist: 'Test', album: 'Test', duration: 12,
  artist_names: ['Test'], effective_artist_names: ['Test'], album_artist: 'Test',
  album_key: 'test', is_various_artists_album: false, collapse_artist_credits: false,
};

describe('reading order through the real load/parse/display pipeline', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    await loadLyrics();
    usePlaybackStore().currentSong = sampleSong;
    invokeMock.mockResolvedValue({ rawLyrics: fixture, sourceFormat: 'lrc', sourcePath: '/reading-order.lrc' });
  });

  it('groups three-line Japanese, two-line English and a single-line cue together', async () => {
    useSettingsStore().patchSettings({ lyrics: { readingOrder: 'roman-main-translation' } });
    await loadLyrics();
    expect(lyricsStatus.value).toBe('ready');
    expect(parsedLyrics.value.map(item => [item.text, item.translation, item.romaji])).toEqual([
      ['テストの歌詞', '这是测试歌词', 'te su to no ka shi'],
      ['Hello sample', '英文夹句的翻译', ''],
      ['只有一行的正文', '', ''],
    ]);
    // Plain LRC is non-dynamic in core: full-line romaji must be in romanLyric,
    // not only a word-level field which that rendering mode does not display.
    const displayed = applyNativeAmlDisplaySettings(nativeAmlLyrics.value, true, true);
    expect(displayed[0].romanLyric).toBe('te su to no ka shi');
    expect(displayed[0].translatedLyric).toBe('这是测试歌词');
    expect(displayed[0].words.map(word => word.word).join('')).toBe('テストの歌詞');
    expect(lyricsSource.value?.rawLyrics).toBe(fixture);
  });

  it('applies the selected two-line relative order immediately without another IPC read', async () => {
    const settings = useSettingsStore();
    settings.patchSettings({ lyrics: { readingOrder: 'roman-main-translation' } });
    await loadLyrics();
    settings.patchSettings({ lyrics: {
      readingOrderOverrides: { [sampleSong.path]: 'translation-main-roman' },
    } });
    await vi.waitFor(() => expect(parsedLyrics.value[1]?.text).toBe('英文夹句的翻译'));
    expect(parsedLyrics.value[1].translation).toBe('Hello sample');
    expect(parsedLyrics.value[1].romaji).toBe('');
    expect(parsedLyrics.value[0].text).toBe('テストの歌詞');
    expect(parsedLyrics.value[0].translation).toBe('te su to no ka shi');
    expect(parsedLyrics.value[0].romaji).toBe('这是测试歌词');
    expect(parsedLyrics.value[2].text).toBe('只有一行的正文');
    expect(invokeMock).toHaveBeenCalledTimes(1);

    settings.patchSettings({ lyrics: { readingOrderOverrides: {} } });
    await vi.waitFor(() => expect(parsedLyrics.value[1]?.text).toBe('Hello sample'));
    expect(parsedLyrics.value[0].translation).toBe('这是测试歌词');
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
