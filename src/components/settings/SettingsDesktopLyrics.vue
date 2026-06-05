<script setup lang="ts">
import { emit } from '@tauri-apps/api/event';
import { Check, ChevronDown, Sun, Moon } from 'lucide-vue-next';
import { computed, nextTick, onMounted, onUnmounted, ref, watch, toRaw } from 'vue';

import {
  DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
  DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
  DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
  buildImportedLyricsFontOptions,
  LYRICS_FONT_OPTIONS,
  MAX_DESKTOP_TEXT_SHADOW_STRENGTH,
  MIN_DESKTOP_TEXT_SHADOW_STRENGTH,
  getLyricsFontFamily,
  loadSystemLyricsFonts,
  normalizeHexColor,
  normalizeDesktopPlayerAlignment,
  normalizeLyricsFontPreset,
  systemLyricsFontOptions,
  type DesktopLyricsPlayerAlignment,
  type LyricsColorScheme,
  type LyricsFontPreset,
  useLyrics,
  createDefaultDesktopLyricsSettings,
} from '../../composables/lyrics';
import { DESKTOP_LYRICS_RESET_BOUNDS_EVENT } from '../../features/desktopLyrics/shared';
import { useSettings } from '../../features/settings/useSettings';
import { useLyricsSettingsStore } from '../../features/lyricsSettings/store';



const ALIGNMENT_OPTIONS: Array<{ value: DesktopLyricsPlayerAlignment; label: string }> = [
  { value: 'left', label: '靠左' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '靠右' },
  { value: 'split-corners', label: '阶梯式' },
];

const COLOR_SCHEME_OPTIONS: Array<{
  value: LyricsColorScheme;
  label: string;
  hint: string;
  color?: string;
}> = [
  { value: 'default', label: '经典红', hint: '使用 Lycia 的默认红色方案', color: '#EC4141' },
  { value: 'pink', label: '柔粉', hint: '偏柔和、偏梦幻的粉色搭配', color: '#f472b6' },
  { value: 'blue', label: '澄蓝', hint: '更冷静的蓝色高亮', color: '#60a5fa' },
  { value: 'green', label: '青绿', hint: '更清爽的绿色高亮', color: '#34d399' },
  { value: 'custom', label: '自定义', hint: '手动选择已播放和未播放颜色' },
  { value: 'auto', label: '封面取色', hint: '跟随当前歌曲封面颜色' },
];

const SHADOW_COLOR_PRESETS = [
  { label: '黑', value: '#000000' },
  { label: '白', value: '#FFFFFF' },
  { label: '红', value: DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR },
];

const { settings } = useSettings();
const { lyricsSettings, desktopLyricsSettings } = useLyrics();

const previewBgMode = ref<'dark' | 'light'>('dark');

const localSettings = ref({
  playerFontScale: desktopLyricsSettings.playerFontScale,
  playerLineGap: desktopLyricsSettings.playerLineGap,
  playerOffsetX: desktopLyricsSettings.playerOffsetX,
  playerOffsetY: desktopLyricsSettings.playerOffsetY,
  textOpacity: desktopLyricsSettings.textOpacity,
  firstLineTextShadowStrength: desktopLyricsSettings.firstLineTextShadowStrength,
  secondLineTextShadowStrength: desktopLyricsSettings.secondLineTextShadowStrength,
  textShadowColor: desktopLyricsSettings.textShadowColor,
  playerAlignment: desktopLyricsSettings.playerAlignment,
  playerFontPreset: desktopLyricsSettings.playerFontPreset,
  colorScheme: desktopLyricsSettings.colorScheme,
  customPlayedColor: desktopLyricsSettings.customPlayedColor,
  customUnplayedColor: desktopLyricsSettings.customUnplayedColor,
  customRomajiPlayedColor: desktopLyricsSettings.customRomajiPlayedColor,
  customRomajiUnplayedColor: desktopLyricsSettings.customRomajiUnplayedColor,
  customRomajiColor: desktopLyricsSettings.customRomajiColor,
  customTranslationColor: desktopLyricsSettings.customTranslationColor,
});

const isModified = computed(() => {
  const isNumChanged = (a: number, b: number) => Math.abs(a - b) >= 0.001;

  return (
    isNumChanged(localSettings.value.playerFontScale, desktopLyricsSettings.playerFontScale) ||
    isNumChanged(localSettings.value.playerLineGap, desktopLyricsSettings.playerLineGap) ||
    isNumChanged(localSettings.value.playerOffsetX, desktopLyricsSettings.playerOffsetX) ||
    isNumChanged(localSettings.value.playerOffsetY, desktopLyricsSettings.playerOffsetY) ||
    isNumChanged(localSettings.value.textOpacity, desktopLyricsSettings.textOpacity) ||
    isNumChanged(localSettings.value.firstLineTextShadowStrength, desktopLyricsSettings.firstLineTextShadowStrength) ||
    isNumChanged(localSettings.value.secondLineTextShadowStrength, desktopLyricsSettings.secondLineTextShadowStrength) ||
    localSettings.value.textShadowColor !== desktopLyricsSettings.textShadowColor ||
    localSettings.value.playerAlignment !== desktopLyricsSettings.playerAlignment ||
    localSettings.value.playerFontPreset !== desktopLyricsSettings.playerFontPreset ||
    localSettings.value.colorScheme !== desktopLyricsSettings.colorScheme ||
    localSettings.value.customPlayedColor !== desktopLyricsSettings.customPlayedColor ||
    localSettings.value.customUnplayedColor !== desktopLyricsSettings.customUnplayedColor ||
    localSettings.value.customRomajiPlayedColor !== desktopLyricsSettings.customRomajiPlayedColor ||
    localSettings.value.customRomajiUnplayedColor !== desktopLyricsSettings.customRomajiUnplayedColor ||
    localSettings.value.customRomajiColor !== desktopLyricsSettings.customRomajiColor ||
    localSettings.value.customTranslationColor !== desktopLyricsSettings.customTranslationColor
  );
});

watch(
  () => [
    desktopLyricsSettings.playerFontScale,
    desktopLyricsSettings.playerLineGap,
    desktopLyricsSettings.playerOffsetX,
    desktopLyricsSettings.playerOffsetY,
    desktopLyricsSettings.textOpacity,
    desktopLyricsSettings.firstLineTextShadowStrength,
    desktopLyricsSettings.secondLineTextShadowStrength,
    desktopLyricsSettings.textShadowColor,
    desktopLyricsSettings.playerAlignment,
    desktopLyricsSettings.playerFontPreset,
    desktopLyricsSettings.colorScheme,
    desktopLyricsSettings.customPlayedColor,
    desktopLyricsSettings.customUnplayedColor,
    desktopLyricsSettings.customRomajiPlayedColor,
    desktopLyricsSettings.customRomajiUnplayedColor,
    desktopLyricsSettings.customRomajiColor,
    desktopLyricsSettings.customTranslationColor,
  ],
  (newVal) => {
    if (!isModified.value) {
      localSettings.value = {
        playerFontScale: newVal[0] as number,
        playerLineGap: newVal[1] as number,
        playerOffsetX: newVal[2] as number,
        playerOffsetY: newVal[3] as number,
        textOpacity: newVal[4] as number,
        firstLineTextShadowStrength: newVal[5] as number,
        secondLineTextShadowStrength: newVal[6] as number,
        textShadowColor: newVal[7] as string,
        playerAlignment: newVal[8] as any,
        playerFontPreset: newVal[9] as any,
        colorScheme: newVal[10] as any,
        customPlayedColor: newVal[11] as string,
        customUnplayedColor: newVal[12] as string,
        customRomajiPlayedColor: newVal[13] as string,
        customRomajiUnplayedColor: newVal[14] as string,
        customRomajiColor: newVal[15] as string,
        customTranslationColor: newVal[16] as string,
      };
    }
  },
  { deep: true }
);

function applyChanges() {
  useLyricsSettingsStore().patchDesktopLyricsSettings(toRaw(localSettings.value));
}

function cancelChanges() {
  localSettings.value = {
    playerFontScale: desktopLyricsSettings.playerFontScale,
    playerLineGap: desktopLyricsSettings.playerLineGap,
    playerOffsetX: desktopLyricsSettings.playerOffsetX,
    playerOffsetY: desktopLyricsSettings.playerOffsetY,
    textOpacity: desktopLyricsSettings.textOpacity,
    firstLineTextShadowStrength: desktopLyricsSettings.firstLineTextShadowStrength,
    secondLineTextShadowStrength: desktopLyricsSettings.secondLineTextShadowStrength,
    textShadowColor: desktopLyricsSettings.textShadowColor,
    playerAlignment: desktopLyricsSettings.playerAlignment,
    playerFontPreset: desktopLyricsSettings.playerFontPreset,
    colorScheme: desktopLyricsSettings.colorScheme,
    customPlayedColor: desktopLyricsSettings.customPlayedColor,
    customUnplayedColor: desktopLyricsSettings.customUnplayedColor,
    customRomajiPlayedColor: desktopLyricsSettings.customRomajiPlayedColor,
    customRomajiUnplayedColor: desktopLyricsSettings.customRomajiUnplayedColor,
    customRomajiColor: desktopLyricsSettings.customRomajiColor,
    customTranslationColor: desktopLyricsSettings.customTranslationColor,
  };
}

function resetToDefault() {
  const defaults = createDefaultDesktopLyricsSettings();
  localSettings.value = {
    playerFontScale: defaults.playerFontScale,
    playerLineGap: defaults.playerLineGap,
    playerOffsetX: defaults.playerOffsetX,
    playerOffsetY: defaults.playerOffsetY,
    textOpacity: defaults.textOpacity,
    firstLineTextShadowStrength: defaults.firstLineTextShadowStrength,
    secondLineTextShadowStrength: defaults.secondLineTextShadowStrength,
    textShadowColor: defaults.textShadowColor,
    playerAlignment: defaults.playerAlignment,
    playerFontPreset: defaults.playerFontPreset,
    colorScheme: defaults.colorScheme,
    customPlayedColor: defaults.customPlayedColor,
    customUnplayedColor: defaults.customUnplayedColor,
    customRomajiPlayedColor: defaults.customRomajiPlayedColor,
    customRomajiUnplayedColor: defaults.customRomajiUnplayedColor,
    customRomajiColor: defaults.customRomajiColor,
    customTranslationColor: defaults.customTranslationColor,
  };
}

function hexToRgbTriplet(value: string) {
  const normalized = normalizeHexColor(value, '#000000');
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normalized);
  if (!match) return '0 0 0';

  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
  ].join(' ');
}

const previewLyricsPlayerStyle = computed(() => ({
  '--desktop-font-scale': localSettings.value.playerFontScale.toString(),
  '--desktop-line-gap': localSettings.value.playerLineGap.toString(),
  '--lyrics-font-family': getLyricsFontFamily(localSettings.value.playerFontPreset),
}));

const previewLyricsAlignmentClass = computed(() => {
  if (localSettings.value.playerAlignment === 'split-corners') {
    return 'lyrics-align-left';
  }
  return `lyrics-align-${localSettings.value.playerAlignment}`;
});

