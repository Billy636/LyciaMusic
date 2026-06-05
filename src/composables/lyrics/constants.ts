import type {
  DesktopLyricsSettings,
  ImportedLyricsFont,
  DesktopLyricsPlayerAlignment,
  LyricsColorScheme,
  LyricsFontPreset,
  LyricsPlayerAlignment,
  LyricsPlayerRenderMode,
  LyricsSettings,
} from '../../types';

export const LEGACY_LYRICS_SETTINGS_KEY = 'lyrics_settings';
export const LEGACY_DESKTOP_LYRICS_SETTINGS_KEY = 'desktop_lyrics_settings';

export const DEFAULT_PLAYER_FONT_SCALE = 1;
export const MIN_PLAYER_FONT_SCALE = 0.5;
export const MAX_PLAYER_FONT_SCALE = 3.0;
export const DEFAULT_PLAYER_LINE_GAP = 1;
export const MIN_PLAYER_LINE_GAP = 0.5;
export const MAX_PLAYER_LINE_GAP = 3.0;
export const DEFAULT_PLAYER_OFFSET_X = 0;
export const MIN_PLAYER_OFFSET_X = -30;
export const MAX_PLAYER_OFFSET_X = 30;
export const DEFAULT_PLAYER_OFFSET_Y = 0;
export const MIN_PLAYER_OFFSET_Y = -25;
export const MAX_PLAYER_OFFSET_Y = 25;
export const DEFAULT_PLAYER_ALIGNMENT: LyricsPlayerAlignment = 'left';
export const DEFAULT_DESKTOP_PLAYER_ALIGNMENT: DesktopLyricsPlayerAlignment = 'center';
export const DEFAULT_PLAYER_FONT_PRESET: LyricsFontPreset = 'system';
export const DEFAULT_PLAYER_RENDER_MODE: LyricsPlayerRenderMode = 'amll';
export const DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR = '#EC4141';
export const DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR = '#FFFFFF';
export const DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR = '#BFDBFE';
export const DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR = '#FFFFFF';
export const DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR = '#BFDBFE';
export const DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR = '#FBCFE8';
export const DEFAULT_DESKTOP_TEXT_OPACITY = 1;
export const MIN_DESKTOP_TEXT_OPACITY = 0.6;
export const MAX_DESKTOP_TEXT_OPACITY = 1;
export const DEFAULT_DESKTOP_TEXT_SHADOW_COLOR = '#000000';
export const DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH = 0;
export const MIN_DESKTOP_TEXT_SHADOW_STRENGTH = 0;
export const MAX_DESKTOP_TEXT_SHADOW_STRENGTH = 100;

export interface LyricsFontOption {
  value: LyricsFontPreset;
  label: string;
  fontFamily: string;
  isSystem?: boolean;
  isImported?: boolean;
}

