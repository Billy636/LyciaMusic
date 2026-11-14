import { computed, ref, shallowRef, watch, type WatchStopHandle } from 'vue';
import { invoke } from '@tauri-apps/api/core';

import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import { useLyricsSettingsStore } from '../../features/lyricsSettings/store';
import { getCurrentLyricDisplayLines } from './converters';
import { parseOfficialLyrics } from './officialParser';
import { resolveLyricsReadingOrder } from './readingOrder';
import { findDisplayLyricIndex } from './selection';
import {
  amlLineToLegacyLyricLine,
  hasRenderableLyricContent,
  isTtmlLyrics,
  type NativeAmlLyricLine,
} from './ttml';
import type {
  ActiveLyricsFormat,
  CurrentLyricDisplayState,
  DesktopLyricsSettings,
  LyricLine,
  LyricsSource,
  LyricsSettings,
  LyricsStatus,
} from './types';

export const showDesktopLyrics = ref(false);
export const showLyricsPlayerSettingsPanel = ref(false);
export const lyricsStatus = ref<LyricsStatus>('idle');
export const activeLyricsFormat = ref<ActiveLyricsFormat>('unknown');
// One canonical, millisecond-based document. Renderers never write back to it.
export const nativeAmlLyrics = shallowRef<NativeAmlLyricLine[]>([]);
export const lyricsIssues = shallowRef<string[]>([]);
export const lyricsSource = shallowRef<LyricsSource | null>(null);
// Legacy consumers (desktop, taskbar and light player) still use seconds.
// Sort only this projection: the canonical order preserves AMLL vocal groups.
export const parsedLyrics = computed<LyricLine[]>(() => nativeAmlLyrics.value
  .map(amlLineToLegacyLyricLine)
  .sort((left, right) => left.time - right.time));

const rawLyrics = ref('');
let loadRequestId = 0;
let parseRequestId = 0;
interface LoadedLyricsSource {
  requestId: number;
  songPath: string;
  durationMs: number;
  source: LyricsSource;
}
let loadedSource: LoadedLyricsSource | null = null;
let watchedSettingsStore: ReturnType<typeof useSettingsStore> | undefined;
let stopReadingOrderWatch: WatchStopHandle | undefined;

const getEffectiveLyricsReadingOrder = () => resolveLyricsReadingOrder(
  useSettingsStore().settings.lyrics,
  usePlaybackStore().currentSong?.path,
);

function isCurrentSource(source: LoadedLyricsSource): boolean {
  return loadedSource === source && source.requestId === loadRequestId
    && usePlaybackStore().currentSong?.path === source.songPath;
}

function hasNativeRoleStructure(source: LoadedLyricsSource): boolean {
  const format = source.source.sourceFormat?.toLowerCase();
  return isTtmlLyrics(source.source.rawLyrics) || format === 'ttml' || format === 'lys';
}

async function parseLoadedSource(source: LoadedLyricsSource) {
  if (!isCurrentSource(source)) return;
  const revision = ++parseRequestId;
  const readingOrder = getEffectiveLyricsReadingOrder();
  const nativeRoles = hasNativeRoleStructure(source);
  const isCurrent = () => revision === parseRequestId && isCurrentSource(source)
    && (nativeRoles || readingOrder === getEffectiveLyricsReadingOrder());
  try {
    const result = await parseOfficialLyrics(source.source.rawLyrics, {
      format: source.source.sourceFormat,
      durationMs: source.durationMs,
      readingOrder,
    });
    if (!isCurrent()) return;

    activeLyricsFormat.value = result.format;
    lyricsIssues.value = result.issues;
    nativeAmlLyrics.value = result.lines;
    lyricsStatus.value = result.error ? 'error'
      : result.lines.some(hasRenderableLyricContent) ? 'ready' : 'empty';
  } catch (error) {
    if (!isCurrent()) return;
    lyricsIssues.value = [error instanceof Error ? error.message : String(error)];
    nativeAmlLyrics.value = [];
    lyricsStatus.value = 'error';
    console.error('Failed to parse lyrics:', error);
  }
}

function ensureReadingOrderWatch() {
  const settingsStore = useSettingsStore();
  if (settingsStore === watchedSettingsStore) return;
  // Reusing the same settings store installs only one watcher. Dispose the old
  // subscription when a new Pinia instance is used (tests / app recreation).
  stopReadingOrderWatch?.();
  watchedSettingsStore = settingsStore;
  const playbackStore = usePlaybackStore();
  stopReadingOrderWatch = watch(
    () => resolveLyricsReadingOrder(settingsStore.settings.lyrics, playbackStore.currentSong?.path),
    () => {
      const source = loadedSource;
      if (!source || !isCurrentSource(source)) return;
      // Native role/vocal formats are not reinterpreted by a manual order.
      if (hasNativeRoleStructure(source)) return;
      // Reinterpret the cached raw source, never reread or overwrite the file.
      // Keep the current view visible until the newest parse is ready.
      void parseLoadedSource(source);
    },
    { flush: 'post' },
  );
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopReadingOrderWatch?.();
    stopReadingOrderWatch = undefined;
    watchedSettingsStore = undefined;
    loadedSource = null;
    loadRequestId += 1;
    parseRequestId += 1;
  });
}