const PREVIEW_FIXED_PALETTES = {
  auto: ['#8ec5ff', '#ff8cab', '#88f3c2', '#ffe07d'],
  default: ['#EC4141', '#ff8364', '#f7b267', '#ffd166'],
  pink: ['#f472b6', '#fb7185', '#f9a8d4', '#fbcfe8'],
  blue: ['#60a5fa', '#38bdf8', '#93c5fd', '#bfdbfe'],
  green: ['#34d399', '#22c55e', '#6ee7b7', '#bbf7d0'],
  white: ['#ffffff', '#f3f4f6', '#d1d5db', '#9ca3af'],
};


const previewResolvedPalette = computed(() => {
  if (localSettings.value.colorScheme === 'custom') {
    return [
      localSettings.value.customPlayedColor,
      localSettings.value.customPlayedColor,
      localSettings.value.customPlayedColor,
      localSettings.value.customUnplayedColor,
    ];
  }
  const scheme = localSettings.value.colorScheme;
  return PREVIEW_FIXED_PALETTES[scheme] || PREVIEW_FIXED_PALETTES.default;
});

const previewWidgetStyle = computed(() => {
  return {
    '--desktop-accent-a': previewResolvedPalette.value[0],
    '--desktop-accent-b': previewResolvedPalette.value[1],
    '--desktop-accent-c': previewResolvedPalette.value[2],
    '--desktop-accent-d': previewResolvedPalette.value[3],
    '--desktop-lyric-solid-color': localSettings.value.colorScheme === 'custom'
      ? localSettings.value.customPlayedColor
      : 'var(--desktop-accent-a)',
    '--desktop-text-primary': localSettings.value.colorScheme === 'custom'
      ? localSettings.value.customUnplayedColor
      : 'rgba(255, 255, 255, 0.98)',
    '--desktop-romaji-color': localSettings.value.colorScheme === 'custom'
      ? localSettings.value.customRomajiUnplayedColor
      : 'color-mix(in srgb, var(--desktop-accent-d) 42%, rgba(255, 255, 255, 0.88))',
    '--desktop-romaji-played-color': localSettings.value.colorScheme === 'custom'
      ? localSettings.value.customRomajiPlayedColor
      : 'color-mix(in srgb, var(--desktop-accent-b) 58%, var(--desktop-romaji-color))',
    '--desktop-romaji-unplayed-color': localSettings.value.colorScheme === 'custom'
      ? localSettings.value.customRomajiUnplayedColor
      : 'var(--desktop-romaji-color)',
    '--desktop-translation-color': localSettings.value.colorScheme === 'custom'
      ? localSettings.value.customTranslationColor
      : 'color-mix(in srgb, var(--desktop-accent-c) 28%, rgba(255, 255, 255, 0.76))',
    '--desktop-text-opacity': localSettings.value.textOpacity.toString(),
    '--desktop-text-shadow-color': hexToRgbTriplet(localSettings.value.textShadowColor),
    '--desktop-first-line-text-shadow-alpha': (localSettings.value.firstLineTextShadowStrength / 100).toString(),
    '--desktop-first-line-text-shadow-blur': `${Math.round(localSettings.value.firstLineTextShadowStrength * 0.24)}px`,
    '--desktop-second-line-text-shadow-alpha': (localSettings.value.secondLineTextShadowStrength / 100).toString(),
    '--desktop-second-line-text-shadow-blur': `${Math.round(localSettings.value.secondLineTextShadowStrength * 0.24)}px`,
    textAlign: localSettings.value.playerAlignment === 'right'
      ? 'right'
      : localSettings.value.playerAlignment === 'left'
        ? 'left'
        : 'center',
  } as Record<string, string>;
});

const playedWordStyle = computed(() => ({
  color: 'var(--desktop-lyric-solid-color)',
  textShadow: 'none',
}));

const activeWordStyle = computed(() => ({
  backgroundImage: 'linear-gradient(90deg, var(--desktop-lyric-solid-color) 0%, var(--desktop-lyric-solid-color) 50%, var(--desktop-text-primary) 50%, var(--desktop-text-primary) 100%)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  textShadow: 'none',
}));

const unplayedWordStyle = computed(() => ({
  color: 'var(--desktop-text-primary)',
  textShadow: 'none',
}));

const playedRomajiWordStyle = computed(() => ({
  color: 'var(--desktop-romaji-played-color)',
  textShadow: 'none',
}));

const activeRomajiWordStyle = computed(() => ({
  backgroundImage: 'linear-gradient(90deg, var(--desktop-romaji-played-color) 0%, var(--desktop-romaji-played-color) 50%, var(--desktop-romaji-unplayed-color) 50%, var(--desktop-romaji-unplayed-color) 100%)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  textShadow: 'none',
}));

const unplayedRomajiWordStyle = computed(() => ({
  color: 'var(--desktop-romaji-unplayed-color)',
  textShadow: 'none',
}));

const fontPresetFieldRef = ref<HTMLElement | null>(null);
const fontPresetTriggerRef = ref<HTMLElement | null>(null);
const fontPresetMenuRef = ref<HTMLElement | null>(null);
const isFontPresetMenuOpen = ref(false);
const fontPresetMenuStyle = ref<Record<string, string>>({});
const showLyricsSyncOffsetPanel = ref(false);
const isResettingWindowBounds = ref(false);
const isCustomColorModalOpen = ref(false);
type DesktopCustomColorKind = 'played' | 'unplayed' | 'romajiPlayed' | 'romajiUnplayed' | 'translation';
const activeCustomColorKind = ref<DesktopCustomColorKind | null>(null);
const customPickerHue = ref(0);
const customPickerSaturation = ref(100);
const customPickerValue = ref(100);
const customPreviewRef = ref<HTMLElement | null>(null);
const customColorPanelRef = ref<HTMLElement | null>(null);
const customColorPanelStyle = ref<Record<string, string>>({});
const CUSTOM_COLOR_PANEL_WIDTH = 340;
const CUSTOM_COLOR_PANEL_HEIGHT = 400;
const CUSTOM_COLOR_PANEL_GAP = 20;
const CUSTOM_COLOR_PANEL_LEFT_SHIFT = 425;

const availableFontOptions = computed(() => [
  ...buildImportedLyricsFontOptions(settings.value.customLyricsFonts),
  ...LYRICS_FONT_OPTIONS,
  ...systemLyricsFontOptions.value,
]);

const selectedFontLabel = computed(() => {
  return availableFontOptions.value.find((option) => option.value === localSettings.value.playerFontPreset)?.label
    ?? normalizeLyricsFontPreset(localSettings.value.playerFontPreset);
});
const selectedFontFamily = computed(() => {
  return availableFontOptions.value.find((option) => option.value === localSettings.value.playerFontPreset)?.fontFamily
    ?? getLyricsFontFamily(localSettings.value.playerFontPreset);
});


const isCustomShadowColor = computed(() => {
  return !SHADOW_COLOR_PRESETS.some((preset) => preset.value === localSettings.value.textShadowColor);
});
const customPreviewPlayedStyle = computed(() => ({
  color: localSettings.value.customPlayedColor,
  textShadow: `0 0 16px ${localSettings.value.customPlayedColor}66`,
}));
const customPreviewCurrentStyle = computed(() => ({
  backgroundImage: `linear-gradient(90deg, ${localSettings.value.customPlayedColor} 0%, ${localSettings.value.customPlayedColor} 56%, ${localSettings.value.customUnplayedColor} 56%, ${localSettings.value.customUnplayedColor} 100%)`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  filter: `drop-shadow(0 0 12px ${localSettings.value.customPlayedColor}55)`,
}));
const customPreviewUnplayedStyle = computed(() => ({
  color: localSettings.value.customUnplayedColor,
}));
const customPreviewRomajiPlayedStyle = computed(() => ({
  color: localSettings.value.customRomajiPlayedColor,
  textShadow: `0 0 12px ${localSettings.value.customRomajiPlayedColor}44`,
}));
const customPreviewRomajiCurrentStyle = computed(() => ({
  backgroundImage: `linear-gradient(90deg, ${localSettings.value.customRomajiPlayedColor} 0%, ${localSettings.value.customRomajiPlayedColor} 56%, ${localSettings.value.customRomajiUnplayedColor} 56%, ${localSettings.value.customRomajiUnplayedColor} 100%)`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  filter: `drop-shadow(0 0 10px ${localSettings.value.customRomajiPlayedColor}44)`,
}));
const customPreviewRomajiUnplayedStyle = computed(() => ({
  color: localSettings.value.customRomajiUnplayedColor,
}));
const customPreviewTranslationStyle = computed(() => ({
  color: localSettings.value.customTranslationColor,
  textShadow: `0 0 12px ${localSettings.value.customTranslationColor}44`,
}));

const lyricsSyncOffsetMs = computed({
  get: () => Math.round(settings.value.lyricsSyncOffset * 1000),
  set: (value: number | string) => {
    const next = typeof value === 'string' ? Number(value) : value;
    settings.value.lyricsSyncOffset = clampLyricsSyncOffset(next) / 1000;
  },
});

const lyricsSyncOffsetLabel = computed(() => {
  const offset = lyricsSyncOffsetMs.value;
  if (offset === 0) return '0 ms';
  return `${offset > 0 ? '+' : ''}${offset} ms`;
});
const activeCustomColorLabel = computed(() => {
  const labels: Record<DesktopCustomColorKind, string> = {
    played: '主歌词 已播放',
    unplayed: '主歌词 未播放',
    romajiPlayed: '罗马音 已播放',
    romajiUnplayed: '罗马音 未播放',
    translation: '翻译',
  };
  return activeCustomColorKind.value ? labels[activeCustomColorKind.value] : '';
});
const customPickerHueColor = computed(() => hsvToHex(customPickerHue.value, 100, 100));
const customPickerColor = computed(() => hsvToHex(
  customPickerHue.value,
  customPickerSaturation.value,
  customPickerValue.value,
));
const customPickerRgb = computed(() => hexToRgb(customPickerColor.value));



function clampTextShadowStrength(value: number) {
  return Math.min(MAX_DESKTOP_TEXT_SHADOW_STRENGTH, Math.max(MIN_DESKTOP_TEXT_SHADOW_STRENGTH, value));
}

function clampLyricsSyncOffset(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1000, Math.max(-1000, Math.round(value / 10) * 10));
}