export const LYRICS_FONT_OPTIONS = [
  {
    value: 'system',
    label: '跟随系统默认',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    value: 'yahei',
    label: '微软雅黑',
    fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  },
  {
    value: 'dengxian',
    label: '等线',
    fontFamily: '"DengXian", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  },
  {
    value: 'songti',
    label: '宋体',
    fontFamily: '"SimSun", "Songti SC", "STSong", serif',
  },
  {
    value: 'heiti',
    label: '黑体',
    fontFamily: '"SimHei", "Heiti SC", "Microsoft YaHei", sans-serif',
  },
  {
    value: 'kaiti',
    label: '楷体',
    fontFamily: '"KaiTi", "Kaiti SC", "STKaiti", serif',
  },
  {
    value: 'arial',
    label: 'Arial',
    fontFamily: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
  },
  {
    value: 'georgia',
    label: 'Georgia',
    fontFamily: 'Georgia, "Times New Roman", serif',
  },
  {
    value: 'mono',
    label: '等宽字体',
    fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
  },
] as const satisfies ReadonlyArray<LyricsFontOption>;

export const defaultLyricsSettings: LyricsSettings = {
  showTranslation: true,
  showRomaji: false,
  playerRenderMode: DEFAULT_PLAYER_RENDER_MODE,
  playerFontScale: DEFAULT_PLAYER_FONT_SCALE,
  playerLineGap: DEFAULT_PLAYER_LINE_GAP,
  playerOffsetX: DEFAULT_PLAYER_OFFSET_X,
  playerOffsetY: DEFAULT_PLAYER_OFFSET_Y,
  playerAlignment: DEFAULT_PLAYER_ALIGNMENT,
  playerFontPreset: DEFAULT_PLAYER_FONT_PRESET,
};

export const defaultDesktopLyricsSettings: DesktopLyricsSettings = {
  isAlwaysOnTop: false,
  alwaysShowShadowBackground: false,
  autoHideWhenFullscreen: true,
  autoHideWhenPaused: false,
  showDoubleLine: false,
  enableWordEffect: true,
  isLocked: false,
  persistLock: false,
  colorScheme: 'auto',
  customPlayedColor: DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
  customUnplayedColor: DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
  customRomajiPlayedColor: DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR,
  customRomajiUnplayedColor: DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR,
  customRomajiColor: DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR,
  customTranslationColor: DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
  textOpacity: DEFAULT_DESKTOP_TEXT_OPACITY,
  textShadowColor: DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
  firstLineTextShadowStrength: DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
  secondLineTextShadowStrength: DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
  playerFontScale: DEFAULT_PLAYER_FONT_SCALE,
  playerLineGap: DEFAULT_PLAYER_LINE_GAP,
  playerOffsetX: DEFAULT_PLAYER_OFFSET_X,
  playerOffsetY: DEFAULT_PLAYER_OFFSET_Y,
  playerAlignment: DEFAULT_DESKTOP_PLAYER_ALIGNMENT,
  playerFontPreset: DEFAULT_PLAYER_FONT_PRESET,
};

export function createDefaultLyricsSettings(): LyricsSettings {
  return { ...defaultLyricsSettings };
}

export function createDefaultDesktopLyricsSettings(): DesktopLyricsSettings {
  return { ...defaultDesktopLyricsSettings };
}

export function clampPlayerFontScale(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PLAYER_FONT_SCALE;
  return Math.min(MAX_PLAYER_FONT_SCALE, Math.max(MIN_PLAYER_FONT_SCALE, value));
}

export function clampPlayerLineGap(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PLAYER_LINE_GAP;
  return Math.min(MAX_PLAYER_LINE_GAP, Math.max(MIN_PLAYER_LINE_GAP, value));
}

export function clampPlayerOffsetX(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PLAYER_OFFSET_X;
  return Math.min(MAX_PLAYER_OFFSET_X, Math.max(MIN_PLAYER_OFFSET_X, value));
}

export function clampPlayerOffsetY(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PLAYER_OFFSET_Y;
  return Math.min(MAX_PLAYER_OFFSET_Y, Math.max(MIN_PLAYER_OFFSET_Y, value));
}

export function clampDesktopTextOpacity(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_DESKTOP_TEXT_OPACITY;
  return Math.min(MAX_DESKTOP_TEXT_OPACITY, Math.max(MIN_DESKTOP_TEXT_OPACITY, value));
}

export function clampDesktopTextShadowStrength(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH;
  return Math.min(
    MAX_DESKTOP_TEXT_SHADOW_STRENGTH,
    Math.max(MIN_DESKTOP_TEXT_SHADOW_STRENGTH, Math.round(value)),
  );
}

export function normalizePlayerAlignment(
  value: unknown,
  fallback: LyricsPlayerAlignment = DEFAULT_PLAYER_ALIGNMENT,
): LyricsPlayerAlignment {
  return value === 'center' || value === 'right' || value === 'left' ? value : fallback;
}

export function normalizeDesktopPlayerAlignment(
  value: unknown,
  fallback: DesktopLyricsPlayerAlignment = DEFAULT_DESKTOP_PLAYER_ALIGNMENT,
): DesktopLyricsPlayerAlignment {
  if (value === 'split-corners') {
    return value;
  }

  const horizontalFallback: LyricsPlayerAlignment = fallback === 'split-corners'
    ? 'center'
    : fallback;
  return normalizePlayerAlignment(value, horizontalFallback);
}

export function normalizeLyricsColorScheme(value: unknown): LyricsColorScheme {
  return value === 'default'
    || value === 'pink'
    || value === 'blue'
    || value === 'green'
    || value === 'white'
    || value === 'custom'
    ? value
    : 'auto';
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : fallback;
}

export function normalizeCustomFontName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 160);
}