function createSettingsProxy<T extends object>(
  read: () => T,
  patch: (patch: Partial<T>) => void,
): T {
  return new Proxy({} as T, {
    get(_target, property) {
      return read()[property as keyof T];
    },
    set(_target, property, value) {
      if (typeof property !== 'string') return false;
      patch({ [property]: value } as Partial<T>);
      return true;
    },
    has(_target, property) {
      return property in read();
    },
    ownKeys() {
      return Reflect.ownKeys(read());
    },
    getOwnPropertyDescriptor() {
      return {
        enumerable: true,
        configurable: true,
      };
    },
  });
}

export const lyricsSettings = createSettingsProxy<LyricsSettings>(
  () => useLyricsSettingsStore().lyricsSettings,
  (patch) => useLyricsSettingsStore().patchLyricsSettings(patch),
);

export const desktopLyricsSettings = createSettingsProxy<DesktopLyricsSettings>(
  () => useLyricsSettingsStore().desktopLyricsSettings,
  (patch) => useLyricsSettingsStore().patchDesktopLyricsSettings(patch),
);

export async function loadLyrics() {
  ensureReadingOrderWatch();
  const requestId = ++loadRequestId;
  parseRequestId += 1;
  const playbackStore = usePlaybackStore();
  const song = playbackStore.currentSong;

  loadedSource = null;
  rawLyrics.value = '';
  lyricsSource.value = null;
  lyricsIssues.value = [];
  activeLyricsFormat.value = 'unknown';
  nativeAmlLyrics.value = [];
  lyricsStatus.value = song ? 'loading' : 'idle';
  if (!song) return;

  const isCurrentRequest = () => requestId === loadRequestId
    && playbackStore.currentSong?.path === song.path;

  try {
    const lyricsPath = song.cue_source_path || song.path;
    const source = await invoke<LyricsSource>('get_song_lyrics_source', { path: lyricsPath });
    if (!isCurrentRequest()) return;

    lyricsSource.value = source;
    rawLyrics.value = source.rawLyrics;
    const cached = { requestId, songPath: song.path, durationMs: song.duration * 1000, source };
    loadedSource = cached;
    await parseLoadedSource(cached);
  } catch (error) {
    if (!isCurrentRequest()) return;

    // Keep the raw source for diagnostics instead of discarding unparsed text.
    lyricsIssues.value = [error instanceof Error ? error.message : String(error)];
    activeLyricsFormat.value = 'unknown';
    nativeAmlLyrics.value = [];
    lyricsStatus.value = 'error';
    console.error('Failed to load lyrics:', error);
  }
}

export const currentLyricIndex = computed(() => {
  if (parsedLyrics.value.length === 0) return -1;

  const targetTime = usePlaybackStore().currentTime - useSettingsStore().audioDelay;
  return findDisplayLyricIndex(parsedLyrics.value, targetTime);
});

export const currentLyricLine = computed<CurrentLyricDisplayState>(() => {
  if (lyricsStatus.value === 'loading') {
    return {
      text: 'Loading lyrics...',
      lines: ['Loading lyrics...'],
      displayLines: [{ kind: 'main', text: 'Loading lyrics...' }],
    };
  }

  if (lyricsStatus.value === 'error') {
    return {
      text: 'Lyrics unavailable',
      lines: ['Lyrics unavailable'],
      displayLines: [{ kind: 'main', text: 'Lyrics unavailable' }],
    };
  }

  if (lyricsStatus.value === 'empty' || parsedLyrics.value.length === 0) {
    const fallback = rawLyrics.value.trim() ? 'No synchronized lyrics' : 'Instrumental / No lyrics';
    return {
      text: fallback,
      lines: [fallback],
      displayLines: [{ kind: 'main', text: fallback }],
    };
  }

  const index = currentLyricIndex.value;

  if (index !== -1) {
    const current = parsedLyrics.value[index];
    const displayLines = getCurrentLyricDisplayLines(
      current,
      lyricsSettings.showTranslation,
      lyricsSettings.showRomaji,
    );

    return {
      text: current.text,
      lines: displayLines.map((line) => line.text),
      displayLines,
    };
  }

  const previewIndex = findDisplayLyricIndex(
    parsedLyrics.value,
    usePlaybackStore().currentTime - useSettingsStore().audioDelay,
    true,
  );
  const first = parsedLyrics.value[Math.max(0, previewIndex)];
  return {
    text: first.text,
    lines: [first.text],
    displayLines: [{ kind: 'main', text: first.text }],
  };
});

export function useLyrics() {
  return {
    showDesktopLyrics,
    showLyricsPlayerSettingsPanel,
    lyricsSettings,
    desktopLyricsSettings,
    lyricsStatus,
    currentLyricLine,
    currentLyricIndex,
    parsedLyrics,
    activeLyricsFormat,
    nativeAmlLyrics,
    lyricsSource,
    lyricsIssues,
    loadLyrics,
  };
}
