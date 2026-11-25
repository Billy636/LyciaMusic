<script setup lang="ts">
import { Check, RotateCcw } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
  DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
  DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
  DEFAULT_DESKTOP_TEXT_STROKE_COLOR,
  buildImportedLyricsFontOptions,
  LYRICS_FONT_OPTIONS,
  MAX_DESKTOP_TEXT_SHADOW_STRENGTH,
  MIN_DESKTOP_TEXT_SHADOW_STRENGTH,
  MAX_DESKTOP_TEXT_STROKE_DEPTH,
  MIN_DESKTOP_TEXT_STROKE_DEPTH,
  loadSystemLyricsFonts,
  normalizeHexColor,
  normalizeDesktopPlayerAlignment,
  normalizeLyricsFontPreset,
  type DesktopLyricsPlayerAlignment,
  type LyricsColorScheme,
  type LyricsFontPreset,
  useLyrics,
  createDefaultDesktopLyricsSettings,
} from '../../composables/lyrics';
import { usesNativeDesktopLyrics } from '../../features/desktopLyrics/native';
import { useSettings } from '../../features/settings/useSettings';
import { useLyricsSettingsStore } from '../../features/lyricsSettings/store';
import SettingsSelect from './SettingsSelect.vue';
import SettingsNumberControl from './SettingsNumberControl.vue';
const OVERFLOW_OPTIONS = [
  { value: 'scroll', label: '横向跟随（推荐）' },
  { value: 'wrap', label: '自动换行（正文最多两行）' },
];
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
  { value: 'auto', label: '封面虚化背景色', hint: '跟随当前歌曲封面取色' },
  { value: 'custom', label: '自定义背景色', hint: '手动选择字体颜色' },
];
// 阴影 / 描边色板与铃动窗、背景色板保持同一套：白 / 墨 / 经典红 / 澄蓝 / 青绿 / 暖金。
const SHADOW_COLOR_PRESETS = [
  { label: '白色', value: '#ffffff' },
  { label: '墨色', value: '#273449' },
  { label: '经典红', value: '#ec4141' },
  { label: '澄蓝', value: '#60a5fa' },
  { label: '青绿', value: '#34d399' },
  { label: '暖金', value: '#fbbf24' },
];
const STROKE_COLOR_PRESETS = SHADOW_COLOR_PRESETS;
const { settings } = useSettings();
const { lyricsSettings, desktopLyricsSettings } = useLyrics();
const desktopDefaults = createDefaultDesktopLyricsSettings();
// 桌面歌词背景外观选项：与原生渲染字段一一对应，控件样式与铃动窗设置页一致。
const BACKGROUND_SHAPE_OPTIONS: Array<{ value: 'rounded' | 'pill' | 'square'; label: string }> = [
  { value: 'rounded', label: '圆角矩形' },
  { value: 'pill', label: '胶囊圆形' },
  { value: 'square', label: '方形' },
];
const BACKGROUND_COLOR_MODE_OPTIONS: Array<{ value: 'dark' | 'light' | 'custom'; label: string }> = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'custom', label: '自定义背景色' },
];
// 与铃动窗「背景颜色 / 高亮颜色 / 字体颜色」同一套色板与顺序。
const BACKGROUND_COLOR_PRESETS = [
  { label: '白色', value: '#ffffff' },
  { label: '墨色', value: '#273449' },
  { label: '经典红', value: '#ec4141' },
  { label: '澄蓝', value: '#60a5fa' },
  { label: '青绿', value: '#34d399' },
  { label: '暖金', value: '#fbbf24' },
];
// 排版与颜色全部直连设置仓库：拉动滑块立即生效，不再有「应用到桌面歌词」的暂存流程。
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
const CUSTOM_COLOR_PANEL_LEFT_SHIFT = 18;
const customPreviewPlayedStyle = computed(() => ({
  color: desktopLyricsSettings.customPlayedColor,
  textShadow: `0 0 16px ${desktopLyricsSettings.customPlayedColor}66`,
}));
const customPreviewCurrentStyle = computed(() => ({
  color: desktopLyricsSettings.customPlayedColor,
  textShadow: `0 0 16px ${desktopLyricsSettings.customPlayedColor}66`,
}));
const customPreviewUnplayedStyle = computed(() => ({
  color: desktopLyricsSettings.customUnplayedColor,
}));
const customPreviewRomajiPlayedStyle = computed(() => ({
  color: desktopLyricsSettings.customRomajiPlayedColor,
}));
const customPreviewRomajiCurrentStyle = computed(() => ({
  color: desktopLyricsSettings.customRomajiPlayedColor,
}));
const customPreviewRomajiUnplayedStyle = computed(() => ({
  color: desktopLyricsSettings.customRomajiUnplayedColor,
}));
const customPreviewTranslationStyle = computed(() => ({
  color: desktopLyricsSettings.customTranslationColor,
}));
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
function clampTextStrokeDepth(value: number) {
  return Math.min(MAX_DESKTOP_TEXT_STROKE_DEPTH, Math.max(MIN_DESKTOP_TEXT_STROKE_DEPTH, value));
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
const availableFontOptions = computed(() => [
  ...LYRICS_FONT_OPTIONS,
  ...buildImportedLyricsFontOptions(settings.value.customLyricsFonts ?? []),
]);
const FONT_PRESET_SELECT_OPTIONS = computed(() => availableFontOptions.value
  .map(option => ({ value: option.value, label: option.label })));
const isCustomShadowColor = computed(() =>
  !SHADOW_COLOR_PRESETS.some(preset => preset.value === desktopLyricsSettings.textShadowColor));
const isCustomStrokeColor = computed(() =>
  !STROKE_COLOR_PRESETS.some(preset => preset.value === desktopLyricsSettings.textStrokeColor));
const COLOR_SCHEME_SELECT_OPTIONS = computed(() =>
  COLOR_SCHEME_OPTIONS.map(({ value, label }) => ({ value, label })));
// 旧版本保存的 default/pink/blue/green 归一到封面取色；只有 custom 才显示字体颜色。
const colorSchemeModel = computed({
  get: (): LyricsColorScheme => desktopLyricsSettings.colorScheme === 'custom' ? 'custom' : 'auto',
  set: (value: LyricsColorScheme) => setDesktopColorScheme(value),
});
function setDesktopTextShadowStrength(value: number) {
  const val = Number(clampTextShadowStrength(value).toFixed(0));
  desktopLyricsSettings.firstLineTextShadowStrength = val;
  desktopLyricsSettings.secondLineTextShadowStrength = val;
}
function setDesktopTextShadowColor(value: string) {
  desktopLyricsSettings.textShadowColor = normalizeHexColor(value, DEFAULT_DESKTOP_TEXT_SHADOW_COLOR);
}
function setDesktopTextStrokeDepth(value: number) {
  desktopLyricsSettings.textStrokeDepth = Number(clampTextStrokeDepth(value).toFixed(0));
}
function setDesktopTextStrokeColor(value: string) {
  desktopLyricsSettings.textStrokeColor = normalizeHexColor(value, DEFAULT_DESKTOP_TEXT_STROKE_COLOR);
}
function setDesktopAlignment(value: DesktopLyricsPlayerAlignment) {
  desktopLyricsSettings.playerAlignment = normalizeDesktopPlayerAlignment(value);
}
function setDesktopFontPreset(value: LyricsFontPreset) {
  desktopLyricsSettings.playerFontPreset = normalizeLyricsFontPreset(value);
}
function setDesktopColorScheme(value: LyricsColorScheme) {
  desktopLyricsSettings.colorScheme = value;
}
const backgroundTransparency = computed({
  get: () => Math.round(100 - desktopLyricsSettings.backgroundOpacity),
  set: (value: number) => {
    desktopLyricsSettings.backgroundOpacity = 100 - Math.min(100, Math.max(0, value));
  },
});
const fontTransparency = computed({
  get: () => Math.round((1 - desktopLyricsSettings.textOpacity) * 100),
  set: (value: number) => {
    desktopLyricsSettings.textOpacity = Number((1 - Math.min(100, Math.max(0, value)) / 100).toFixed(2));
  },
});
const desktopFontColor = computed(() => desktopLyricsSettings.customUnplayedColor);
function setDesktopFontColor(value: string) {
  const hex = normalizeHexColor(value, DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR);
  useLyricsSettingsStore().patchDesktopLyricsSettings({
    colorScheme: 'custom',
    customPlayedColor: hex,
    customUnplayedColor: hex,
    customRomajiPlayedColor: hex,
    customRomajiUnplayedColor: hex,
    customRomajiColor: hex,
    customTranslationColor: hex,
  });
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
    desktopLyricsSettings.customPlayedColor = normalized;
  } else if (kind === 'unplayed') {
    desktopLyricsSettings.customUnplayedColor = normalized;
  } else if (kind === 'romajiPlayed') {
    desktopLyricsSettings.customRomajiPlayedColor = normalized;
  } else if (kind === 'romajiUnplayed') {
    desktopLyricsSettings.customRomajiUnplayedColor = normalized;
    desktopLyricsSettings.customRomajiColor = normalized;
  } else {
    desktopLyricsSettings.customTranslationColor = normalized;
  }
  desktopLyricsSettings.colorScheme = 'custom';
}
function getDesktopCustomColor(kind: DesktopCustomColorKind) {
  if (kind === 'played') return desktopLyricsSettings.customPlayedColor;
  if (kind === 'unplayed') return desktopLyricsSettings.customUnplayedColor;
  if (kind === 'romajiPlayed') return desktopLyricsSettings.customRomajiPlayedColor;
  if (kind === 'romajiUnplayed') return desktopLyricsSettings.customRomajiUnplayedColor;
  return desktopLyricsSettings.customTranslationColor;
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
  desktopLyricsSettings.colorScheme = 'custom';
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
  desktopLyricsSettings.colorScheme = 'custom';
  activeCustomColorKind.value = null;
  isCustomColorModalOpen.value = true;
}
function closeCustomColorModal() {
  isCustomColorModalOpen.value = false;
  activeCustomColorKind.value = null;
}
function handlePointerDownOutside(event: MouseEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (customColorPanelRef.value?.contains(target)) return;
  if ((target as Element | null)?.closest?.('.desktop-color-input-shell')) return;
  activeCustomColorKind.value = null;
}
function handleWindowEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeCustomColorModal();
  }
}
onMounted(() => {
  window.addEventListener('mousedown', handlePointerDownOutside);
  window.addEventListener('keydown', handleWindowEscape);
  void loadSystemLyricsFonts();
});
onUnmounted(() => {
  window.removeEventListener('mousedown', handlePointerDownOutside);
  window.removeEventListener('keydown', handleWindowEscape);
});
</script>
<template>
  <div class="desktop-lyrics-settings w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">开启后优先保持显示，游戏请使用无边框全屏；独占全屏可能无法覆盖</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.isAlwaysOnTop ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.isAlwaysOnTop ? 'translate-x-5' : ''" />
          </span>
        </button>
        <button
          type="button"
          class="desktop-setting-row"
          :disabled="desktopLyricsSettings.isAlwaysOnTop"
          :class="desktopLyricsSettings.isAlwaysOnTop ? 'cursor-not-allowed opacity-50' : ''"
          @click="desktopLyricsSettings.autoHideWhenFullscreen = !desktopLyricsSettings.autoHideWhenFullscreen"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">全屏时自动隐藏</div>
            <div v-if="desktopLyricsSettings.isAlwaysOnTop" class="mt-1 text-xs text-gray-500 dark:text-gray-400">窗口置顶已开启，此设置在关闭置顶后生效</div>
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
        <div v-if="usesNativeDesktopLyrics()" class="desktop-setting-row desktop-overflow-row">
          <div class="desktop-overflow-copy">
            <label for="desktop-lyrics-overflow" class="text-sm font-medium text-gray-800 dark:text-gray-200">长句处理</label>
          </div>
          <SettingsSelect class="desktop-overflow-select" label="长句处理" hide-label
            trigger-id="desktop-lyrics-overflow"
            :model-value="desktopLyricsSettings.overflowMode ?? 'scroll'" :options="OVERFLOW_OPTIONS"
            @update:model-value="desktopLyricsSettings.overflowMode = $event === 'wrap' ? 'wrap' : 'scroll'" />
        </div>
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
        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.centerHorizontally = !desktopLyricsSettings.centerHorizontally"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">桌面歌词水平居中</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.centerHorizontally ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.centerHorizontally ? 'translate-x-5' : ''" />
          </span>
        </button>
      </div>
    </section>
    <section class="desktop-typography-section space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        歌词排版
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <!-- 背景外观：次级面板，控件样式与铃动窗设置页一致 -->
        <button
          type="button"
          class="desktop-setting-row"
          @click="desktopLyricsSettings.alwaysShowShadowBackground = !desktopLyricsSettings.alwaysShowShadowBackground"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">始终显示背景</div>
          </div>
          <span class="desktop-switch" :class="desktopLyricsSettings.alwaysShowShadowBackground ? 'desktop-switch--on' : ''">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.alwaysShowShadowBackground ? 'translate-x-5' : ''" />
          </span>
        </button>
        <div v-if="desktopLyricsSettings.alwaysShowShadowBackground" class="desktop-bg-subpanel">
          <div class="desktop-setting-row">
            <div class="min-w-0">
              <div class="desktop-setting-label">背景框形状</div>
            </div>
            <SettingsSelect
              class="desktop-background-select"
              label="背景框形状"
              hide-label
              trigger-id="desktop-lyrics-background-shape"
              :model-value="desktopLyricsSettings.backgroundShape"
              :options="BACKGROUND_SHAPE_OPTIONS"
              @update:model-value="desktopLyricsSettings.backgroundShape = $event as 'rounded' | 'pill' | 'square'"
            />
          </div>
          <div class="desktop-setting-row">
            <div class="min-w-0">
              <div class="desktop-setting-label">背景颜色</div>
            </div>
            <SettingsSelect
              class="desktop-background-select"
              label="背景颜色"
              hide-label
              trigger-id="desktop-lyrics-background-color-mode"
              :model-value="desktopLyricsSettings.backgroundColorMode"
              :options="BACKGROUND_COLOR_MODE_OPTIONS"
              @update:model-value="desktopLyricsSettings.backgroundColorMode = $event as 'dark' | 'light' | 'custom'"
            />
          </div>
          <div v-if="desktopLyricsSettings.backgroundColorMode === 'custom'" class="desktop-setting-row flex-wrap gap-y-2">
            <div class="min-w-0">
              <div class="desktop-setting-label">背景颜色</div>
            </div>
            <div class="desktop-color-controls-row">
              <div class="desktop-color-presets-row" role="group" aria-label="背景预设颜色">
                <button
                  v-for="preset in BACKGROUND_COLOR_PRESETS"
                  :key="preset.value"
                  type="button"
                  class="desktop-color-dot"
                  :class="desktopLyricsSettings.customBackgroundColor === preset.value ? 'desktop-color-dot--active' : ''"
                  :style="{ backgroundColor: preset.value, color: preset.value === '#ffffff' || preset.value === '#fbbf24' ? '#273449' : '#ffffff' }"
                  :title="preset.label"
                  :aria-label="`背景颜色：${preset.label}`"
                  :aria-pressed="desktopLyricsSettings.customBackgroundColor === preset.value"
                  @click="desktopLyricsSettings.customBackgroundColor = preset.value"
                >
                  <Check v-if="desktopLyricsSettings.customBackgroundColor === preset.value" :size="13" :stroke-width="2.5" />
                </button>
                <label class="desktop-color-custom">自定义
                  <input
                    type="color"
                    class="desktop-color-dot-input"
                    aria-label="自定义背景颜色"
                    :value="desktopLyricsSettings.customBackgroundColor"
                    @input="desktopLyricsSettings.customBackgroundColor = ($event.target as HTMLInputElement).value"
                  />
                </label>
                <button
                  type="button"
                  class="desktop-color-reset"
                  title="恢复默认背景颜色"
                  aria-label="恢复默认背景颜色"
                  :disabled="desktopLyricsSettings.customBackgroundColor === desktopDefaults.customBackgroundColor"
                  @click="desktopLyricsSettings.customBackgroundColor = desktopDefaults.customBackgroundColor"
                ><RotateCcw :size="14" /></button>
              </div>
            </div>
          </div>
          <div class="desktop-setting-row">
            <div class="min-w-0">
              <div class="desktop-setting-label">背景透明度</div>
            </div>
            <SettingsNumberControl
              :model-value="backgroundTransparency"
              :min="0" :max="100" :step="5" unit="%"
              :default-value="100 - desktopDefaults.backgroundOpacity"
              label="背景透明度"
              @update:model-value="backgroundTransparency = $event"
            />
          </div>
        </div>
        <!-- 排版数值：拉动立即生效 -->
        <div class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label">字号</div>
          </div>
          <SettingsNumberControl :model-value="desktopLyricsSettings.playerFontScale" :min="50" :max="200" :step="5"
            :factor="100" unit="%" :default-value="desktopDefaults.playerFontScale" label="字号"
            @update:model-value="desktopLyricsSettings.playerFontScale = $event" />
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label">行距</div>
          </div>
          <SettingsNumberControl :model-value="desktopLyricsSettings.playerLineGap" :min="50" :max="200" :step="5"
            :factor="100" unit="%" :default-value="desktopDefaults.playerLineGap" label="行距"
            @update:model-value="desktopLyricsSettings.playerLineGap = $event" />
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label">字体透明度</div>
          </div>
          <SettingsNumberControl :model-value="fontTransparency" :min="0" :max="100" :step="5"
            unit="%" :default-value="(1 - desktopDefaults.textOpacity) * 100" label="字体透明度"
            @update:model-value="fontTransparency = $event" />
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label">描边阴影</div>
          </div>
          <SettingsNumberControl :model-value="desktopLyricsSettings.firstLineTextShadowStrength" :min="0" :max="100"
            :step="5" :default-value="desktopDefaults.firstLineTextShadowStrength" label="描边阴影"
            @update:model-value="setDesktopTextShadowStrength" />
        </div>
        <div class="desktop-setting-row flex-wrap gap-y-2">
          <div class="min-w-0">
            <div class="desktop-setting-label">阴影颜色</div>
          </div>
          <div class="desktop-color-controls-row">
            <div class="desktop-color-presets-row" role="group" aria-label="阴影预设颜色">
              <button
                v-for="preset in SHADOW_COLOR_PRESETS"
                :key="preset.value"
                type="button"
                class="desktop-color-dot"
                :class="desktopLyricsSettings.textShadowColor === preset.value ? 'desktop-color-dot--active' : ''"
                :style="{ backgroundColor: preset.value, color: preset.value === '#ffffff' || preset.value === '#fbbf24' ? '#273449' : '#ffffff' }"
                :title="preset.label"
                :aria-label="`阴影颜色：${preset.label}`"
                :aria-pressed="desktopLyricsSettings.textShadowColor === preset.value"
                @click="setDesktopTextShadowColor(preset.value)"
              >
                <Check v-if="desktopLyricsSettings.textShadowColor === preset.value" :size="13" :stroke-width="2.5" />
              </button>
              <label class="desktop-color-custom" :class="isCustomShadowColor ? 'desktop-color-custom--active' : ''">自定义
                <input
                  type="color"
                  class="desktop-color-dot-input"
                  aria-label="自定义阴影颜色"
                  :value="desktopLyricsSettings.textShadowColor"
                  @input="setDesktopTextShadowColor(($event.target as HTMLInputElement).value)"
                />
              </label>
              <button
                type="button"
                class="desktop-color-reset"
                title="恢复默认阴影颜色"
                aria-label="恢复默认阴影颜色"
                :disabled="desktopLyricsSettings.textShadowColor === desktopDefaults.textShadowColor"
                @click="setDesktopTextShadowColor(desktopDefaults.textShadowColor)"
              ><RotateCcw :size="14" /></button>
            </div>
          </div>
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label">对齐</div>
          </div>
          <div class="desktop-segmented-control flex overflow-hidden rounded-xl border border-gray-200 bg-white/40 dark:border-white/10 dark:bg-white/5">
            <button
              v-for="option in ALIGNMENT_OPTIONS"
              :key="option.value"
              type="button"
              class="desktop-segmented-btn text-gray-600 dark:text-gray-300 text-center text-xs font-semibold py-1.5 px-3 transition-all"
              :class="desktopLyricsSettings.playerAlignment === option.value ? 'desktop-segmented-btn--active' : ''"
              @click="setDesktopAlignment(option.value)"
            >
              {{ option.label.replace('靠', '').replace('居', '') }}
            </button>
          </div>
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label">描边深度</div>
          </div>
          <SettingsNumberControl :model-value="desktopLyricsSettings.textStrokeDepth" :min="0" :max="100"
            :step="5" :default-value="desktopDefaults.textStrokeDepth" label="描边深度"
            @update:model-value="setDesktopTextStrokeDepth" />
        </div>
        <div class="desktop-setting-row flex-wrap gap-y-2">
          <div class="min-w-0">
            <div class="desktop-setting-label">描边颜色</div>
          </div>
          <div class="desktop-color-controls-row">
            <div class="desktop-color-presets-row" role="group" aria-label="描边预设颜色">
              <button
                v-for="preset in STROKE_COLOR_PRESETS"
                :key="preset.value"
                type="button"
                class="desktop-color-dot"
                :class="desktopLyricsSettings.textStrokeColor === preset.value ? 'desktop-color-dot--active' : ''"
                :style="{ backgroundColor: preset.value, color: preset.value === '#ffffff' || preset.value === '#fbbf24' ? '#273449' : '#ffffff' }"
                :title="preset.label"
                :aria-label="`描边颜色：${preset.label}`"
                :aria-pressed="desktopLyricsSettings.textStrokeColor === preset.value"
                @click="setDesktopTextStrokeColor(preset.value)"
              >
                <Check v-if="desktopLyricsSettings.textStrokeColor === preset.value" :size="13" :stroke-width="2.5" />
              </button>
              <label class="desktop-color-custom" :class="isCustomStrokeColor ? 'desktop-color-custom--active' : ''">自定义
                <input
                  type="color"
                  class="desktop-color-dot-input"
                  aria-label="自定义描边颜色"
                  :value="desktopLyricsSettings.textStrokeColor"
                  @input="setDesktopTextStrokeColor(($event.target as HTMLInputElement).value)"
                />
              </label>
              <button
                type="button"
                class="desktop-color-reset"
                title="恢复默认描边颜色"
                aria-label="恢复默认描边颜色"
                :disabled="desktopLyricsSettings.textStrokeColor === desktopDefaults.textStrokeColor"
                @click="setDesktopTextStrokeColor(desktopDefaults.textStrokeColor)"
              ><RotateCcw :size="14" /></button>
            </div>
          </div>
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label">显示翻译</div>
          </div>
          <button type="button" role="switch" aria-label="显示翻译" :aria-checked="lyricsSettings.showTranslation"
            class="desktop-switch" :class="lyricsSettings.showTranslation ? 'desktop-switch--on' : ''"
            @click="lyricsSettings.showTranslation = !lyricsSettings.showTranslation">
            <span class="desktop-switch-thumb" :class="lyricsSettings.showTranslation ? 'translate-x-5' : ''" />
          </button>
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label">显示罗马音</div>
          </div>
          <button type="button" role="switch" aria-label="显示罗马音" :aria-checked="lyricsSettings.showRomaji"
            class="desktop-switch" :class="lyricsSettings.showRomaji ? 'desktop-switch--on' : ''"
            @click="lyricsSettings.showRomaji = !lyricsSettings.showRomaji">
            <span class="desktop-switch-thumb" :class="lyricsSettings.showRomaji ? 'translate-x-5' : ''" />
          </button>
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label" title="第一行显示当前句，第二行显示下一句，每句自动推进">双行显示</div>
          </div>
          <button type="button" role="switch" aria-label="双行显示" :aria-checked="desktopLyricsSettings.showDoubleLine"
            class="desktop-switch" :class="desktopLyricsSettings.showDoubleLine ? 'desktop-switch--on' : ''"
            @click="desktopLyricsSettings.showDoubleLine = !desktopLyricsSettings.showDoubleLine">
            <span class="desktop-switch-thumb" :class="desktopLyricsSettings.showDoubleLine ? 'translate-x-5' : ''" />
          </button>
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label">字体方案</div>
          </div>
          <SettingsSelect
            class="desktop-background-select"
            label="字体方案"
            hide-label
            trigger-id="desktop-lyrics-font-preset"
            :model-value="desktopLyricsSettings.playerFontPreset"
            :options="FONT_PRESET_SELECT_OPTIONS"
            @update:model-value="setDesktopFontPreset($event as LyricsFontPreset)"
          />
        </div>
        <div class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label">配色方案</div>
          </div>
          <SettingsSelect
            class="desktop-background-select"
            label="配色方案"
            hide-label
            trigger-id="desktop-lyrics-color-scheme"
            :model-value="colorSchemeModel"
            :options="COLOR_SCHEME_SELECT_OPTIONS"
            @update:model-value="colorSchemeModel = $event as LyricsColorScheme"
          />
        </div>
        <div v-if="desktopLyricsSettings.colorScheme === 'custom'" class="desktop-setting-row">
          <div class="min-w-0">
            <div class="desktop-setting-label">字体颜色</div>
          </div>
          <div class="desktop-color-controls-row">
            <div class="desktop-color-presets-row" role="group" aria-label="字体预设颜色">
              <button
                v-for="preset in BACKGROUND_COLOR_PRESETS"
                :key="preset.value"
                type="button"
                class="desktop-color-dot"
                :class="desktopFontColor === preset.value ? 'desktop-color-dot--active' : ''"
                :style="{ backgroundColor: preset.value, color: preset.value === '#ffffff' || preset.value === '#fbbf24' ? '#273449' : '#ffffff' }"
                :title="preset.label"
                :aria-label="`字体颜色：${preset.label}`"
                :aria-pressed="desktopFontColor === preset.value"
                @click="setDesktopFontColor(preset.value)"
              >
                <Check v-if="desktopFontColor === preset.value" :size="13" :stroke-width="2.5" />
              </button>
              <label class="desktop-color-custom" :class="!BACKGROUND_COLOR_PRESETS.some(p => p.value === desktopFontColor) ? 'desktop-color-custom--active' : ''">自定义
                <input
                  type="color"
                  class="desktop-color-dot-input"
                  aria-label="自定义字体颜色"
                  :value="desktopFontColor"
                  @input="setDesktopFontColor(($event.target as HTMLInputElement).value)"
                />
              </label>
              <button
                type="button"
                class="desktop-color-reset"
                title="恢复默认字体颜色"
                aria-label="恢复默认字体颜色"
                :disabled="desktopFontColor === desktopDefaults.customUnplayedColor"
                @click="setDesktopFontColor(desktopDefaults.customUnplayedColor)"
              ><RotateCcw :size="14" /></button>
              <button type="button" class="desktop-color-detail" title="调整各部件颜色" @click="openCustomColorModal">明细</button>
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
                  <span class="desktop-color-swatch" :style="{ backgroundColor: desktopLyricsSettings.customPlayedColor }"></span>
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
                  <span class="desktop-color-swatch" :style="{ backgroundColor: desktopLyricsSettings.customUnplayedColor }"></span>
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
                  <span class="desktop-color-swatch" :style="{ backgroundColor: desktopLyricsSettings.customRomajiPlayedColor }"></span>
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
                  <span class="desktop-color-swatch" :style="{ backgroundColor: desktopLyricsSettings.customRomajiUnplayedColor }"></span>
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
                  <span class="desktop-color-swatch" :style="{ backgroundColor: desktopLyricsSettings.customTranslationColor }"></span>
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
.desktop-lyrics-settings,
.desktop-font-menu,
.desktop-custom-modal {
  /* 桌面歌词设置组件 - 浅色模式 CSS 变量 */
  --desktop-chip-bg: rgba(255, 255, 255, 0.72);
  --desktop-chip-border: rgba(15, 23, 42, 0.08);
  --desktop-chip-text: rgb(55 65 81);
  --desktop-chip-active-bg: rgba(236, 65, 65, 0.12);
  --desktop-chip-active-border: rgba(236, 65, 65, 0.28);
  --desktop-chip-active-text: #ec4141;
  --desktop-font-trigger-bg: #f5f6f9;
  --desktop-font-trigger-text: #273449;
  --desktop-font-trigger-border: #d7dce5;
  --desktop-font-trigger-shadow: none;
  --desktop-font-trigger-active-bg: #fff5f5;
  --desktop-font-trigger-active-border: rgba(236, 65, 65, 0.32);
  --desktop-font-trigger-active-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 14px 30px rgba(236, 65, 65, 0.08);
  --desktop-font-menu-bg: #fafbfc;
  --desktop-font-menu-border: #d7dce5;
  --desktop-font-menu-shadow: 0 24px 60px rgba(15, 23, 42, 0.16), 0 10px 24px rgba(15, 23, 42, 0.08);
  --desktop-font-menu-header-color: rgba(71, 85, 105, 0.92);
  --desktop-font-menu-header-border: rgba(148, 163, 184, 0.12);
  --desktop-font-option-text: rgb(55 65 81);
  --desktop-font-option-hover-bg: rgba(236, 65, 65, 0.06);
  --desktop-font-option-hover-border: rgba(236, 65, 65, 0.16);
  --desktop-font-option-hover-text: rgb(17 24 39);
  --desktop-font-option-active-bg: linear-gradient(180deg, rgba(236, 65, 65, 0.12), rgba(236, 65, 65, 0.06));
  --desktop-font-option-active-border: rgba(236, 65, 65, 0.2);
  --desktop-font-option-active-text: #c83232;
}
.dark .desktop-lyrics-settings,
.dark .desktop-font-menu,
.dark .desktop-custom-modal {
  /* 桌面歌词设置组件 - 深色模式 CSS 变量重写 */
  --desktop-chip-bg: rgba(255, 255, 255, 0.04);
  --desktop-chip-border: rgba(255, 255, 255, 0.08);
  --desktop-chip-text: rgba(255, 255, 255, 0.82);
  --desktop-chip-active-bg: rgba(236, 65, 65, 0.14);
  --desktop-chip-active-border: rgba(236, 65, 65, 0.35);
  --desktop-chip-active-text: #ff8b8b;
  --desktop-font-trigger-bg: #30343e;
  --desktop-font-trigger-text: #edf0f5;
  --desktop-font-trigger-border: #4a5160;
  --desktop-font-trigger-shadow: none;
  --desktop-font-trigger-active-bg: #3b2d35;
  --desktop-font-trigger-active-border: rgba(236, 65, 65, 0.34);
  --desktop-font-trigger-active-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 16px 36px rgba(0, 0, 0, 0.24);
  --desktop-font-menu-bg: #24262d;
  --desktop-font-menu-border: #414652;
  --desktop-font-menu-shadow: 0 24px 60px rgba(0, 0, 0, 0.34), 0 10px 24px rgba(0, 0, 0, 0.24);
  --desktop-font-menu-header-color: #b5bfce;
  --desktop-font-menu-header-border: rgba(255, 255, 255, 0.06);
  --desktop-font-option-text: rgba(255, 255, 255, 0.84);
  --desktop-font-option-hover-bg: rgba(236, 65, 65, 0.1);
  --desktop-font-option-hover-border: rgba(236, 65, 65, 0.22);
  --desktop-font-option-hover-text: rgba(255, 255, 255, 0.98);
  --desktop-font-option-active-bg: linear-gradient(180deg, rgba(236, 65, 65, 0.18), rgba(236, 65, 65, 0.08));
  --desktop-font-option-active-border: rgba(236, 65, 65, 0.28);
  --desktop-font-option-active-text: #ff9a9a;
}
/* 歌词排版：标签与控件各占一列，所有滑块左端严格对齐；标签强制单行不竖排。 */
.desktop-typography-section .desktop-setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 440px;
  flex-wrap: nowrap;
  justify-items: end;
  column-gap: 16px;
}

