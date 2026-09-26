import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

const { invokeMock, parseMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  parseMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('./officialParser', () => ({ parseOfficialLyrics: parseMock }));

import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import { DEFAULT_LYRICS_READING_ORDER } from './readingOrder';
import type { Song } from '../../types';
import type { NativeAmlLyricLine } from './ttml';
import {
  activeLyricsFormat, currentLyricLine, loadLyrics, lyricsIssues,
  lyricsSource, lyricsStatus, nativeAmlLyrics, parsedLyrics,
} from './state';

const song = (path = '/music/song.flac'): Song => ({
  path, name: 'song.flac', title: 'Song', artist: 'Artist', album: 'Album', duration: 120,
  artist_names: ['Artist'], effective_artist_names: ['Artist'], album_artist: 'Artist',
  album_key: 'album', is_various_artists_album: false, collapse_artist_credits: false,
});
const line = (text: string, startTime = 1000): NativeAmlLyricLine => ({
  startTime, endTime: startTime + 2500, translatedLyric: '', romanLyric: '',
  isBG: false, isDuet: false,
  words: [{ word: text, startTime, endTime: startTime + 1000 }],
});

async function flushReadingOrderChange() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe('official lyrics loading', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    parseMock.mockReset();
    await loadLyrics();
  });

  it('loads raw source once and produces every view from the same official parse', async () => {
    usePlaybackStore().currentSong = song();
    const source = { rawLyrics: '[00:01.000]hello', sourceFormat: 'lrc', sourcePath: '/music/song.lrc' };
    invokeMock.mockResolvedValue(source);
    const lines = [line('hello')];
    parseMock.mockResolvedValue({ lines, format: 'lrc', issues: ['diagnostic'] });
    await loadLyrics();

    expect(invokeMock).toHaveBeenCalledExactlyOnceWith('get_song_lyrics_source', { path: song().path });
    expect(parseMock).toHaveBeenCalledExactlyOnceWith(source.rawLyrics, {
      format: 'lrc', durationMs: 120000, readingOrder: DEFAULT_LYRICS_READING_ORDER,
    });
    expect(nativeAmlLyrics.value).toEqual(lines);
    expect(parsedLyrics.value[0]).toMatchObject({ time: 1, endTime: 3.5, text: 'hello' });
    expect(activeLyricsFormat.value).toBe('lrc');
    expect(lyricsIssues.value).toEqual(['diagnostic']);
    expect(lyricsSource.value).toEqual(source);
    expect(lyricsStatus.value).toBe('ready');
  });

  it('sorts the legacy projection without disturbing main/background group order', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: '<tt/>', sourceFormat: 'ttml', sourcePath: null });
    const lines = [line('main', 1000), { ...line('background', 3000), isBG: true }, line('next', 2000)];
    parseMock.mockResolvedValue({ lines, format: 'ttml', issues: [] });
    await loadLyrics();
    expect(nativeAmlLyrics.value.map((item) => item.startTime)).toEqual([1000, 3000, 2000]);
    expect(parsedLyrics.value.map((item) => item.time)).toEqual([1, 2, 3]);
  });

  it('ignores a source returned after the user has changed songs', async () => {
    const playback = usePlaybackStore();
    playback.currentSong = song('/first.flac');
    let resolveFirst!: (value: unknown) => void;
    invokeMock.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    const first = loadLyrics();
    playback.currentSong = song('/second.flac');
    invokeMock.mockResolvedValueOnce({ rawLyrics: 'second', sourceFormat: 'lrc', sourcePath: null });
    parseMock.mockResolvedValueOnce({ lines: [line('second')], format: 'lrc', issues: [] });
    await loadLyrics();
    resolveFirst({ rawLyrics: 'first', sourceFormat: 'lrc', sourcePath: null });
    await first;
    expect(parseMock).toHaveBeenCalledTimes(1);
    expect(parsedLyrics.value[0].text).toBe('second');
  });

  it('ignores a parse finishing after another request, including the same song', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: 'raw', sourceFormat: null, sourcePath: null });
    let resolveFirst!: (value: unknown) => void;
    parseMock.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    const first = loadLyrics();
    await Promise.resolve();
    parseMock.mockResolvedValueOnce({ lines: [line('new')], format: 'lrc', issues: [] });
    await loadLyrics();
    resolveFirst({ lines: [line('old')], format: 'lrc', issues: [] });
    await first;
    expect(parsedLyrics.value[0].text).toBe('new');
  });

  it('uses the underlying audio path for CUE lyrics', async () => {
    usePlaybackStore().currentSong = { ...song('/album.cue::track01'), cue_source_path: '/album.flac' };
    invokeMock.mockResolvedValue({ rawLyrics: '', sourceFormat: null, sourcePath: null });
    parseMock.mockResolvedValue({ lines: [], format: 'unknown', issues: [] });
    await loadLyrics();
    expect(invokeMock).toHaveBeenCalledWith('get_song_lyrics_source', { path: '/album.flac' });
  });

  it('retains unsynchronized original text without manufacturing timestamps', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: 'plain text', sourceFormat: 'txt', sourcePath: '/song.txt' });
    parseMock.mockResolvedValue({ lines: [], format: 'unknown', issues: ['No timestamps'] });
    await loadLyrics();
    expect(lyricsStatus.value).toBe('empty');
    expect(lyricsSource.value?.rawLyrics).toBe('plain text');
    expect(currentLyricLine.value.text).toBe('No synchronized lyrics');
  });

  it('preserves source and diagnostics when parsing fails', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: 'invalid', sourceFormat: 'ttml', sourcePath: null });
    parseMock.mockRejectedValue(new Error('Invalid TTML'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await loadLyrics();
      expect(lyricsStatus.value).toBe('error');
      expect(lyricsSource.value?.rawLyrics).toBe('invalid');
      expect(lyricsIssues.value).toEqual(['Invalid TTML']);
      expect(nativeAmlLyrics.value).toEqual([]);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('shows a structured parser failure instead of treating it as missing lyrics', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: '<invalid>', sourceFormat: 'ttml', sourcePath: null });
    parseMock.mockResolvedValue({ lines: [], format: 'ttml', issues: ['Invalid TTML'], error: 'Invalid TTML' });
    await loadLyrics();
    expect(lyricsStatus.value).toBe('error');
    expect(currentLyricLine.value.text).toBe('Lyrics unavailable');
    expect(lyricsSource.value?.rawLyrics).toBe('<invalid>');
  });

  it('does not present a document containing only timed blanks as usable lyrics', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: '[00:01]', sourceFormat: 'lrc', sourcePath: null });
    parseMock.mockResolvedValue({ lines: [line('')], format: 'lrc', issues: [] });
    await loadLyrics();
    expect(lyricsStatus.value).toBe('empty');
    expect(currentLyricLine.value.text).toBe('No synchronized lyrics');
  });

  it('clears the document without making a request when playback has no song', async () => {
    nativeAmlLyrics.value = [line('old')];
    await loadLyrics();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(lyricsStatus.value).toBe('idle');
    expect(parsedLyrics.value).toEqual([]);
    expect(lyricsSource.value).toBeNull();
  });

  it('keeps the foreground lyric in the mini/shared display when background enters later', async () => {
    const playback = usePlaybackStore();
    playback.currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: '<tt/>', sourceFormat: 'ttml', sourcePath: null });
    parseMock.mockResolvedValue({
      lines: [line('main', 1000), { ...line('background', 1500), isBG: true }],
      format: 'ttml', issues: [],
    });
    await loadLyrics();
    playback.currentTime = 2;
    expect(currentLyricLine.value.text).toBe('main');
    playback.currentTime = 0;
    expect(currentLyricLine.value.text).toBe('main');
  });

  it('keeps explicit interlude clearing while retaining the established hold-last policy', async () => {
    const playback = usePlaybackStore();
    playback.currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: 'fixture', sourceFormat: 'lrc', sourcePath: null });
    parseMock.mockResolvedValue({
      lines: [line('first', 1000), line('', 3000), line('last', 5000)],
      format: 'lrc', issues: [],
    });
    await loadLyrics();
    playback.currentTime = 4;
    expect(currentLyricLine.value.text).toBe('');
    playback.currentTime = 100;
    expect(currentLyricLine.value.text).toBe('last');
  });

  it('uses the saved single-song order instead of the default on initial load', async () => {
    const playback = usePlaybackStore();
    playback.currentSong = song();
    useSettingsStore().patchSettings({ lyrics: {
      readingOrder: 'main-translation-roman',
      readingOrderOverrides: { [song().path]: 'roman-main-translation' },
    } });
    invokeMock.mockResolvedValue({ rawLyrics: 'raw', sourceFormat: 'lrc', sourcePath: null });
    parseMock.mockResolvedValue({ lines: [line('main')], format: 'lrc', issues: [] });
    await loadLyrics();
    expect(parseMock.mock.calls[0][1].readingOrder).toBe('roman-main-translation');
  });

  it('reparses the cached source immediately without rereading the file or seeking audio', async () => {
    const playback = usePlaybackStore();
    playback.currentSong = song();
    playback.currentTime = 45;
    invokeMock.mockResolvedValue({ rawLyrics: 'original raw', sourceFormat: 'lrc', sourcePath: '/source.lrc' });
    parseMock.mockResolvedValueOnce({ lines: [line('before')], format: 'lrc', issues: [] });
    await loadLyrics();
    const seekRevision = playback.seekRevision;
    parseMock.mockResolvedValueOnce({ lines: [line('after')], format: 'lrc', issues: [] });
    useSettingsStore().patchSettings({ lyrics: { readingOrder: 'translation-main-roman' } });
    await flushReadingOrderChange();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(parseMock).toHaveBeenCalledTimes(2);
    expect(parseMock.mock.calls[1]).toEqual(['original raw', {
      format: 'lrc', durationMs: 120000, readingOrder: 'translation-main-roman',
    }]);
    expect(parsedLyrics.value[0].text).toBe('after');
    expect(playback.currentTime).toBe(45);
    expect(playback.seekRevision).toBe(seekRevision);
    expect(lyricsSource.value?.rawLyrics).toBe('original raw');
  });

  it('does not reparse for unrelated appearance settings or another song override', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: 'raw', sourceFormat: 'lrc', sourcePath: null });
    parseMock.mockResolvedValue({ lines: [line('same')], format: 'lrc', issues: [] });
    await loadLyrics();
    const original = nativeAmlLyrics.value;
    useSettingsStore().patchSettings({ lyrics: {
      playerFontScale: 2,
      playerLineGap: 1.5,
      readingOrderOverrides: { '/other.flac': 'translation-roman-main' },
    } });
    await flushReadingOrderChange();
    expect(parseMock).toHaveBeenCalledTimes(1);
    expect(nativeAmlLyrics.value).toBe(original);
  });

  it('keeps an override pinned until it is cleared, then applies the latest default', async () => {
    usePlaybackStore().currentSong = song();
    const settings = useSettingsStore();
    settings.patchSettings({ lyrics: { readingOrderOverrides: { [song().path]: 'roman-main-translation' } } });
    invokeMock.mockResolvedValue({ rawLyrics: 'raw', sourceFormat: 'lrc', sourcePath: null });
    parseMock.mockResolvedValue({ lines: [line('main')], format: 'lrc', issues: [] });
    await loadLyrics();
    settings.patchSettings({ lyrics: { readingOrder: 'translation-main-roman' } });
    await flushReadingOrderChange();
    expect(parseMock).toHaveBeenCalledTimes(1);
    settings.patchSettings({ lyrics: { readingOrderOverrides: {} } });
    await flushReadingOrderChange();
    expect(parseMock).toHaveBeenCalledTimes(2);
    expect(parseMock.mock.calls[1][1].readingOrder).toBe('translation-main-roman');
  });

  it('ignores an older reparse after rapidly changing order', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: 'raw', sourceFormat: 'lrc', sourcePath: null });
    parseMock.mockResolvedValueOnce({ lines: [line('initial')], format: 'lrc', issues: [] });
    await loadLyrics();
    let resolveOlder!: (value: unknown) => void;
    parseMock.mockReturnValueOnce(new Promise(resolve => { resolveOlder = resolve; }));
    const settings = useSettingsStore();
    settings.patchSettings({ lyrics: { readingOrder: 'translation-main-roman' } });
    await flushReadingOrderChange();
    // The previous view remains usable while a replacement is being parsed.
    expect(lyricsStatus.value).toBe('ready');
    expect(parsedLyrics.value[0].text).toBe('initial');
    parseMock.mockResolvedValueOnce({ lines: [line('newest')], format: 'lrc', issues: [] });
    settings.patchSettings({ lyrics: { readingOrder: 'roman-main-translation' } });
    await flushReadingOrderChange();
    resolveOlder({ lines: [line('stale')], format: 'lrc', issues: [] });
    await flushReadingOrderChange();
    expect(parsedLyrics.value[0].text).toBe('newest');
  });

  it('uses the latest order when it changes while the source request is pending', async () => {
    usePlaybackStore().currentSong = song();
    let resolveSource!: (value: unknown) => void;
    invokeMock.mockReturnValueOnce(new Promise(resolve => { resolveSource = resolve; }));
    parseMock.mockResolvedValue({ lines: [line('main')], format: 'lrc', issues: [] });
    const loading = loadLyrics();
    useSettingsStore().patchSettings({ lyrics: { readingOrder: 'roman-translation-main' } });
    await flushReadingOrderChange();
    expect(parseMock).not.toHaveBeenCalled();
    resolveSource({ rawLyrics: 'raw', sourceFormat: 'lrc', sourcePath: null });
    await loading;
    expect(parseMock).toHaveBeenCalledTimes(1);
    expect(parseMock.mock.calls[0][1].readingOrder).toBe('roman-translation-main');
  });

  it('does not reinterpret or rebuild TTML when a manual order changes', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: '<tt/>', sourceFormat: null, sourcePath: null });
    parseMock.mockResolvedValue({ lines: [line('TTML')], format: 'ttml', issues: [] });
    await loadLyrics();
    const original = nativeAmlLyrics.value;
    useSettingsStore().patchSettings({ lyrics: { readingOrder: 'roman-main-translation' } });
    await flushReadingOrderChange();
    expect(parseMock).toHaveBeenCalledTimes(1);
    expect(nativeAmlLyrics.value).toBe(original);
  });

  it('retains the native LYS vocal structure without a manual-order reparse', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: '[3]MAIN(1000,2000)', sourceFormat: 'lys', sourcePath: null });
    parseMock.mockResolvedValue({ lines: [line('MAIN')], format: 'lys', issues: [] });
    await loadLyrics();
    const original = nativeAmlLyrics.value;
    useSettingsStore().patchSettings({ lyrics: { readingOrder: 'translation-main-roman' } });
    await flushReadingOrderChange();
    expect(parseMock).toHaveBeenCalledTimes(1);
    expect(nativeAmlLyrics.value).toBe(original);
  });

  it('still accepts an in-flight TTML parse when its irrelevant manual order changes', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: '<tt/>', sourceFormat: 'ttml', sourcePath: null });
    let resolveParse!: (value: unknown) => void;
    parseMock.mockReturnValueOnce(new Promise(resolve => { resolveParse = resolve; }));
    const loading = loadLyrics();
    await Promise.resolve();
    useSettingsStore().patchSettings({ lyrics: { readingOrder: 'translation-main-roman' } });
    await flushReadingOrderChange();
    resolveParse({ lines: [line('native TTML')], format: 'ttml', issues: [] });
    await loading;
    expect(lyricsStatus.value).toBe('ready');
    expect(parsedLyrics.value[0].text).toBe('native TTML');
    expect(parseMock).toHaveBeenCalledTimes(1);
  });

  it('installs only one order subscription across repeated loads', async () => {
    usePlaybackStore().currentSong = song();
    invokeMock.mockResolvedValue({ rawLyrics: 'raw', sourceFormat: 'lrc', sourcePath: null });
    parseMock.mockResolvedValue({ lines: [line('main')], format: 'lrc', issues: [] });
    await loadLyrics();
    await loadLyrics();
    parseMock.mockClear();
    useSettingsStore().patchSettings({ lyrics: { readingOrder: 'main-roman-translation' } });
    await flushReadingOrderChange();
    expect(parseMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('does not apply a pending order reparse to the next song', async () => {
    const playback = usePlaybackStore();
    playback.currentSong = song('/first.flac');
    invokeMock.mockResolvedValue({ rawLyrics: 'raw', sourceFormat: 'lrc', sourcePath: null });
    parseMock.mockResolvedValueOnce({ lines: [line('first')], format: 'lrc', issues: [] });
    await loadLyrics();
    let resolveOld!: (value: unknown) => void;
    parseMock.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    useSettingsStore().patchSettings({ lyrics: { readingOrder: 'translation-main-roman' } });
    await flushReadingOrderChange();
    playback.currentSong = song('/second.flac');
    parseMock.mockResolvedValueOnce({ lines: [line('second')], format: 'lrc', issues: [] });
    await loadLyrics();
    resolveOld({ lines: [line('stale first')], format: 'lrc', issues: [] });
    await flushReadingOrderChange();
    expect(parsedLyrics.value[0].text).toBe('second');
  });
});