export function normalizeImportedLyricsFonts(value: unknown): ImportedLyricsFont[] {
  if (!Array.isArray(value)) return [];

  const seenFamilies = new Set<string>();
  const fonts: ImportedLyricsFont[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const font = item as Partial<ImportedLyricsFont>;
    const id = typeof font.id === 'string' ? normalizeCustomFontName(font.id) : '';
    const name = typeof font.name === 'string' ? normalizeCustomFontName(font.name) : '';
    const family = typeof font.family === 'string' ? normalizeCustomFontName(font.family) : '';
    const filePath = typeof font.filePath === 'string' ? font.filePath.trim() : '';
    const importedAt = typeof font.importedAt === 'number' && Number.isFinite(font.importedAt)
      ? font.importedAt
      : Date.now();
    const format = font.format === 'opentype' ? 'opentype' : 'truetype';
    const familyKey = family.toLocaleLowerCase();

    if (!id || !name || !family || !filePath || seenFamilies.has(familyKey)) continue;
    seenFamilies.add(familyKey);
    fonts.push({ id, name, family, filePath, importedAt, format });
  }

  return fonts;
}

export function escapeFontFamilyName(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function normalizeLyricsFontPreset(value: unknown): LyricsFontPreset {
  if (typeof value !== 'string') return DEFAULT_PLAYER_FONT_PRESET;

  const normalized = normalizeCustomFontName(value);
  if (!normalized) return DEFAULT_PLAYER_FONT_PRESET;

  return normalized;
}

export function normalizeLyricsPlayerRenderMode(value: unknown): LyricsPlayerRenderMode {
  return value === 'light' || value === 'amll' ? value : DEFAULT_PLAYER_RENDER_MODE;
}

export function extractPrimaryFontFamily(fontFamily: string): string {
  return fontFamily
    .split(',')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '')
    ?? '';
}

export function normalizeLyricsSettingsPatch(patch: Partial<LyricsSettings>): LyricsSettings {
  return {
    ...defaultLyricsSettings,
    ...patch,
    showTranslation: typeof patch.showTranslation === 'boolean'
      ? patch.showTranslation
      : defaultLyricsSettings.showTranslation,
    showRomaji: typeof patch.showRomaji === 'boolean'
      ? patch.showRomaji
      : defaultLyricsSettings.showRomaji,
    playerRenderMode: normalizeLyricsPlayerRenderMode(patch.playerRenderMode),
    playerFontScale: clampPlayerFontScale(patch.playerFontScale ?? DEFAULT_PLAYER_FONT_SCALE),
    playerLineGap: clampPlayerLineGap(patch.playerLineGap ?? DEFAULT_PLAYER_LINE_GAP),
    playerOffsetX: clampPlayerOffsetX(patch.playerOffsetX ?? DEFAULT_PLAYER_OFFSET_X),
    playerOffsetY: clampPlayerOffsetY(patch.playerOffsetY ?? DEFAULT_PLAYER_OFFSET_Y),
    playerAlignment: normalizePlayerAlignment(patch.playerAlignment, DEFAULT_PLAYER_ALIGNMENT),
    playerFontPreset: normalizeLyricsFontPreset(patch.playerFontPreset),
  };
}