.desktop-typography-section .desktop-setting-row > :first-child {
  justify-self: start;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.desktop-typography-section .desktop-setting-label { white-space: nowrap; }
.desktop-typography-section .desktop-color-controls-row { justify-content: flex-end; }
.desktop-typography-section .desktop-segmented-control { justify-self: end; width: 224px; }
.desktop-typography-section .desktop-segmented-btn { flex: 1 1 0; width: 0; padding: 0 4px; }

@media (max-width: 900px) {
  .desktop-typography-section .desktop-setting-row,
  .desktop-typography-section .desktop-bg-subpanel .desktop-setting-row { grid-template-columns: minmax(0, 1fr) 290px; }
}

.desktop-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid var(--settings-divider);
  text-align: left;
  transition: background-color 160ms ease;
}
.desktop-setting-row:last-child {
  border-bottom: 0;
}
.desktop-setting-row:hover {
  background: rgba(128, 128, 128, 0.04);
}
.dark .desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.035);
}
.desktop-overflow-row { flex-wrap: wrap; }
.desktop-overflow-copy { flex: 1 1 auto; min-width: 0; }
.desktop-overflow-select { flex: 0 1 220px; width: 220px; max-width: 100%; }
/* 与铃动窗设置页的下拉选择器同宽度 */
.desktop-background-select { flex: 0 1 224px; width: 224px; max-width: 100%; }
/* 「始终显示背景」的次级面板：缩进 + 浅底，与铃动窗逐字效果子设置一致 */
.desktop-bg-subpanel {
  margin: 0 0 4px 16px;
  padding: 0 14px;
  border-radius: 10px;
  background: rgb(128 128 128 / 0.04);
}
.desktop-bg-subpanel .desktop-setting-row { min-height: 52px; }

