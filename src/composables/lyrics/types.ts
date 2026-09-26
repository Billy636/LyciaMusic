import type {
  DesktopLyricsSettings,
  DesktopLyricsPlayerAlignment,
  ImportedLyricsFont,
  LyricsColorScheme,
  LyricsFontPreset,
  LyricsPlayerAlignment,
  LyricsPlayerRenderMode,
  LyricsReadingOrder,
  LyricsSettings,
} from '../../types';

export type {
  DesktopLyricsSettings,
  DesktopLyricsPlayerAlignment,
  ImportedLyricsFont,
  LyricsColorScheme,
  LyricsFontPreset,
  LyricsPlayerAlignment,
  LyricsPlayerRenderMode,
  LyricsReadingOrder,
  LyricsSettings,
};

export interface LyricLine {
  time: number;
  endTime: number;
  text: string;
  translation: string;
  romaji: string;
  isBG?: boolean;
  isDuet?: boolean;
  words?: LyricWord[];
  /** Source word timing for translated text; never retimed to the main lyric. */
  translationWords?: LyricWord[];
  romajiWords?: LyricWord[];
  secondary?: string[];
}

/** Raw lyrics and their origin; parsing is owned by the frontend lyric service. */
export interface LyricsSource {
  rawLyrics: string;
  sourceFormat: string | null;
  sourcePath: string | null;
}

export interface LyricWord {
  text: string;
  start: number;
  end: number;
  romaji?: string;
  ruby?: LyricRubyWord[];
  obscene?: boolean;
  emptyBeat?: number;
}

export interface LyricRubyWord {
  text: string;
  start: number;
  end: number;
}

export interface CurrentLyricDisplayLine {
  kind: 'main' | 'romaji' | 'translation';
  text: string;
  words?: LyricWord[];
}

export interface CurrentLyricDisplayState {
  text: string;
  lines: string[];
  displayLines: CurrentLyricDisplayLine[];
}

export type LyricsStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export type ActiveLyricsFormat =
  | 'ttml'
  | 'lrc'
  | 'enhanced_lrc'
  | 'eslrc'
  | 'yrc'
  | 'qrc'
  | 'lys'
  | 'unknown';