export function normalizeDesktopLyricsSettingsPatch(
  patch: Partial<DesktopLyricsSettings>,
): DesktopLyricsSettings {
  const legacyPatch = patch as Partial<DesktopLyricsSettings> & {
    textShadowStrength?: number;
    customRomajiColor?: string;
  };
  const legacyTextShadowStrength = legacyPatch.textShadowStrength;
  const legacyRomajiColor = legacyPatch.customRomajiColor;

  return {
    ...defaultDesktopLyricsSettings,
    ...patch,
    isAlwaysOnTop: typeof patch.isAlwaysOnTop === 'boolean'
      ? patch.isAlwaysOnTop
      : defaultDesktopLyricsSettings.isAlwaysOnTop,
    alwaysShowShadowBackground: typeof patch.alwaysShowShadowBackground === 'boolean'
      ? patch.alwaysShowShadowBackground
      : defaultDesktopLyricsSettings.alwaysShowShadowBackground,
    autoHideWhenFullscreen: typeof patch.autoHideWhenFullscreen === 'boolean'
      ? patch.autoHideWhenFullscreen
      : defaultDesktopLyricsSettings.autoHideWhenFullscreen,
    autoHideWhenPaused: typeof patch.autoHideWhenPaused === 'boolean'
      ? patch.autoHideWhenPaused
      : defaultDesktopLyricsSettings.autoHideWhenPaused,
    showDoubleLine: typeof patch.showDoubleLine === 'boolean'
      ? patch.showDoubleLine
      : defaultDesktopLyricsSettings.showDoubleLine,
    enableWordEffect: typeof patch.enableWordEffect === 'boolean'
      ? patch.enableWordEffect
      : defaultDesktopLyricsSettings.enableWordEffect,
    isLocked: typeof patch.isLocked === 'boolean'
      ? patch.isLocked
      : defaultDesktopLyricsSettings.isLocked,
    persistLock: typeof patch.persistLock === 'boolean'
      ? patch.persistLock
      : defaultDesktopLyricsSettings.persistLock,
    colorScheme: normalizeLyricsColorScheme(patch.colorScheme),
    customPlayedColor: normalizeHexColor(
      patch.customPlayedColor,
      defaultDesktopLyricsSettings.customPlayedColor,
    ),
    customUnplayedColor: normalizeHexColor(
      patch.customUnplayedColor,
      defaultDesktopLyricsSettings.customUnplayedColor,
    ),
    customRomajiPlayedColor: normalizeHexColor(
      patch.customRomajiPlayedColor ?? legacyRomajiColor,
      defaultDesktopLyricsSettings.customRomajiPlayedColor,
    ),
    customRomajiUnplayedColor: normalizeHexColor(
      patch.customRomajiUnplayedColor ?? legacyRomajiColor,
      defaultDesktopLyricsSettings.customRomajiUnplayedColor,
    ),
    customRomajiColor: normalizeHexColor(
      patch.customRomajiColor,
      defaultDesktopLyricsSettings.customRomajiColor,
    ),
    customTranslationColor: normalizeHexColor(
      patch.customTranslationColor,
      defaultDesktopLyricsSettings.customTranslationColor,
    ),
    textOpacity: clampDesktopTextOpacity(patch.textOpacity ?? DEFAULT_DESKTOP_TEXT_OPACITY),
    textShadowColor: normalizeHexColor(
      patch.textShadowColor,
      defaultDesktopLyricsSettings.textShadowColor,
    ),
    firstLineTextShadowStrength: clampDesktopTextShadowStrength(
      patch.firstLineTextShadowStrength ?? legacyTextShadowStrength ?? DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
    ),
    secondLineTextShadowStrength: clampDesktopTextShadowStrength(
      patch.secondLineTextShadowStrength ?? legacyTextShadowStrength ?? DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
    ),
    playerFontScale: clampPlayerFontScale(patch.playerFontScale ?? DEFAULT_PLAYER_FONT_SCALE),
    playerLineGap: clampPlayerLineGap(patch.playerLineGap ?? DEFAULT_PLAYER_LINE_GAP),
    playerOffsetX: clampPlayerOffsetX(patch.playerOffsetX ?? DEFAULT_PLAYER_OFFSET_X),
    playerOffsetY: clampPlayerOffsetY(patch.playerOffsetY ?? DEFAULT_PLAYER_OFFSET_Y),
    playerAlignment: normalizeDesktopPlayerAlignment(
      patch.playerAlignment,
      DEFAULT_DESKTOP_PLAYER_ALIGNMENT,
    ),
    playerFontPreset: normalizeLyricsFontPreset(patch.playerFontPreset),
  };
}

export function mergeLyricsSettings(
  base: LyricsSettings,
  patch: Partial<LyricsSettings>,
): LyricsSettings {
  return normalizeLyricsSettingsPatch({
    ...base,
    ...patch,
  });
}

export function mergeDesktopLyricsSettings(
  base: DesktopLyricsSettings,
  patch: Partial<DesktopLyricsSettings>,
): DesktopLyricsSettings {
  return normalizeDesktopLyricsSettingsPatch({
    ...base,
    ...patch,
  });
}