/* 次级面板整体缩进 30px，控制列相应收窄以保持滑块左端与上级行对齐 */
.desktop-typography-section .desktop-bg-subpanel .desktop-setting-row {
  grid-template-columns: minmax(0, 1fr) 410px;
}
.desktop-setting-label {
  font-size: 14px;
  font-weight: 500;
  color: rgb(31 41 55);
}
.dark .desktop-setting-label { color: rgb(229 231 235); }
/* 颜色行：与铃动窗「字体颜色」一致的 24px 圆点 + 自定义 + 恢复默认 */
.desktop-color-controls-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px 10px;
}
.desktop-color-presets-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
}
.desktop-color-dot {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid rgb(128 128 128 / 0.2);
  border-radius: 50%;
  transition: transform 160ms;
}
.desktop-color-dot:hover { transform: scale(1.1); }
.desktop-color-dot--active {
  box-shadow: 0 0 0 2px rgb(236 65 65 / 0.45);
}
.desktop-color-custom {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--app-text-secondary);
}
.desktop-color-custom--active { color: #ec4141; }
.desktop-color-dot-input {
  width: 30px;
  height: 26px;
  padding: 2px;
  border: 1px solid rgb(128 128 128 / 25%);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.desktop-color-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: var(--app-text-secondary);
  transition: color 160ms, background-color 160ms;
}
.desktop-color-reset:hover:not(:disabled) {
  color: #ec4141;
  background: rgb(236 65 65 / 0.08);
}
.desktop-color-reset:disabled { opacity: 0.3; cursor: not-allowed; }

.desktop-color-detail {
  margin-left: 2px;
  padding: 4px 8px;
  border: 1px solid rgb(128 128 128 / 0.22);
  border-radius: 6px;
  font-size: 12px;
  color: var(--app-text-secondary);
  transition: color 160ms, border-color 160ms;
}

.desktop-color-detail:hover { color: #ec4141; border-color: rgb(236 65 65 / 0.4); }
.desktop-color-dot:focus-visible,
.desktop-color-reset:focus-visible,
.desktop-color-dot-input:focus-visible {
  outline: 2px solid #ec4141;
  outline-offset: 3px;
}
/* 字体方案行内的下拉触发器宽度 */
.desktop-font-picker-row { flex: 0 1 224px; width: 224px; max-width: 100%; }
.desktop-setting-expand {
  overflow: hidden;
  border-top: 1px solid var(--settings-divider);
}
.desktop-setting-expand-inner {
  padding: 16px;
}
.desktop-typography-row {
  padding: 16px;
  border-bottom: 1px solid var(--settings-divider);
  transition: background-color 160ms ease;
}
.desktop-typography-row:last-child {
  border-bottom: 0;
}
.desktop-typography-row:hover {
  background: rgba(128, 128, 128, 0.04);
}
.dark .desktop-typography-row:hover {
  background: rgba(255, 255, 255, 0.035);
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
.dark .desktop-switch {
  background: rgb(55 65 81);
}
.dark .desktop-switch--on {
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
.dark .desktop-card {
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
  width: min(224px, 100%);
  flex: 0 1 224px;
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
  color: var(--desktop-font-trigger-text);
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
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--desktop-font-menu-border);
  border-radius: 12px;
  background: var(--desktop-font-menu-bg);
  box-shadow: var(--desktop-font-menu-shadow);
  z-index: 120;
}
.desktop-font-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--desktop-font-menu-header-border);
  color: var(--desktop-font-menu-header-color);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
}
.desktop-font-menu-list {
  min-height: 0;
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
}
.desktop-font-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
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
.desktop-inline-reset,
.desktop-reset-button,
.desktop-action-button,
.desktop-chip {
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
}
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
.dark .desktop-custom-modal {
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
.dark .desktop-color-picker {
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
.dark .desktop-custom-color-panel {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 20, 0.96);
}
.desktop-custom-color-panel-title {
  padding: 14px 16px 12px;
  color: rgb(31 41 55);
  font-size: 14px;
  font-weight: 800;
}
.dark .desktop-custom-color-panel-title {
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
.dark .desktop-custom-rgb-row label {
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
.dark .desktop-custom-rgb-row input {
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
.desktop-segmented-control {
  padding: 2px;
  background: rgba(15, 23, 42, 0.03);
  border: 1px solid rgba(15, 23, 42, 0.04);
  border-radius: 9px;
  gap: 2px;
  height: 28px;
  box-sizing: border-box;
}
.dark .desktop-segmented-control {
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
.dark .desktop-segmented-btn {
  color: rgba(255, 255, 255, 0.85) !important;
}
.desktop-segmented-btn:hover {
  color: #ec4141;
  background: rgba(255, 255, 255, 0.5);
}
.dark .desktop-segmented-btn:hover {
  color: #ff8b8b !important;
  background: rgba(255, 255, 255, 0.1) !important;
}
/* 激活态的分段按钮 */
.desktop-segmented-btn--active {
  background: #fff !important;
  color: #ec4141 !important;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 4px 10px rgba(15, 23, 42, 0.03);
}
.dark .desktop-segmented-btn--active {
  background: rgba(255, 255, 255, 0.18) !important;
  color: #ff8b8b !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
/* ==========================================================================
   精致极细滑动条样式 (iOS / macOS 风格定制)
   ========================================================================== */
</style>