function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function clampRgb(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function hexToRgb(value: string) {
  const normalized = normalizeHexColor(value, '#000000');
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((channel) => clampRgb(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function rgbToHsv(r: number, g: number, b: number) {
  const red = clampRgb(r) / 255;
  const green = clampRgb(g) / 255;
  const blue = clampRgb(b) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }

  if (hue < 0) hue += 360;

  return {
    h: Math.round(hue),
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
  };
}

function hsvToHex(h: number, s: number, v: number) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clampPercent(s) / 100;
  const value = clampPercent(v) / 100;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const match = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) {
    red = chroma; green = x;
  } else if (hue < 120) {
    red = x; green = chroma;
  } else if (hue < 180) {
    green = chroma; blue = x;
  } else if (hue < 240) {
    green = x; blue = chroma;
  } else if (hue < 300) {
    red = x; blue = chroma;
  } else {
    red = chroma; blue = x;
  }

  return rgbToHex(
    (red + match) * 255,
    (green + match) * 255,
    (blue + match) * 255,
  );
}


function setDesktopTextShadowStrength(value: number) {
  const val = Number(clampTextShadowStrength(value).toFixed(0));
  localSettings.value.firstLineTextShadowStrength = val;
  localSettings.value.secondLineTextShadowStrength = val;
}

function setDesktopTextShadowColor(value: string) {
  localSettings.value.textShadowColor = normalizeHexColor(value, DEFAULT_DESKTOP_TEXT_SHADOW_COLOR);
}

function setDesktopAlignment(value: DesktopLyricsPlayerAlignment) {
  localSettings.value.playerAlignment = normalizeDesktopPlayerAlignment(value);
}

function setDesktopFontPreset(value: LyricsFontPreset) {
  localSettings.value.playerFontPreset = normalizeLyricsFontPreset(value);
}

function setDesktopColorScheme(value: LyricsColorScheme) {
  localSettings.value.colorScheme = value;
}

function selectDesktopColorScheme(value: LyricsColorScheme) {
  if (value === 'custom') {
    openCustomColorModal();
    return;
  }

  setDesktopColorScheme(value);
}

function setDesktopCustomColor(kind: DesktopCustomColorKind, value: string) {
  const fallbackMap = {
    played: DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
    unplayed: DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
    romajiPlayed: DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR,
    romajiUnplayed: DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR,
    translation: DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
  };
  const fallback = fallbackMap[kind];
  const normalized = normalizeHexColor(value, fallback);

  if (kind === 'played') {
    localSettings.value.customPlayedColor = normalized;
  } else if (kind === 'unplayed') {
    localSettings.value.customUnplayedColor = normalized;
  } else if (kind === 'romajiPlayed') {
    localSettings.value.customRomajiPlayedColor = normalized;
  } else if (kind === 'romajiUnplayed') {
    localSettings.value.customRomajiUnplayedColor = normalized;
    localSettings.value.customRomajiColor = normalized;
  } else {
    localSettings.value.customTranslationColor = normalized;
  }

  localSettings.value.colorScheme = 'custom';
}

function getDesktopCustomColor(kind: DesktopCustomColorKind) {
  if (kind === 'played') return localSettings.value.customPlayedColor;
  if (kind === 'unplayed') return localSettings.value.customUnplayedColor;
  if (kind === 'romajiPlayed') return localSettings.value.customRomajiPlayedColor;
  if (kind === 'romajiUnplayed') return localSettings.value.customRomajiUnplayedColor;
  return localSettings.value.customTranslationColor;
}

function syncCustomPickerFromColor(color: string) {
  const rgb = hexToRgb(color);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  customPickerHue.value = hsv.h;
  customPickerSaturation.value = hsv.s;
  customPickerValue.value = hsv.v;
}

function updateCustomColorPanelPosition(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const viewportPadding = 16;
  const panelWidth = Math.min(CUSTOM_COLOR_PANEL_WIDTH, window.innerWidth - viewportPadding * 2);
  const previewTop = customPreviewRef.value?.getBoundingClientRect().top ?? window.innerHeight - viewportPadding;
  const maxTopBeforePreview = previewTop - CUSTOM_COLOR_PANEL_HEIGHT - CUSTOM_COLOR_PANEL_GAP;
  const maxViewportTop = window.innerHeight - CUSTOM_COLOR_PANEL_HEIGHT - viewportPadding;
  const maxTop = Math.max(viewportPadding, Math.min(maxTopBeforePreview, maxViewportTop));
  const preferredTop = rect.top;
  const preferredLeft = rect.right + CUSTOM_COLOR_PANEL_GAP - CUSTOM_COLOR_PANEL_LEFT_SHIFT;
  const left = Math.min(
    Math.max(viewportPadding, preferredLeft),
    window.innerWidth - panelWidth - viewportPadding,
  );
  const top = Math.max(viewportPadding, Math.min(preferredTop, maxTop));

  customColorPanelStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(panelWidth)}px`,
  };
}

function openCustomColorPicker(kind: DesktopCustomColorKind, event: MouseEvent) {
  const anchor = event.currentTarget as HTMLElement | null;
  activeCustomColorKind.value = kind;
  syncCustomPickerFromColor(getDesktopCustomColor(kind));
  localSettings.value.colorScheme = 'custom';
  if (anchor) {
    updateCustomColorPanelPosition(anchor);
  }
}

function applyCustomPickerColor() {
  if (!activeCustomColorKind.value) return;
  setDesktopCustomColor(activeCustomColorKind.value, customPickerColor.value);
}

function setCustomPickerHue(value: number | string) {
  const nextHue = typeof value === 'string' ? Number(value) : value;
  customPickerHue.value = Number.isFinite(nextHue) ? Math.min(359, Math.max(0, Math.round(nextHue))) : 0;
  applyCustomPickerColor();
}

function updateCustomPickerArea(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  customPickerSaturation.value = clampPercent(((event.clientX - rect.left) / rect.width) * 100);
  customPickerValue.value = clampPercent(100 - ((event.clientY - rect.top) / rect.height) * 100);
  applyCustomPickerColor();
}

function dragCustomPickerArea(event: PointerEvent) {
  if (event.buttons !== 1) return;
  updateCustomPickerArea(event);
}

function setCustomPickerRgb(channel: 'r' | 'g' | 'b', value: number | string) {
  const rgb = customPickerRgb.value;
  const next = {
    ...rgb,
    [channel]: clampRgb(typeof value === 'string' ? Number(value) : value),
  };
  syncCustomPickerFromColor(rgbToHex(next.r, next.g, next.b));
  applyCustomPickerColor();
}

function openCustomColorModal() {
  localSettings.value.colorScheme = 'custom';
  activeCustomColorKind.value = null;
  isCustomColorModalOpen.value = true;
}

function closeCustomColorModal() {
  isCustomColorModalOpen.value = false;
  activeCustomColorKind.value = null;
}

function resetLyricsSyncOffset() {
  lyricsSyncOffsetMs.value = 0;
}

function updateFontPresetMenuPosition() {
  const trigger = fontPresetTriggerRef.value;
  if (!trigger) return;

  const rect = trigger.getBoundingClientRect();
  const viewportPadding = 16;
  const gap = 10;
  const preferredWidth = Math.max(rect.width, 320);
  const menuWidth = Math.min(preferredWidth, window.innerWidth - viewportPadding * 2);

  let left = rect.right - menuWidth;
  left = Math.min(left, window.innerWidth - viewportPadding - menuWidth);
  left = Math.max(viewportPadding, left);

  const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
  const availableAbove = rect.top - viewportPadding;
  const shouldOpenUpward = availableBelow < 220 && availableAbove > availableBelow;
  const availableHeight = shouldOpenUpward ? availableAbove : availableBelow;
  const maxHeight = Math.max(180, Math.min(360, availableHeight - gap));

  fontPresetMenuStyle.value = shouldOpenUpward
    ? {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        bottom: `${Math.round(window.innerHeight - rect.top + gap)}px`,
        width: `${Math.round(menuWidth)}px`,
        maxHeight: `${Math.round(maxHeight)}px`,
      }
    : {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        top: `${Math.round(rect.bottom + gap)}px`,
        width: `${Math.round(menuWidth)}px`,
        maxHeight: `${Math.round(maxHeight)}px`,
      };
}

async function toggleFontPresetMenu() {
  isFontPresetMenuOpen.value = !isFontPresetMenuOpen.value;

  if (!isFontPresetMenuOpen.value) return;

  await nextTick();
  updateFontPresetMenuPosition();

  const activeItem = fontPresetMenuRef.value?.querySelector('.desktop-font-option--active') as HTMLElement | null;
  activeItem?.scrollIntoView({ block: 'nearest' });
}

async function resetDesktopLyricsWindowBounds() {
  if (isResettingWindowBounds.value) return;

  isResettingWindowBounds.value = true;
  try {
    await emit(DESKTOP_LYRICS_RESET_BOUNDS_EVENT);
  } finally {
    isResettingWindowBounds.value = false;
  }
}

function closeFontPresetMenu() {
  isFontPresetMenuOpen.value = false;
}

function selectDesktopFontPreset(value: LyricsFontPreset) {
  setDesktopFontPreset(value);
  closeFontPresetMenu();
}

function handlePointerDownOutside(event: MouseEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (fontPresetFieldRef.value?.contains(target)) return;
  if (fontPresetMenuRef.value?.contains(target)) return;
  if (customColorPanelRef.value?.contains(target)) return;
  if ((target as Element | null)?.closest?.('.desktop-color-input-shell')) return;

  activeCustomColorKind.value = null;
  closeFontPresetMenu();
}

function handleWindowEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeFontPresetMenu();
    closeCustomColorModal();
  }
}

function handleViewportChange() {
  if (isFontPresetMenuOpen.value) {
    updateFontPresetMenuPosition();
  }
}

onMounted(() => {
  if (typeof document !== 'undefined') {
    previewBgMode.value = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  }
  window.addEventListener('mousedown', handlePointerDownOutside);
  window.addEventListener('keydown', handleWindowEscape);
  window.addEventListener('resize', handleViewportChange);
  document.addEventListener('scroll', handleViewportChange, true);
  void loadSystemLyricsFonts();
});

onUnmounted(() => {
  window.removeEventListener('mousedown', handlePointerDownOutside);
  window.removeEventListener('keydown', handleWindowEscape);
  window.removeEventListener('resize', handleViewportChange);
  document.removeEventListener('scroll', handleViewportChange, true);
});
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        显示与行为
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.isAlwaysOnTop = !desktopLyricsSettings.isAlwaysOnTop"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">窗口置顶</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.isAlwaysOnTop ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.isAlwaysOnTop ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.alwaysShowShadowBackground = !desktopLyricsSettings.alwaysShowShadowBackground"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">始终显示阴影背景</div>
          </div>
          <span
            class="desktop-switch"
            :class="desktopLyricsSettings.alwaysShowShadowBackground ? 'desktop-switch--on' : ''"
          >
            <span
              class="desktop-switch-thumb"
              :class="desktopLyricsSettings.alwaysShowShadowBackground ? 'translate-x-5' : ''"
            />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.autoHideWhenFullscreen = !desktopLyricsSettings.autoHideWhenFullscreen"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">全屏时自动隐藏</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.autoHideWhenFullscreen ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.autoHideWhenFullscreen ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.autoHideWhenPaused = !desktopLyricsSettings.autoHideWhenPaused"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">暂停时自动隐藏</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.autoHideWhenPaused ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.autoHideWhenPaused ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.enableWordEffect = !desktopLyricsSettings.enableWordEffect"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">逐字效果</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.enableWordEffect ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.enableWordEffect ? 'translate-x-5' : ''" />
          </span>
        </button>



        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.isLocked = !desktopLyricsSettings.isLocked"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">锁定位置并启用鼠标穿透</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.isLocked ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.isLocked ? 'translate-x-5' : ''" />
          </span>
        </button>

        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.persistLock = !desktopLyricsSettings.persistLock"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">记住锁定状态</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.persistLock ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.persistLock ? 'translate-x-5' : ''" />
          </span>
        </button>



        <div class="desktop-setting-row">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">重置窗口位置</div>
          </div>
          <button
            type="button"
            class="desktop-action-button"
            :disabled="isResettingWindowBounds"
            @click="resetDesktopLyricsWindowBounds"
          >
            {{ isResettingWindowBounds ? '重置中...' : '重置' }}
          </button>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        歌词同步
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <button
          type="button"
          class="desktop-setting-row"
          @click="showLyricsSyncOffsetPanel = !showLyricsSyncOffsetPanel"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">同步偏移</div>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="rounded-full bg-[#EC4141]/10 px-3 py-1 text-xs font-medium text-[#EC4141] tabular-nums">
              {{ lyricsSyncOffsetLabel }}
            </div>
            <ChevronDown
              :size="16"
              class="text-gray-400 transition-transform duration-200 dark:text-white/45"
              :class="showLyricsSyncOffsetPanel ? 'rotate-180 text-[#EC4141]' : ''"
            />
          </div>
        </button>

        <transition name="desktop-expand-panel">
          <div v-if="showLyricsSyncOffsetPanel" class="desktop-setting-expand">
            <div class="desktop-setting-expand-inner">
              <div class="text-xs text-gray-600 dark:text-white/60">
                正值让歌词更晚显示，负值让歌词更早显示。用于修正不同输出设备的播放缓冲差异，默认值为 0 ms。
              </div>

              <div class="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
                <input
                  v-model="lyricsSyncOffsetMs"
                  type="range"
                  min="-1000"
                  max="1000"
                  step="10"
                  class="desktop-slider flex-1"
                />
                <div class="flex items-center gap-3">
                  <input
                    v-model="lyricsSyncOffsetMs"
                    type="number"
                    min="-1000"
                    max="1000"
                    step="10"
                    class="w-28 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
                  />
                  <button
                    type="button"
                    class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition hover:border-[#EC4141] hover:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
                    @click="resetLyricsSyncOffset"
                  >
                    重置
                  </button>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        排版与字体
      </h2>

      <!-- 桌面歌词排版效果预览区 (回归单栏顶部，与下方紧凑滑块同视口呈现) -->
      <div class="desktop-lyrics-preview-container select-none">
        <div class="desktop-lyrics-preview-header">
          <div class="text-xs font-semibold text-gray-500 dark:text-gray-400">效果实时预览</div>
          <div class="flex items-center gap-2">
            <!-- 深浅色预览背景切换按钮 -->
            <button
              type="button"
              class="desktop-preview-btn desktop-preview-btn--theme flex items-center gap-1.5"
              :title="previewBgMode === 'dark' ? '切换至浅色预览背景' : '切换至深色预览背景'"
              @click="previewBgMode = previewBgMode === 'dark' ? 'light' : 'dark'"
            >
              <Sun v-if="previewBgMode === 'dark'" :size="14" />
              <Moon v-else :size="14" />
              <span>{{ previewBgMode === 'dark' ? '浅色背景' : '深色背景' }}</span>
            </button>
            <button
              type="button"
              class="desktop-preview-btn desktop-preview-btn--cancel"
              :class="!isModified ? 'opacity-50 cursor-not-allowed' : ''"
              :disabled="!isModified"
              @click="cancelChanges"
            >
              取消修改
            </button>
            <button
              type="button"
              class="desktop-preview-btn"
              :class="isModified ? 'desktop-preview-btn--apply' : 'desktop-preview-btn--cancel opacity-50 cursor-not-allowed'"
              :disabled="!isModified"
              @click="applyChanges"
            >
              应用到桌面歌词
            </button>
            <button
              type="button"
              class="desktop-preview-btn desktop-preview-btn--default"
              @click="resetToDefault"
            >
              恢复默认
            </button>
          </div>
        </div>

        <div
          class="desktop-lyrics-preview-card"
          :class="'desktop-lyrics-preview-card--' + previewBgMode"
          :style="previewWidgetStyle"
        >
          <div class="desktop-lyrics-preview-body" :style="previewLyricsPlayerStyle" :class="previewLyricsAlignmentClass">
            <div class="desktop-lyric-block">
              <!-- 第一行 正在播放 -->
              <div class="desktop-lyric-row desktop-lyric-row--active">
                <div class="desktop-lyric-main">
                  <span class="desktop-lyric-word" :class="{ 'desktop-lyric-word--with-romaji': lyricsSettings.showRomaji }">
                    <span class="desktop-lyric-word-main" :style="playedWordStyle">初めての</span>
                    <span v-if="lyricsSettings.showRomaji" class="desktop-lyric-word-romaji" :style="playedRomajiWordStyle">ha ji me te no</span>
                  </span>
                  <span class="desktop-lyric-word" :class="{ 'desktop-lyric-word--with-romaji': lyricsSettings.showRomaji }">
                    <span class="desktop-lyric-word-main" :style="activeWordStyle">ルーブル</span>
                    <span v-if="lyricsSettings.showRomaji" class="desktop-lyric-word-romaji" :style="activeRomajiWordStyle">ru u bu ru</span>
                  </span>
                  <span class="desktop-lyric-word" :class="{ 'desktop-lyric-word--with-romaji': lyricsSettings.showRomaji }">
                    <span class="desktop-lyric-word-main" :style="unplayedWordStyle">は</span>
                    <span v-if="lyricsSettings.showRomaji" class="desktop-lyric-word-romaji" :style="unplayedRomajiWordStyle">wa</span>
                  </span>
                </div>
                <div v-if="lyricsSettings.showTranslation" class="desktop-lyric-sub desktop-lyric-sub--translation">
                  第一次参观卢浮宫
                </div>
              </div>

              <!-- 第二行 模拟双行显示 (当开启双行且未激活时展示) -->
              <div v-if="desktopLyricsSettings.showDoubleLine" class="desktop-lyric-row desktop-lyric-row--inactive desktop-lyric-row--second-line">
                <div class="desktop-lyric-main desktop-lyric-main--inactive">
                  <span class="desktop-lyric-word" :class="{ 'desktop-lyric-word--with-romaji': lyricsSettings.showRomaji }">
                    <span class="desktop-lyric-word-main" :style="unplayedWordStyle">どうせ私なんかと</span>
                    <span v-if="lyricsSettings.showRomaji" class="desktop-lyric-word-romaji" :style="unplayedRomajiWordStyle">do u se wa ta shi na n ka to</span>
                  </span>
                </div>
                <div v-if="lyricsSettings.showTranslation" class="desktop-lyric-sub desktop-lyric-sub--translation">
                  反正像我这样的人
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 网易云式：极致紧凑控制面板 -->
      <div class="desktop-typography-panel desktop-typography-panel--compact">
        <!-- 行一：字号 & 行距 -->
        <div class="desktop-compact-row">
          <!-- 字号 -->
          <div class="desktop-compact-slider-cell">
            <div class="desktop-compact-label shrink-0 text-left">字号</div>
            <input
              v-model.number="localSettings.playerFontScale"
              type="range"
              min="0.50"
              max="3.00"
              step="0.05"
              aria-label="字号"
              class="desktop-compact-range-slider"
            />
            <span class="desktop-compact-value-label text-right font-mono text-[13px] font-bold text-gray-700 dark:text-gray-300">
              {{ Math.round(localSettings.playerFontScale * 100) }}%
            </span>
          </div>
          <!-- 行距 -->
          <div class="desktop-compact-slider-cell">
            <div class="desktop-compact-label shrink-0 text-left">行距</div>
            <input
              v-model.number="localSettings.playerLineGap"
              type="range"
              min="0.50"
              max="3.00"
              step="0.05"
              aria-label="行距"
              class="desktop-compact-range-slider"
            />
            <span class="desktop-compact-value-label text-right font-mono text-[13px] font-bold text-gray-700 dark:text-gray-300">
              {{ Math.round(localSettings.playerLineGap * 100) }}%
            </span>
          </div>
        </div>


        <!-- 行三：文字不透明度 & 描边阴影 -->
        <div class="desktop-compact-row">
          <!-- 文字不透明度 -->
          <div class="desktop-compact-slider-cell">
            <div class="desktop-compact-label shrink-0 text-left">不透明度</div>
            <input
              v-model.number="localSettings.textOpacity"
              type="range"
              min="0.10"
              max="1.00"
              step="0.05"
              aria-label="不透明度"
              class="desktop-compact-range-slider"
            />
            <span class="desktop-compact-value-label text-right font-mono text-[13px] font-bold text-gray-700 dark:text-gray-300">
              {{ Math.round(localSettings.textOpacity * 100) }}%
            </span>
          </div>
          <!-- 描边阴影 -->
          <div class="desktop-compact-slider-cell">
            <div class="desktop-compact-label shrink-0 text-left">描边阴影</div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              :value="localSettings.firstLineTextShadowStrength"
              @input="setDesktopTextShadowStrength(Number(($event.target as HTMLInputElement).value))"
              aria-label="描边阴影"
              class="desktop-compact-range-slider"
            />
            <span class="desktop-compact-value-label text-right font-mono text-[13px] font-bold text-gray-700 dark:text-gray-300">
              {{ localSettings.firstLineTextShadowStrength }}
            </span>
          </div>
        </div>

        <!-- 行四：阴影颜色 & 对齐方式 -->
        <div class="desktop-compact-row">
          <!-- 阴影颜色 -->
          <div class="desktop-compact-cell flex items-center justify-between">
            <div class="desktop-compact-label">阴影颜色</div>
            <div class="desktop-compact-selector-shadow flex items-center gap-1.5">
              <button
                v-for="preset in SHADOW_COLOR_PRESETS"
                :key="preset.value"
                type="button"
                class="desktop-compact-color-preset"
                :class="{ 'desktop-compact-color-preset--active': localSettings.textShadowColor === preset.value }"
                :style="{ backgroundColor: preset.value }"
                :title="'切换阴影颜色: ' + preset.label"
                @click="setDesktopTextShadowColor(preset.value)"
              />
              <label
                class="desktop-compact-color-custom flex items-center justify-center cursor-pointer"
                :class="{ 'desktop-compact-color-custom--active': isCustomShadowColor }"
                title="自定义阴影颜色"
              >
                <input
                  type="color"
                  :value="localSettings.textShadowColor"
                  aria-label="自定义阴影颜色"
                  @input="setDesktopTextShadowColor(($event.target as HTMLInputElement).value)"
                >
                <span class="desktop-compact-color-custom-swatch" :style="{ backgroundColor: localSettings.textShadowColor }" />
              </label>
            </div>
          </div>
          <!-- 对齐方式 (Segmented Control) -->
          <div class="desktop-compact-cell flex items-center justify-between">
            <div class="desktop-compact-label shrink-0">对齐</div>
            <div class="desktop-segmented-control flex overflow-hidden rounded-xl border border-gray-200 bg-white/40 dark:border-white/10 dark:bg-white/5">
              <button
                v-for="option in ALIGNMENT_OPTIONS"
                :key="option.value"
                type="button"
                class="desktop-segmented-btn text-center text-xs font-semibold py-1.5 px-3 transition-all"
                :class="localSettings.playerAlignment === option.value ? 'desktop-segmented-btn--active' : ''"
                @click="setDesktopAlignment(option.value)"
              >
                {{ option.label.replace('靠', '').replace('居', '') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 行五：显示翻译 & 显示罗马音 -->
        <div class="desktop-compact-row">
          <div class="desktop-compact-cell flex items-center justify-between">
            <div class="desktop-compact-label shrink-0">显示翻译</div>
            <div class="desktop-segmented-control flex overflow-hidden rounded-xl border border-gray-200 bg-white/40 dark:border-white/10 dark:bg-white/5">
              <button
                v-if="lyricsSettings.showTranslation"
                type="button"
                class="desktop-segmented-btn desktop-segmented-btn--active text-center text-xs font-semibold py-1.5 px-3 transition-all animate-fade-in"
                @click="lyricsSettings.showTranslation = false"
              >
                开
              </button>
              <button
                v-else
                type="button"
                class="desktop-segmented-btn text-center text-xs font-semibold py-1.5 px-3 transition-all animate-fade-in"
                @click="lyricsSettings.showTranslation = true"
              >
                关
              </button>
            </div>
          </div>
          <div class="desktop-compact-cell flex items-center justify-between">
            <div class="desktop-compact-label shrink-0">显示罗马音</div>
            <div class="desktop-segmented-control flex overflow-hidden rounded-xl border border-gray-200 bg-white/40 dark:border-white/10 dark:bg-white/5">
              <button
                v-if="lyricsSettings.showRomaji"
                type="button"
                class="desktop-segmented-btn desktop-segmented-btn--active text-center text-xs font-semibold py-1.5 px-3 transition-all animate-fade-in"
                @click="lyricsSettings.showRomaji = false"
              >
                开
              </button>
              <button
                v-else
                type="button"
                class="desktop-segmented-btn text-center text-xs font-semibold py-1.5 px-3 transition-all animate-fade-in"
                @click="lyricsSettings.showRomaji = true"
              >
                关
              </button>
            </div>
          </div>
        </div>

        <!-- 行六：双行显示 & 字体方案 -->
        <div class="desktop-compact-row">
          <div class="desktop-compact-cell flex items-center justify-between">
            <div class="desktop-compact-label shrink-0">双行显示</div>
            <div class="desktop-segmented-control flex overflow-hidden rounded-xl border border-gray-200 bg-white/40 dark:border-white/10 dark:bg-white/5">
              <button
                v-if="desktopLyricsSettings.showDoubleLine"
                type="button"
                class="desktop-segmented-btn desktop-segmented-btn--active text-center text-xs font-semibold py-1.5 px-3 transition-all animate-fade-in"
                @click="desktopLyricsSettings.showDoubleLine = false"
              >
                开
              </button>
              <button
                v-else
                type="button"
                class="desktop-segmented-btn text-center text-xs font-semibold py-1.5 px-3 transition-all animate-fade-in"
                @click="desktopLyricsSettings.showDoubleLine = true"
              >
                关
              </button>
            </div>
          </div>

          <div class="desktop-compact-cell flex items-center justify-between gap-4">
            <div class="desktop-compact-label shrink-0">字体方案</div>
            <div ref="fontPresetFieldRef" class="desktop-font-picker flex-1 min-w-0">
              <button
                ref="fontPresetTriggerRef"
                type="button"
                class="desktop-font-trigger desktop-font-trigger--compact flex items-center justify-between w-full"
                :class="isFontPresetMenuOpen ? 'desktop-font-trigger--open' : ''"
                @click="toggleFontPresetMenu"
              >
                <span class="truncate text-[14px] font-semibold text-gray-800 dark:text-gray-100 flex-1 text-right mr-1.5" :style="{ fontFamily: selectedFontFamily }">
                  {{ selectedFontLabel }}
                </span>
                <ChevronDown :size="14" class="text-gray-400 shrink-0" />
              </button>

              <Teleport to="body">
                <transition name="desktop-font-menu">
                  <div
                    v-if="isFontPresetMenuOpen"
                    ref="fontPresetMenuRef"
                    class="desktop-font-menu"
                    :style="fontPresetMenuStyle"
                    @click.stop
                    @mousedown.stop
                  >
                    <div class="desktop-font-menu-header">
                      <span>字体方案</span>
                      <span>{{ availableFontOptions.length }} 项</span>
                    </div>
                    <div class="desktop-font-menu-list custom-scrollbar">
                      <button
                        v-for="option in availableFontOptions"
                        :key="option.value"
                        type="button"
                        class="desktop-font-option"
                        :class="localSettings.playerFontPreset === option.value ? 'desktop-font-option--active' : ''"
                        @click="selectDesktopFontPreset(option.value)"
                      >
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-sm font-semibold" :style="{ fontFamily: option.fontFamily }">
                            {{ option.label }}
                          </div>
                        </div>
                        <Check
                          v-if="localSettings.playerFontPreset === option.value"
                          :size="16"
                          class="shrink-0 text-[#EC4141]"
                        />
                      </button>
                    </div>
                  </div>
                </transition>
              </Teleport>
            </div>
          </div>
        </div>

        <!-- 行七：配色方案 (独占一行，展示小圆点 Preset，极致美观与对称) -->
        <div class="desktop-compact-row-full">
          <div class="desktop-compact-cell w-full flex items-center justify-between gap-4">
            <div class="desktop-compact-label shrink-0">配色方案</div>
            <div class="desktop-compact-selector-scheme flex items-center gap-1.5">
              <button
                v-for="option in COLOR_SCHEME_OPTIONS"
                :key="option.value"
                type="button"
                class="desktop-compact-color-preset"
                :class="{
                  'desktop-compact-color-preset--active': localSettings.colorScheme === option.value,
                  'desktop-compact-color-preset--custom': option.value === 'custom',
                  'desktop-compact-color-preset--auto': option.value === 'auto'
                }"
                :style="option.value !== 'custom' && option.value !== 'auto' ? { backgroundColor: option.color } : {}"
                :title="'切换配色方案: ' + option.label"
                @click="selectDesktopColorScheme(option.value)"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <transition name="desktop-custom-modal">
        <div
          v-if="isCustomColorModalOpen"
          class="desktop-custom-modal-backdrop"
          @click.self="closeCustomColorModal"
        >
          <div class="desktop-custom-modal" role="dialog" aria-modal="true" aria-label="自定义桌面歌词配色">
            <div class="desktop-custom-color-row">
              <div
                class="desktop-color-picker"
                :class="{ 'desktop-color-picker--active': activeCustomColorKind === 'played' }"
              >
                <span>主歌词 已播放</span>
                <button
                  type="button"
                  class="desktop-color-input-shell"
                  aria-label="主歌词 已播放"
                  @click="openCustomColorPicker('played', $event)"
                >
                  <span class="desktop-color-swatch" :style="{ backgroundColor: localSettings.customPlayedColor }"></span>
                </button>
              </div>
              <div
                class="desktop-color-picker"
                :class="{ 'desktop-color-picker--active': activeCustomColorKind === 'unplayed' }"
              >
                <span>主歌词 未播放</span>
                <button
                  type="button"
                  class="desktop-color-input-shell"
                  aria-label="主歌词 未播放"
                  @click="openCustomColorPicker('unplayed', $event)"
                >
                  <span class="desktop-color-swatch" :style="{ backgroundColor: localSettings.customUnplayedColor }"></span>
                </button>
              </div>
              <div
                class="desktop-color-picker"
                :class="{ 'desktop-color-picker--active': activeCustomColorKind === 'romajiPlayed' }"
              >
                <span>罗马音 已播放</span>
                <button
                  type="button"
                  class="desktop-color-input-shell"
                  aria-label="罗马音 已播放"
                  @click="openCustomColorPicker('romajiPlayed', $event)"
                >
                  <span class="desktop-color-swatch" :style="{ backgroundColor: localSettings.customRomajiPlayedColor }"></span>
                </button>
              </div>
              <div
                class="desktop-color-picker"
                :class="{ 'desktop-color-picker--active': activeCustomColorKind === 'romajiUnplayed' }"
              >
                <span>罗马音 未播放</span>
                <button
                  type="button"
                  class="desktop-color-input-shell"
                  aria-label="罗马音 未播放"
                  @click="openCustomColorPicker('romajiUnplayed', $event)"
                >
                  <span class="desktop-color-swatch" :style="{ backgroundColor: localSettings.customRomajiUnplayedColor }"></span>
                </button>
              </div>
              <div
                class="desktop-color-picker"
                :class="{ 'desktop-color-picker--active': activeCustomColorKind === 'translation' }"
              >
                <span>翻译</span>
                <button
                  type="button"
                  class="desktop-color-input-shell"
                  aria-label="翻译"
                  @click="openCustomColorPicker('translation', $event)"
                >
                  <span class="desktop-color-swatch" :style="{ backgroundColor: localSettings.customTranslationColor }"></span>
                </button>
              </div>
            </div>

            <div
              v-if="activeCustomColorKind"
              ref="customColorPanelRef"
              class="desktop-custom-color-panel"
              :style="customColorPanelStyle"
            >
              <div class="desktop-custom-color-panel-title">{{ activeCustomColorLabel }}</div>
              <div
                class="desktop-custom-color-area"
                :style="{ backgroundColor: customPickerHueColor }"
                @pointerdown="updateCustomPickerArea"
                @pointermove="dragCustomPickerArea"
              >
                <span
                  class="desktop-custom-color-thumb"
                  :style="{
                    left: `${customPickerSaturation}%`,
                    top: `${100 - customPickerValue}%`,
                  }"
                ></span>
              </div>
              <div class="desktop-custom-hue-row">
                <span class="desktop-custom-current-color" :style="{ backgroundColor: customPickerColor }"></span>
                <input
                  class="desktop-custom-hue-slider"
                  type="range"
                  min="0"
                  max="359"
                  :value="customPickerHue"
                  aria-label="色相"
                  @input="setCustomPickerHue(($event.target as HTMLInputElement).value)"
                >
              </div>
              <div class="desktop-custom-rgb-row">
                <label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    :value="customPickerRgb.r"
                    @input="setCustomPickerRgb('r', ($event.target as HTMLInputElement).value)"
                  >
                  <span>R</span>
                </label>
                <label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    :value="customPickerRgb.g"
                    @input="setCustomPickerRgb('g', ($event.target as HTMLInputElement).value)"
                  >
                  <span>G</span>
                </label>
                <label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    :value="customPickerRgb.b"
                    @input="setCustomPickerRgb('b', ($event.target as HTMLInputElement).value)"
                  >
                  <span>B</span>
                </label>
              </div>
            </div>

            <div ref="customPreviewRef" class="desktop-custom-preview">
              <div class="desktop-custom-preview-line">
                <span :style="customPreviewPlayedStyle">初めての</span>
                <span :style="customPreviewCurrentStyle">ルーブル</span>
                <span :style="customPreviewUnplayedStyle">は</span>
              </div>
              <div v-if="lyricsSettings.showRomaji" class="desktop-custom-preview-sub">
                <span :style="customPreviewRomajiPlayedStyle">ha ji me te no</span>
                <span :style="customPreviewRomajiCurrentStyle">ru u bu ru</span>
                <span :style="customPreviewRomajiUnplayedStyle">wa</span>
              </div>
              <div v-if="lyricsSettings.showTranslation" class="desktop-custom-preview-sub desktop-custom-preview-translation" :style="customPreviewTranslationStyle">
                第一次参观卢浮宫
              </div>
            </div>

            <div class="desktop-custom-modal-actions">
              <button type="button" class="desktop-action-button desktop-custom-done-button" @click="closeCustomColorModal">完成</button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

  </div>
</template>

<style scoped>
:root {
  /* 桌面歌词设置组件 - 浅色模式 CSS 变量 */
  --desktop-chip-bg: rgba(255, 255, 255, 0.72);
  --desktop-chip-border: rgba(15, 23, 42, 0.08);
  --desktop-chip-text: rgb(55 65 81);

  --desktop-chip-active-bg: rgba(236, 65, 65, 0.12);
  --desktop-chip-active-border: rgba(236, 65, 65, 0.28);
  --desktop-chip-active-text: #ec4141;

  --desktop-font-trigger-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.68));
  --desktop-font-trigger-border: rgba(148, 163, 184, 0.2);
  --desktop-font-trigger-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 10px 26px rgba(15, 23, 42, 0.05);

  --desktop-font-trigger-active-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 244, 244, 0.78));
  --desktop-font-trigger-active-border: rgba(236, 65, 65, 0.32);
  --desktop-font-trigger-active-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 14px 30px rgba(236, 65, 65, 0.08);

  --desktop-font-menu-bg: rgba(255, 255, 255, 0.88);
  --desktop-font-menu-border: rgba(255, 255, 255, 0.5);
  --desktop-font-menu-shadow: 0 24px 60px rgba(15, 23, 42, 0.16), 0 10px 24px rgba(15, 23, 42, 0.08);
  --desktop-font-menu-header-color: rgba(71, 85, 105, 0.92);
  --desktop-font-menu-header-border: rgba(148, 163, 184, 0.12);

  --desktop-font-option-text: rgb(55 65 81);
  --desktop-font-option-hover-bg: rgba(236, 65, 65, 0.06);
  --desktop-font-option-hover-border: rgba(236, 65, 65, 0.16);
  --desktop-font-option-hover-text: rgb(17 24 39);

  --desktop-font-option-active-bg: linear-gradient(180deg, rgba(236, 65, 65, 0.12), rgba(236, 65, 65, 0.06));
  --desktop-font-option-active-border: rgba(236, 65, 65, 0.2);
  --desktop-font-option-active-text: #ec4141;
}

:global(.dark) {
  /* 桌面歌词设置组件 - 深色模式 CSS 变量重写 */
  --desktop-chip-bg: rgba(255, 255, 255, 0.04);
  --desktop-chip-border: rgba(255, 255, 255, 0.08);
  --desktop-chip-text: rgba(255, 255, 255, 0.82);

  --desktop-chip-active-bg: rgba(236, 65, 65, 0.14);
  --desktop-chip-active-border: rgba(236, 65, 65, 0.35);
  --desktop-chip-active-text: #ff8b8b;

  --desktop-font-trigger-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.04));
  --desktop-font-trigger-border: rgba(255, 255, 255, 0.08);
  --desktop-font-trigger-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 12px 28px rgba(0, 0, 0, 0.18);

  --desktop-font-trigger-active-bg: linear-gradient(180deg, rgba(236, 65, 65, 0.16), rgba(255, 255, 255, 0.05));
  --desktop-font-trigger-active-border: rgba(236, 65, 65, 0.34);
  --desktop-font-trigger-active-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 16px 36px rgba(0, 0, 0, 0.24);

  --desktop-font-menu-bg: rgba(17, 17, 19, 0.88);
  --desktop-font-menu-border: rgba(255, 255, 255, 0.08);
  --desktop-font-menu-shadow: 0 24px 60px rgba(0, 0, 0, 0.34), 0 10px 24px rgba(0, 0, 0, 0.24);
  --desktop-font-menu-header-color: rgba(255, 255, 255, 0.58);
  --desktop-font-menu-header-border: rgba(255, 255, 255, 0.06);

  --desktop-font-option-text: rgba(255, 255, 255, 0.84);
  --desktop-font-option-hover-bg: rgba(236, 65, 65, 0.1);
  --desktop-font-option-hover-border: rgba(236, 65, 65, 0.22);
  --desktop-font-option-hover-text: rgba(255, 255, 255, 0.98);

  --desktop-font-option-active-bg: linear-gradient(180deg, rgba(236, 65, 65, 0.18), rgba(236, 65, 65, 0.08));
  --desktop-font-option-active-border: rgba(236, 65, 65, 0.28);
  --desktop-font-option-active-text: #ff9a9a;
}

.desktop-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.16);
  text-align: left;
  transition: background-color 160ms ease;
}

.desktop-setting-row:last-child {
  border-bottom: 0;
}

.desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.4);
}

:global(.dark) .desktop-setting-row {
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

:global(.dark) .desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.08);
}

.desktop-typography-panel {
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
}

.desktop-setting-expand {
  overflow: hidden;
  border-top: 1px solid rgba(255, 255, 255, 0.16);
}

.desktop-setting-expand-inner {
  padding: 16px;
}

:global(.dark) .desktop-setting-expand {
  border-top-color: rgba(255, 255, 255, 0.05);
}

.desktop-typography-row {
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.16);
  transition: background-color 160ms ease;
}

.desktop-typography-row:last-child {
  border-bottom: 0;
}

.desktop-typography-row:hover {
  background: rgba(255, 255, 255, 0.4);
}

:global(.dark) .desktop-typography-row {
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

:global(.dark) .desktop-typography-row:hover {
  background: rgba(255, 255, 255, 0.08);
}

.desktop-typography-row--inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.desktop-inline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.desktop-inline-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.desktop-inline-value {
  color: #ec4141;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
}

.desktop-inline-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid rgba(236, 65, 65, 0.16);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
  flex-shrink: 0;
  line-height: 0;
}

.desktop-inline-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.desktop-switch {
  display: inline-flex;
  align-items: center;
  width: 44px;
  height: 24px;
  padding: 2px;
  border-radius: 999px;
  background: rgb(209 213 219);
  transition: background-color 160ms ease;
  flex-shrink: 0;
}

.desktop-switch--on {
  background: #ec4141;
}

:global(.dark) .desktop-switch {
  background: rgb(55 65 81);
}

:global(.dark) .desktop-switch--on {
  background: #ec4141;
}

.desktop-switch-thumb {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18);
  transition: transform 160ms ease;
}

.desktop-card {
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.55);
  padding: 18px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}

:global(.dark) .desktop-card {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.2);
}

.desktop-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.desktop-card-value {
  margin-top: 14px;
  color: #ec4141;
  font-size: 1.4rem;
  font-weight: 700;
  line-height: 1;
}

.desktop-font-picker {
  position: relative;
}

.desktop-font-picker--inline {
  width: min(185px, 100%);
  flex-shrink: 0;
}

.desktop-font-trigger {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 64px;
  padding: 14px 16px;
  border: 1px solid var(--desktop-font-trigger-border);
  border-radius: 18px;
  background: var(--desktop-font-trigger-bg);
  box-shadow: var(--desktop-font-trigger-shadow);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease,
    transform 180ms ease;
}

.desktop-font-trigger--compact {
  min-height: 36px;
  padding: 7px 10px;
  border-radius: 10px;
  gap: 8px;
}

.desktop-font-trigger:hover,
.desktop-font-trigger--open {
  border-color: var(--desktop-font-trigger-active-border);
  box-shadow: var(--desktop-font-trigger-active-shadow);
}

.desktop-font-trigger--open {
  background: var(--desktop-font-trigger-active-bg);
}

.desktop-font-menu {
  overflow: hidden;
  border: 1px solid var(--desktop-font-menu-border);
  border-radius: 20px;
  background: var(--desktop-font-menu-bg);
  box-shadow: var(--desktop-font-menu-shadow);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  z-index: 120;
}

.desktop-font-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--desktop-font-menu-header-border);
  color: var(--desktop-font-menu-header-color);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.desktop-font-menu-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
}

.desktop-font-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 16px;
  text-align: left;
  color: var(--desktop-font-option-text);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.desktop-font-option:hover {
  border-color: var(--desktop-font-option-hover-border);
  background: var(--desktop-font-option-hover-bg);
  color: var(--desktop-font-option-hover-text);
}

.desktop-font-option--active {
  border-color: var(--desktop-font-option-active-border);
  background: var(--desktop-font-option-active-bg);
  color: var(--desktop-font-option-active-text);
}

.desktop-font-menu-enter-active,
.desktop-font-menu-leave-active {
  transition: opacity 180ms ease, transform 200ms ease;
  transform-origin: top center;
}

.desktop-font-menu-enter-from,
.desktop-font-menu-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

.desktop-expand-panel-enter-active,
.desktop-expand-panel-leave-active {
  transition:
    opacity 200ms ease,
    transform 220ms ease,
    max-height 220ms ease;
  transform-origin: top center;
  overflow: hidden;
}

.desktop-expand-panel-enter-from,
.desktop-expand-panel-leave-to {
  opacity: 0;
  transform: translateY(-10px) scaleY(0.96);
  max-height: 0;
}

.desktop-expand-panel-enter-to,
.desktop-expand-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scaleY(1);
  max-height: 260px;
}

.desktop-slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.desktop-mini-button,
.desktop-inline-reset,
.desktop-reset-button,
.desktop-action-button,
.desktop-chip {
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
}

.desktop-mini-button {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 1px solid rgba(236, 65, 65, 0.14);
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
  font-size: 16px;
}

.desktop-mini-button:hover,
.desktop-inline-reset:hover,
.desktop-reset-button:hover,
.desktop-chip:hover {
  border-color: rgba(236, 65, 65, 0.38);
  background: rgba(236, 65, 65, 0.1);
}

.desktop-reset-button {
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.06);
  padding: 6px 10px;
  color: #ec4141;
  font-size: 12px;
}

.desktop-action-button {
  flex-shrink: 0;
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.06);
  padding: 8px 14px;
  color: #ec4141;
  font-size: 12px;
}

.desktop-action-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.desktop-chip {
  border: 1px solid var(--desktop-chip-border);
  border-radius: 999px;
  background: var(--desktop-chip-bg);
  padding: 8px 14px;
  color: var(--desktop-chip-text);
  font-size: 13px;
}

.desktop-chip--active {
  border-color: var(--desktop-chip-active-border);
  background: var(--desktop-chip-active-bg);
  color: var(--desktop-chip-active-text);
  font-weight: 600;
}

.desktop-custom-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.desktop-custom-modal {
  width: min(720px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.42);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.9);
  padding: 28px;
  box-shadow: 0 26px 70px rgba(15, 23, 42, 0.22);
}

:global(.dark) .desktop-custom-modal {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 20, 0.92);
}

.desktop-custom-color-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.desktop-color-picker {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-width: 0;
  min-height: 62px;
  padding: 10px 14px 10px 18px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.5);
  color: rgb(31 41 55);
  font-size: 15px;
  font-weight: 700;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.desktop-color-picker > span:first-child {
  min-width: 0;
  white-space: normal;
  word-break: keep-all;
}

:global(.dark) .desktop-color-picker {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.88);
}

.desktop-color-picker:hover {
  border-color: rgba(236, 65, 65, 0.38);
  background: rgba(236, 65, 65, 0.06);
}

.desktop-color-picker--active {
  border-color: rgba(236, 65, 65, 0.45);
  background: rgba(236, 65, 65, 0.08);
}

.desktop-color-input-shell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}

.desktop-custom-color-panel {
  position: fixed;
  z-index: 155;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.24);
}

:global(.dark) .desktop-custom-color-panel {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 20, 0.96);
}

.desktop-custom-color-panel-title {
  padding: 14px 16px 12px;
  color: rgb(31 41 55);
  font-size: 14px;
  font-weight: 800;
}

:global(.dark) .desktop-custom-color-panel-title {
  color: rgba(255, 255, 255, 0.9);
}

.desktop-custom-color-area {
  position: relative;
  height: 218px;
  cursor: crosshair;
  touch-action: none;
  background-image:
    linear-gradient(90deg, #fff, rgba(255, 255, 255, 0)),
    linear-gradient(0deg, #000, rgba(0, 0, 0, 0));
}

.desktop-custom-color-thumb {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 3px solid #fff;
  border-radius: 999px;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.75),
    0 2px 8px rgba(15, 23, 42, 0.26);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.desktop-custom-hue-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 14px 18px 10px;
}

.desktop-custom-current-color {
  width: 42px;
  height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 999px;
  box-shadow:
    inset 0 0 0 1px rgba(15, 23, 42, 0.08),
    0 4px 12px rgba(15, 23, 42, 0.14);
}

.desktop-custom-hue-slider {
  width: 100%;
  height: 14px;
  border-radius: 999px;
  background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  appearance: none;
  cursor: pointer;
}

.desktop-custom-hue-slider::-webkit-slider-thumb {
  width: 22px;
  height: 22px;
  border: 3px solid #fff;
  border-radius: 999px;
  background: transparent;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.2),
    0 2px 8px rgba(15, 23, 42, 0.22);
  appearance: none;
}

.desktop-custom-hue-slider::-moz-range-thumb {
  width: 22px;
  height: 22px;
  border: 3px solid #fff;
  border-radius: 999px;
  background: transparent;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.2),
    0 2px 8px rgba(15, 23, 42, 0.22);
}

.desktop-custom-rgb-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 0 18px 16px;
}

.desktop-custom-rgb-row label {
  display: grid;
  gap: 6px;
  text-align: center;
  color: rgb(31 41 55);
  font-size: 13px;
  font-weight: 700;
}

:global(.dark) .desktop-custom-rgb-row label {
  color: rgba(255, 255, 255, 0.82);
}

.desktop-custom-rgb-row input {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(15, 23, 42, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  padding: 8px 6px;
  text-align: center;
  color: rgb(17 24 39);
  font-size: 15px;
  font-weight: 700;
}

:global(.dark) .desktop-custom-rgb-row input {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

.desktop-shadow-custom-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  overflow: hidden;
  cursor: pointer;
}

.desktop-shadow-custom-chip input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.desktop-shadow-custom-swatch {
  width: 16px;
  height: 16px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  box-shadow:
    inset 0 0 0 1px rgba(15, 23, 42, 0.08),
    0 2px 6px rgba(15, 23, 42, 0.14);
}

.desktop-color-swatch {
  width: 100%;
  height: 100%;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 14px;
  box-shadow:
    inset 0 0 0 1px rgba(15, 23, 42, 0.08),
    0 4px 12px rgba(15, 23, 42, 0.14);
}

.desktop-custom-preview {
  margin-top: 18px;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border-radius: 18px;
  background:
    radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.12), transparent 42%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(3, 7, 18, 0.96));
  padding: 30px;
  text-align: center;
}

.desktop-custom-preview-line {
  max-width: 100%;
  font-size: 34px;
  font-weight: 800;
  line-height: 1.18;
  overflow-wrap: anywhere;
}

.desktop-custom-preview-sub {
  font-size: 15px;
  line-height: 1.4;
  opacity: 0.86;
}

.desktop-custom-preview-translation {
  margin-top: -8px;
  font-size: 16px;
}

.desktop-custom-modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

.desktop-custom-done-button {
  min-width: 108px;
  min-height: 44px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 700;
}

.desktop-custom-modal-enter-active,
.desktop-custom-modal-leave-active {
  transition: opacity 180ms ease;
}

.desktop-custom-modal-enter-active .desktop-custom-modal,
.desktop-custom-modal-leave-active .desktop-custom-modal {
  transition: transform 180ms ease, opacity 180ms ease;
}

.desktop-custom-modal-enter-from,
.desktop-custom-modal-leave-to {
  opacity: 0;
}

.desktop-custom-modal-enter-from .desktop-custom-modal,
.desktop-custom-modal-leave-to .desktop-custom-modal {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

@media (max-width: 767px) {
  .desktop-typography-row--inline {
    flex-direction: column;
    align-items: stretch;
  }

  .desktop-inline-actions {
    justify-content: flex-start;
  }

  .desktop-font-picker--inline {
    width: 100%;
  }

  .desktop-custom-modal {
    padding: 18px;
  }

  .desktop-color-picker {
    min-height: 58px;
    padding: 9px 12px 9px 14px;
  }

  .desktop-color-input-shell {
    width: 42px;
    height: 42px;
  }

  .desktop-custom-preview-line {
    font-size: 26px;
  }
}

.desktop-slider {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(236, 65, 65, 0.88), rgba(251, 146, 60, 0.88));
  appearance: none;
  cursor: pointer;
}

.desktop-slider::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #ec4141;
  box-shadow: 0 2px 8px rgba(236, 65, 65, 0.3);
  appearance: none;
}

.desktop-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #ec4141;
  box-shadow: 0 2px 8px rgba(236, 65, 65, 0.3);
}

/* 桌面歌词排版效果预览区样式 */
.desktop-lyrics-preview-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
  padding: 4px;
}

.desktop-lyrics-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.desktop-preview-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 999px;
  transition: all 180ms cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
}

.desktop-preview-btn--cancel {
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(148, 163, 184, 0.08);
  color: rgb(71 85 105);
}
.desktop-preview-btn--cancel:hover {
  background: rgba(148, 163, 184, 0.16);
  border-color: rgba(148, 163, 184, 0.36);
}
:global(.dark) .desktop-preview-btn--cancel {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.76);
}
.desktop-preview-btn--cancel:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.16);
}

.desktop-preview-btn--theme {
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(148, 163, 184, 0.08);
  color: rgb(71 85 105);
}
.desktop-preview-btn--theme:hover {
  background: rgba(148, 163, 184, 0.16);
  border-color: rgba(148, 163, 184, 0.36);
}
:global(.dark) .desktop-preview-btn--theme {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.76);
}
:global(.dark) .desktop-preview-btn--theme:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.16);
}

.desktop-preview-btn--apply {
  border: 1px solid rgba(236, 65, 65, 0.18);
  background: #ec4141;
  color: #fff;
  box-shadow: 0 4px 14px rgba(236, 65, 65, 0.22);
}
.desktop-preview-btn--apply:hover {
  background: #d93838;
  box-shadow: 0 6px 18px rgba(236, 65, 65, 0.3);
}

.desktop-preview-btn--default {
  border: 1px solid rgba(236, 65, 65, 0.16);
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
}
.desktop-preview-btn--default:hover {
  border-color: rgba(236, 65, 65, 0.42);
  background: rgba(236, 65, 65, 0.12);
}

/* 高拟真预览背景：采用中灰色/暗色/浅色磨砂渐变模拟桌面壁纸，但不影响判断透明度、阴影 */
.desktop-lyrics-preview-card {
  position: relative;
  height: 220px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  padding: 28px;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.16);
  overflow: hidden;
  box-sizing: border-box;
  transition: background 250ms ease, border-color 250ms ease;
}

/* 深色模式背景壁纸 */
.desktop-lyrics-preview-card--dark {
  border-color: rgba(255, 255, 255, 0.08);
  background:
    radial-gradient(circle at top left, rgba(71, 85, 105, 0.15), transparent 45%),
    radial-gradient(circle at bottom right, rgba(15, 23, 42, 0.25), transparent 45%),
    linear-gradient(135deg, #1e293b, #0f172a);
}

:global(.dark) .desktop-lyrics-preview-card--dark {
  border-color: rgba(255, 255, 255, 0.06);
  background:
    radial-gradient(circle at top left, rgba(71, 85, 105, 0.22), transparent 45%),
    radial-gradient(circle at bottom right, rgba(0, 0, 0, 0.4), transparent 45%),
    linear-gradient(135deg, #0f172a, #020617);
}

/* 浅色模式背景壁纸：用于测试亮色壁纸下阴影与透明度的判断，高品质浅灰微暖渐变 */
.desktop-lyrics-preview-card--light {
  border-color: rgba(15, 23, 42, 0.08);
  background:
    radial-gradient(circle at top left, rgba(236, 65, 65, 0.06), transparent 45%),
    radial-gradient(circle at bottom right, rgba(148, 163, 184, 0.15), transparent 45%),
    linear-gradient(135deg, #f8fafc, #e2e8f0);
}

:global(.dark) .desktop-lyrics-preview-card--light {
  border-color: rgba(255, 255, 255, 0.08);
  background:
    radial-gradient(circle at top left, rgba(236, 65, 65, 0.08), transparent 45%),
    radial-gradient(circle at bottom right, rgba(255, 255, 255, 0.06), transparent 45%),
    linear-gradient(135deg, #e2e8f0, #cbd5e1);
}

.desktop-lyrics-preview-body {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.desktop-lyric-block {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(0.22rem * var(--desktop-line-gap, 1));
  text-align: var(--lyrics-text-align, center);
  font-family: var(--lyrics-font-family, system-ui, sans-serif);
  opacity: var(--desktop-text-opacity, 1);
  transition: opacity 220ms ease;
}

.desktop-lyric-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: calc(0.12rem * var(--desktop-line-gap, 1));
}

.desktop-lyric-row--inactive {
  opacity: 0.74;
  transform: translate3d(0, 2px, 0) scale(0.992);
  filter: saturate(0.94);
}

.desktop-lyric-main {
  width: 100%;
  font-size: calc(32px * var(--desktop-font-scale, 1));
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: 0.01em;
  color: var(--desktop-text-primary);
  overflow-wrap: anywhere;
  word-break: break-word;
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.55)))
    drop-shadow(0 0 var(--desktop-first-line-text-shadow-blur, 0px) rgb(var(--desktop-text-shadow-color, 0 0 0) / var(--desktop-first-line-text-shadow-alpha, 0)))
    drop-shadow(0 0 24px color-mix(in srgb, var(--desktop-accent-a) 14%, transparent));
  transition: filter 200ms ease;
}

.desktop-lyric-main--inactive {
  font-size: calc(24px * var(--desktop-font-scale, 1));
  font-weight: 650;
  color: color-mix(in srgb, var(--desktop-text-primary) 76%, transparent);
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 var(--desktop-second-line-text-shadow-blur, 0px) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.86)))
    drop-shadow(0 0 18px color-mix(in srgb, var(--desktop-accent-c) 10%, transparent));
}

.desktop-lyric-word {
  display: inline-block;
  white-space: pre-wrap;
}

.desktop-lyric-word--with-romaji {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  text-align: center;
  vertical-align: bottom;
  white-space: nowrap;
}

.desktop-lyric-word-main {
  display: inline-block;
  white-space: pre-wrap;
}

.desktop-lyric-word-romaji {
  display: block;
  margin-top: 0.08em;
  color: var(--desktop-romaji-unplayed-color);
  font-size: 0.46em;
  font-weight: 650;
  line-height: 1.05;
  letter-spacing: 0;
  white-space: pre;
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.86) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.86)))
    drop-shadow(0 0 16px color-mix(in srgb, var(--desktop-romaji-unplayed-color) 20%, transparent));
}

.desktop-lyric-sub {
  width: 100%;
  font-size: calc(18px * var(--desktop-font-scale, 1));
  line-height: 1.36;
  letter-spacing: 0.03em;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.desktop-lyric-sub--romaji {
  color: var(--desktop-romaji-unplayed-color);
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.86) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.86)))
    drop-shadow(0 0 16px color-mix(in srgb, var(--desktop-romaji-unplayed-color) 20%, transparent));
}

.desktop-lyric-sub--translation {
  color: var(--desktop-translation-color);
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-first-line-text-shadow-blur, 0px) * 0.82) rgb(var(--desktop-text-shadow-color, 0 0 0) / calc(var(--desktop-first-line-text-shadow-alpha, 0) * 0.82)))
    drop-shadow(0 0 12px color-mix(in srgb, var(--desktop-translation-color) 18%, transparent));
}

.desktop-lyric-row--second-line .desktop-lyric-sub--translation {
  filter:
    drop-shadow(0 1px 2px rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.48)))
    drop-shadow(0 0 calc(var(--desktop-second-line-text-shadow-blur, 0px) * 0.82) rgb(var(--desktop-second-line-text-shadow-color, var(--desktop-text-shadow-color, 0 0 0)) / calc(var(--desktop-second-line-text-shadow-alpha, 0) * 0.82)))
    drop-shadow(0 0 12px color-mix(in srgb, var(--desktop-translation-color) 18%, transparent));
}

.lyrics-align-left {
  --lyrics-horizontal-align: center;
  --lyrics-vertical-align: center;
  --lyrics-text-align: left;
  --lyrics-line-transform-origin: 0%;
}

.lyrics-align-center {
  --lyrics-horizontal-align: center;
  --lyrics-vertical-align: center;
  --lyrics-text-align: center;
  --lyrics-line-transform-origin: 50%;
}

.lyrics-align-right {
  --lyrics-horizontal-align: center;
  --lyrics-vertical-align: center;
  --lyrics-text-align: right;
  --lyrics-line-transform-origin: 100%;
}

/* ==========================================================================
   网易云式极致紧凑排版仪表盘样式 (Compact Panel)
   ========================================================================== */

/* 紧凑容器：使用极具现代感和高级感的磨砂边框与圆角 */
.desktop-typography-panel--compact {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 20px;
  padding: 14px;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.6), 0 8px 24px rgba(15, 23, 42, 0.03);
  transition: all 250ms ease;
}

:global(.dark) .desktop-typography-panel--compact {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.02), 0 8px 24px rgba(0, 0, 0, 0.12);
}

/* 紧凑控制行：横向二等分 */
.desktop-compact-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  align-items: center;
  gap: 12px;
  width: 100%;
}

.desktop-compact-row-full {
  display: flex;
  align-items: center;
  width: 100%;
}

/* 紧凑单元格：平分 50% 宽度 */
.desktop-compact-cell {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  height: 40px;
  padding: 0 4px 0 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(15, 23, 42, 0.04);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.02);
  transition: all 180ms ease;
}

:global(.dark) .desktop-compact-cell {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.03);
  box-shadow: none;
}

.desktop-compact-cell:hover {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(236, 65, 65, 0.18);
  box-shadow: 0 4px 12px rgba(236, 65, 65, 0.03);
}

:global(.dark) .desktop-compact-cell:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(236, 65, 65, 0.28);
}

/* 精致等宽网格单元格：专门用于滑块 Cell，强制使用 Grid 布局保证 Label 56px 固定且滑块起点完美对齐 */
.desktop-compact-slider-cell {
  flex: 1;
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 46px;
  align-items: center;
  gap: 12px;
  min-width: 0;
  height: 40px;
  padding: 0 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(15, 23, 42, 0.04);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.02);
  transition: all 180ms ease;
}

:global(.dark) .desktop-compact-slider-cell {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.03);
  box-shadow: none;
}

.desktop-compact-slider-cell:hover {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(236, 65, 65, 0.18);
  box-shadow: 0 4px 12px rgba(236, 65, 65, 0.03);
}

:global(.dark) .desktop-compact-slider-cell:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(236, 65, 65, 0.28);
}

/* 紧凑标签：左侧标签，易读大气 */
.desktop-compact-label {
  font-size: 13px;
  font-weight: 700;
  color: rgb(55 65 81);
  user-select: none;
  white-space: nowrap;
}

:global(.dark) .desktop-compact-label {
  color: rgba(255, 255, 255, 0.68);
}



/* 阴影色块与配色选择器区域 */
.desktop-compact-selector-shadow,
.desktop-compact-selector-scheme {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
}

/* 自定义配色圆圈渐变 */
.desktop-compact-color-preset--custom {
  background: linear-gradient(135deg, #EC4141 0%, #60a5fa 50%, #34d399 100%) !important;
}

/* 封面取色圆圈渐变 */
.desktop-compact-color-preset--auto {
  background: linear-gradient(135deg, #8ec5ff 0%, #ff8cab 33%, #88f3c2 66%, #ffe07d 100%) !important;
}

/* 阴影预设小圆点 */
.desktop-compact-color-preset {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.12), 0 1px 2px rgba(15, 23, 42, 0.06);
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.4, 0, 0.2, 1);
}

.desktop-compact-color-preset:hover {
  transform: scale(1.2);
  box-shadow: 0 0 0 1px #ec4141, 0 2px 6px rgba(236, 65, 65, 0.15);
}

.desktop-compact-color-preset--active {
  transform: scale(1.15);
  border-color: #fff !important;
  box-shadow: 0 0 0 2px #ec4141, 0 3px 8px rgba(236, 65, 65, 0.24) !important;
}

:global(.dark) .desktop-compact-color-preset {
  border-color: rgba(0, 0, 0, 0.4);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.2);
}

:global(.dark) .desktop-compact-color-preset:hover {
  box-shadow: 0 0 0 1.5px #ff8b8b, 0 2px 6px rgba(236, 65, 65, 0.2);
}

:global(.dark) .desktop-compact-color-preset--active {
  box-shadow: 0 0 0 2px #ff8b8b, 0 3px 8px rgba(236, 65, 65, 0.3) !important;
}

/* 自定义阴影色块容器 */
.desktop-compact-color-custom {
  position: relative;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  transition: all 180ms cubic-bezier(0.4, 0, 0.2, 1);
}

.desktop-compact-color-custom input[type="color"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.desktop-compact-color-custom-swatch {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.12), 0 1px 2px rgba(15, 23, 42, 0.06);
  background-image: linear-gradient(45deg, #bbb 25%, transparent 25%),
                    linear-gradient(-45deg, #bbb 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, #bbb 75%),
                    linear-gradient(-45deg, transparent 75%, #bbb 75%);
  background-size: 4px 4px;
  background-position: 0 0, 0 2px, 2px -2px, -2px 0;
}

:global(.dark) .desktop-compact-color-custom-swatch {
  border-color: rgba(0, 0, 0, 0.4);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.2);
}

.desktop-compact-color-custom:hover {
  transform: scale(1.2);
  box-shadow: 0 0 0 1px #ec4141, 0 2px 6px rgba(236, 65, 65, 0.15);
}

.desktop-compact-color-custom--active {
  transform: scale(1.15);
  box-shadow: 0 0 0 2px #ec4141, 0 3px 8px rgba(236, 65, 65, 0.24) !important;
}

:global(.dark) .desktop-compact-color-custom:hover {
  box-shadow: 0 0 0 1.5px #ff8b8b, 0 2px 6px rgba(236, 65, 65, 0.2);
}

:global(.dark) .desktop-compact-color-custom--active {
  box-shadow: 0 0 0 2px #ff8b8b, 0 3px 8px rgba(236, 65, 65, 0.3) !important;
}

/* 分段对齐控制器 (Segmented Control) */
.desktop-segmented-control {
  padding: 2px;
  background: rgba(15, 23, 42, 0.03);
  border: 1px solid rgba(15, 23, 42, 0.04);
  border-radius: 9px;
  gap: 2px;
  height: 28px;
  box-sizing: border-box;
}

:global(.dark) .desktop-segmented-control {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.03);
}

/* 分段按钮 */
.desktop-segmented-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgb(71 85 105);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 0 8px;
  height: 22px;
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
}

:global(.dark) .desktop-segmented-btn {
  color: rgba(255, 255, 255, 0.68);
}

.desktop-segmented-btn:hover {
  color: #ec4141;
  background: rgba(255, 255, 255, 0.5);
}

:global(.dark) .desktop-segmented-btn:hover {
  color: #ff8b8b;
  background: rgba(255, 255, 255, 0.05);
}

/* 激活态的分段按钮 */
.desktop-segmented-btn--active {
  background: #fff !important;
  color: #ec4141 !important;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 4px 10px rgba(15, 23, 42, 0.03);
}

:global(.dark) .desktop-segmented-btn--active {
  background: rgba(255, 255, 255, 0.12) !important;
  color: #ff8b8b !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

/* ==========================================================================
   精致极细滑动条样式 (iOS / macOS 风格定制)
   ========================================================================== */

.desktop-compact-range-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 20px; /* 轨道本体热区高度 20px，保证大鼠标点击命中热区 */
  background: transparent; /* 容器背景透明 */
  border: none;
  outline: none;
  cursor: pointer;
  margin: 0;
  padding: 0;
}

/* Chrome / Safari / Edge / Tauri Runnable Track 轨道 */
.desktop-compact-range-slider::-webkit-slider-runnable-track {
  width: 100%;
  height: 4px; /* 精致 4px 极细轨道 */
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.1);
  transition: background 150ms ease;
}

:global(.dark) .desktop-compact-range-slider::-webkit-slider-runnable-track {
  background: rgba(255, 255, 255, 0.16);
}

.desktop-compact-range-slider:hover::-webkit-slider-runnable-track {
  background: rgba(15, 23, 42, 0.16);
}

:global(.dark) .desktop-compact-range-slider:hover::-webkit-slider-runnable-track {
  background: rgba(255, 255, 255, 0.24);
}

/* Firefox Runnable Track 轨道 */
.desktop-compact-range-slider::-moz-range-track {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.1);
  transition: background 150ms ease;
  border: none;
}

:global(.dark) .desktop-compact-range-slider::-moz-range-track {
  background: rgba(255, 255, 255, 0.16);
}

.desktop-compact-range-slider:hover::-moz-range-track {
  background: rgba(15, 23, 42, 0.16);
}

:global(.dark) .desktop-compact-range-slider:hover::-moz-range-track {
  background: rgba(255, 255, 255, 0.24);
}

/* Chrome / Safari / Edge / Tauri Thumb 圆形按钮 (居中) */
.desktop-compact-range-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 2px 4px rgba(15, 23, 42, 0.12), 0 0 1px rgba(15, 23, 42, 0.2);
  /* 垂直居中于 20px 容器内：14px 按钮，偏移为 (4px-14px)/2 = -5px */
  margin-top: -5px; 
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.desktop-compact-range-slider::-webkit-slider-thumb:hover {
  transform: scale(1.18);
  box-shadow: 0 3px 6px rgba(15, 23, 42, 0.16), 0 0 2px rgba(15, 23, 42, 0.24);
}

.desktop-compact-range-slider::-webkit-slider-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.14);
}

/* Firefox Thumb 圆形按钮 (自动居中) */
.desktop-compact-range-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 2px 4px rgba(15, 23, 42, 0.12), 0 0 1px rgba(15, 23, 42, 0.2);
  transition: transform 120ms ease, box-shadow 120ms ease;
  box-sizing: border-box;
}

.desktop-compact-range-slider::-moz-range-thumb:hover {
  transform: scale(1.18);
  box-shadow: 0 3px 6px rgba(15, 23, 42, 0.16), 0 0 2px rgba(15, 23, 42, 0.24);
}

.desktop-compact-range-slider::-moz-range-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.14);
}
</style>
