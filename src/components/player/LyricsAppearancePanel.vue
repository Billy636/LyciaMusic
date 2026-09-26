<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog';
import { Trash2, X } from 'lucide-vue-next';
import { computed, nextTick, onMounted, onUnmounted, ref, toRefs, watch } from 'vue';
import {
  DEFAULT_PLAYER_ALIGNMENT,
  DEFAULT_PLAYER_FONT_PRESET,
  DEFAULT_PLAYER_FONT_SCALE,
  DEFAULT_PLAYER_LINE_GAP,
  DEFAULT_PLAYER_OFFSET_X,
  DEFAULT_PLAYER_OFFSET_Y,
  buildImportedLyricsFontOptions,
  importLyricsFontFile,
  LYRICS_FONT_OPTIONS,
  MAX_PLAYER_FONT_SCALE,
  MAX_PLAYER_LINE_GAP,
  MAX_PLAYER_OFFSET_X,
  MAX_PLAYER_OFFSET_Y,
  MIN_PLAYER_FONT_SCALE,
  MIN_PLAYER_LINE_GAP,
  MIN_PLAYER_OFFSET_X,
  MIN_PLAYER_OFFSET_Y,
  loadSystemLyricsFonts,
  normalizeLyricsFontPreset,
  systemLyricsFontOptions,
  type LyricsFontPreset,
  type LyricsPlayerAlignment,
  type LyricsPlayerRenderMode,
  useLyrics,
} from '../../composables/lyrics';
import { useSettingsStore } from '../../features/settings/store';
import { usePlayer } from '../../composables/player';
import LyricsReadingOrderControl from './LyricsReadingOrderControl.vue';
import { useLyricsAppearanceDraft, type LyricsAppearanceDraft } from './useLyricsAppearanceDraft';
import './playerSidePanel.css';

const emit = defineEmits<{ preview: [draft: LyricsAppearanceDraft] }>();
const { lyricsSettings, showLyricsPlayerSettingsPanel } = useLyrics();
const { showPlayerDetail } = usePlayer();
const settingsStore = useSettingsStore();

const FONT_SCALE_STEP = 0.05;
const LINE_GAP_STEP = 0.05;
const OFFSET_STEP = 1;
const FONT_FILE_FILTERS = [{ name: 'Font', extensions: ['ttf', 'otf'] }];
type FontPresetMenuMode = 'system' | 'custom';
const PLAYER_ALIGNMENT_OPTIONS: Array<{ value: LyricsPlayerAlignment; label: string }> = [
  { value: 'left', label: '靠左' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '靠右' },
];
const PLAYER_RENDER_MODE_OPTIONS: Array<{ value: LyricsPlayerRenderMode; label: string }> = [
  { value: 'amll', label: 'AMLL' },
  { value: 'light', label: '轻量' },
];

const fontPanelRef = ref<HTMLElement | null>(null);
const systemFontPresetTriggerRef = ref<HTMLElement | null>(null);
const customFontPresetTriggerRef = ref<HTMLElement | null>(null);
const fontPresetMenuRef = ref<HTMLElement | null>(null);
const isFontPresetMenuOpen = ref(false);
const fontPresetMenuMode = ref<FontPresetMenuMode | null>(null);
const fontPresetMenuStyle = ref<Record<string, string>>({});
const {
  draft,
  setField: setAppearanceField,
  commit: commitDraftLyricsSettings,
} = useLyricsAppearanceDraft(
  () => lyricsSettings,
  (patch) => settingsStore.patchSettings({ lyrics: patch }),
  (preview) => emit('preview', preview),
);
const {
  playerFontScale: previewPlayerFontScale,
  playerLineGap: previewPlayerLineGap,
  playerOffsetX: previewPlayerOffsetX,
  playerOffsetY: previewPlayerOffsetY,
} = toRefs(draft);

const fontScalePercent = computed(() => `${Math.round(previewPlayerFontScale.value * 100)}%`);
const lineGapPercent = computed(() => `${Math.round(previewPlayerLineGap.value * 100)}%`);
const horizontalOffsetPercent = computed(() => formatOffsetValue(previewPlayerOffsetX.value));
const verticalOffsetPercent = computed(() => formatOffsetValue(previewPlayerOffsetY.value));
const customFontOptions = computed(() => buildImportedLyricsFontOptions(settingsStore.settings.customLyricsFonts));
const systemFontOptions = computed(() => [
  ...LYRICS_FONT_OPTIONS,
  ...systemLyricsFontOptions.value,
]);
const isUsingCustomFont = computed(() => {
  return customFontOptions.value.some((option) => option.value === lyricsSettings.playerFontPreset);
});
const selectedSystemFontLabel = computed(() => {
  if (isUsingCustomFont.value) return '跟随系统默认';

  return systemFontOptions.value.find((option) => option.value === lyricsSettings.playerFontPreset)?.label
    ?? normalizeLyricsFontPreset(lyricsSettings.playerFontPreset);
});
const selectedCustomFontLabel = computed(() => {
  return customFontOptions.value.find((option) => option.value === lyricsSettings.playerFontPreset)?.label
    ?? '自定义字体';
});

const fontScaleProgress = computed(() => {
  return ((previewPlayerFontScale.value - MIN_PLAYER_FONT_SCALE) / (MAX_PLAYER_FONT_SCALE - MIN_PLAYER_FONT_SCALE)) * 100;
});

const lineGapProgress = computed(() => {
  return ((previewPlayerLineGap.value - MIN_PLAYER_LINE_GAP) / (MAX_PLAYER_LINE_GAP - MIN_PLAYER_LINE_GAP)) * 100;
});

const horizontalOffsetProgress = computed(() => {
  return ((previewPlayerOffsetX.value - MIN_PLAYER_OFFSET_X) / (MAX_PLAYER_OFFSET_X - MIN_PLAYER_OFFSET_X)) * 100;
});

const verticalOffsetProgress = computed(() => {
  return ((previewPlayerOffsetY.value - MIN_PLAYER_OFFSET_Y) / (MAX_PLAYER_OFFSET_Y - MIN_PLAYER_OFFSET_Y)) * 100;
});

function formatOffsetValue(value: number) {
  return `${value > 0 ? '+' : ''}${Math.round(value)}%`;
}

function setPlayerFontScale(value: number, immediately = true) {
  setAppearanceField('playerFontScale', value, immediately);
}

function setPlayerLineGap(value: number, immediately = true) {
  setAppearanceField('playerLineGap', value, immediately);
}

function setPlayerOffsetX(value: number, immediately = true) {
  setAppearanceField('playerOffsetX', value, immediately);
}

function setPlayerOffsetY(value: number, immediately = true) {
  setAppearanceField('playerOffsetY', value, immediately);
}

function setPlayerAlignment(value: LyricsPlayerAlignment) {
  lyricsSettings.playerAlignment = value;
}

function setPlayerFontPreset(value: LyricsFontPreset) {
  lyricsSettings.playerFontPreset = value;
}

function setPlayerRenderMode(value: LyricsPlayerRenderMode) {
  settingsStore.patchSettings({ lyrics: { playerRenderMode: value } });
}

function adjustPlayerFontScale(delta: number) {
  setPlayerFontScale(previewPlayerFontScale.value + delta);
}

function resetPlayerFontScale() {
  setPlayerFontScale(DEFAULT_PLAYER_FONT_SCALE);
}

function resetPlayerLineGap() {
  setPlayerLineGap(DEFAULT_PLAYER_LINE_GAP);
}

function resetPlayerAlignment() {
  setPlayerAlignment(DEFAULT_PLAYER_ALIGNMENT);
}

function resetPlayerOffsetX() {
  setPlayerOffsetX(DEFAULT_PLAYER_OFFSET_X);
}

function resetPlayerOffsetY() {
  setPlayerOffsetY(DEFAULT_PLAYER_OFFSET_Y);
}

function resetPlayerFontPreset() {
  setPlayerFontPreset(DEFAULT_PLAYER_FONT_PRESET);
}

function toggleTranslation() {
  lyricsSettings.showTranslation = !lyricsSettings.showTranslation;
}

function toggleRomaji() {
  lyricsSettings.showRomaji = !lyricsSettings.showRomaji;
}

function handleFontScaleInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;

  setPlayerFontScale(Number(target.value), false);
}

function handleLineGapInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;

  setPlayerLineGap(Number(target.value), false);
}

function handleOffsetXInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;

  setPlayerOffsetX(Number(target.value), false);
}

function handleOffsetYInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;

  setPlayerOffsetY(Number(target.value), false);
}

function selectFontPreset(value: LyricsFontPreset) {
  setPlayerFontPreset(normalizeLyricsFontPreset(value));
  isFontPresetMenuOpen.value = false;
  fontPresetMenuMode.value = null;
}

async function importCustomLyricsFont() {
  const selected = await open({
    multiple: false,
    directory: false,
    title: '导入歌词字体',
    filters: FONT_FILE_FILTERS,
  });

  if (typeof selected !== 'string') return;

  try {
    const importedFont = await importLyricsFontFile(selected);
    const remainingFonts = settingsStore.settings.customLyricsFonts.filter((font) => {
      return font.family !== importedFont.family && font.filePath !== importedFont.filePath;
    });
    const shouldApplyToDesktopLyrics = settingsStore.settings.desktopLyrics.playerFontPreset === DEFAULT_PLAYER_FONT_PRESET;

    settingsStore.patchSettings({
      customLyricsFonts: [importedFont, ...remainingFonts],
      lyrics: { playerFontPreset: importedFont.family },
      ...(shouldApplyToDesktopLyrics
        ? { desktopLyrics: { playerFontPreset: importedFont.family } }
        : {}),
    });
    isFontPresetMenuOpen.value = false;
    fontPresetMenuMode.value = null;
  } catch (error) {
    console.warn('Failed to import custom lyrics font:', error);
  }
}

function removeCustomLyricsFont(value: LyricsFontPreset) {
  const normalizedFamily = normalizeLyricsFontPreset(value);
  const remainingFonts = settingsStore.settings.customLyricsFonts.filter((font) => {
    return font.family !== normalizedFamily;
  });

  settingsStore.patchSettings({
    customLyricsFonts: remainingFonts,
    ...(lyricsSettings.playerFontPreset === normalizedFamily
      ? { lyrics: { playerFontPreset: DEFAULT_PLAYER_FONT_PRESET } }
      : {}),
    ...(settingsStore.settings.desktopLyrics.playerFontPreset === normalizedFamily
      ? { desktopLyrics: { playerFontPreset: DEFAULT_PLAYER_FONT_PRESET } }
      : {}),
  });
}

function updateFontPresetMenuPosition() {
  const trigger = fontPresetMenuMode.value === 'custom'
    ? customFontPresetTriggerRef.value
    : systemFontPresetTriggerRef.value;
  if (!trigger) return;

  const panel = fontPanelRef.value;
  if (!panel) return;

  const panelRect = panel.getBoundingClientRect();
  const menuWidth = 280;
  const gap = 0;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = panelRect.right + gap;
  if (left + menuWidth > viewportWidth - 16) {
    left = Math.max(16, panelRect.left - gap - menuWidth);
  }

  const bottomDist = viewportHeight - panelRect.bottom;

  fontPresetMenuStyle.value = {
    position: 'fixed',
    left: `${Math.round(left)}px`,
    bottom: `${Math.round(bottomDist)}px`,
    width: `${menuWidth}px`,
    maxHeight: `${Math.round(Math.min(420, panelRect.bottom - 16))}px`,
  };
}

function closeFontPresetMenu() {
  isFontPresetMenuOpen.value = false;
  fontPresetMenuMode.value = null;
}

async function toggleFontPresetMenu(mode: FontPresetMenuMode) {
  if (isFontPresetMenuOpen.value && fontPresetMenuMode.value === mode) {
    isFontPresetMenuOpen.value = false;
    fontPresetMenuMode.value = null;
    return;
  }

  fontPresetMenuMode.value = mode;
  isFontPresetMenuOpen.value = true;
  if (isFontPresetMenuOpen.value) {
    await nextTick();
    updateFontPresetMenuPosition();

    const menuEl = fontPresetMenuRef.value;
    if (menuEl) {
      const activeItem = menuEl.querySelector('.active-font-preset') as HTMLElement | null;
      const scrollContainer = menuEl.querySelector('.custom-scrollbar') as HTMLElement | null;
      if (activeItem && scrollContainer) {
        // Disable smooth scrolling temporarily to jump instantly
        scrollContainer.style.scrollBehavior = 'auto';
        const itemTop = activeItem.offsetTop;
        const itemHeight = activeItem.offsetHeight;
        const containerHeight = scrollContainer.clientHeight;
        scrollContainer.scrollTop = itemTop - (containerHeight / 2) + (itemHeight / 2);
        // Restore smooth scrolling if needed
        scrollContainer.style.scrollBehavior = '';
      }
    }
  }
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (fontPanelRef.value?.contains(target)) return;
  if (fontPresetMenuRef.value?.contains(target)) return;
  isFontPresetMenuOpen.value = false;
  fontPresetMenuMode.value = null;
  showLyricsPlayerSettingsPanel.value = false;
}

function handlePanelKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.key !== 'Escape' || !showLyricsPlayerSettingsPanel.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (isFontPresetMenuOpen.value) {
    const trigger = fontPresetMenuMode.value === 'custom'
      ? customFontPresetTriggerRef.value : systemFontPresetTriggerRef.value;
    isFontPresetMenuOpen.value = false;
    fontPresetMenuMode.value = null;
    trigger?.focus();
  } else {
    showLyricsPlayerSettingsPanel.value = false;
  }
}

watch(showLyricsPlayerSettingsPanel, (visible) => {
  if (!visible) {
    isFontPresetMenuOpen.value = false;
    fontPresetMenuMode.value = null;
    commitDraftLyricsSettings();
  }
});

// A body teleport no longer inherits the detail page's leave animation or
// pointer-events. Close it immediately when its owning view is hidden.
watch(showPlayerDetail, (detailVisible) => {
  if (!detailVisible) showLyricsPlayerSettingsPanel.value = false;
}, { flush: 'sync' });

onMounted(() => {
  window.addEventListener('mousedown', handleClickOutside);
  window.addEventListener('keydown', handlePanelKeydown);
  window.addEventListener('resize', updateFontPresetMenuPosition);
  void loadSystemLyricsFonts();
});

onUnmounted(() => {
  commitDraftLyricsSettings();
  window.removeEventListener('mousedown', handleClickOutside);
  window.removeEventListener('keydown', handlePanelKeydown);
  window.removeEventListener('resize', updateFontPresetMenuPosition);
  showLyricsPlayerSettingsPanel.value = false;
  isFontPresetMenuOpen.value = false;
  fontPresetMenuMode.value = null;
});
</script>

<template>
    <Teleport to="body">
      <transition name="player-side-panel">
        <aside
          v-if="showPlayerDetail && showLyricsPlayerSettingsPanel"
          ref="fontPanelRef"
          aria-labelledby="lyrics-appearance-title"
          data-shortcut-capture="true"
          class="player-side-panel player-side-panel--left pointer-events-auto"
          @click.stop
          @mousedown.stop
        >
          <header class="player-side-panel__header">
            <div>
              <div class="player-side-panel__eyebrow">Style</div>
              <h3 id="lyrics-appearance-title" class="player-side-panel__title">歌词样式</h3>
            </div>
            <button
              type="button"
              class="player-side-panel__icon-button"
              title="关闭歌词样式"
              aria-label="关闭歌词样式"
              @click="showLyricsPlayerSettingsPanel = false"
            >
              <X :size="16" />
            </button>
          </header>
          <div class="player-side-panel__scroll px-4 py-4">
          <div class="mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Render</div>
            <div class="mt-1.5 flex items-center justify-between">
              <span class="text-[13px] font-medium text-white/85">歌词效果</span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="option in PLAYER_RENDER_MODE_OPTIONS"
              :key="option.value"
              type="button"
              class="flex h-10 items-center justify-center rounded-2xl border px-3 text-sm font-medium transition"
              :class="lyricsSettings.playerRenderMode === option.value
                ? 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'"
              @click="setPlayerRenderMode(option.value)"
            >
              {{ option.label }}
            </button>
          </div>

          <div class="mt-6 mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Lyrics</div>
            <div class="mt-1.5 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-[13px] font-medium text-white/85">字体大小</span>
                <button
                  v-if="previewPlayerFontScale !== DEFAULT_PLAYER_FONT_SCALE"
                  type="button"
                  class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="resetPlayerFontScale"
                  title="重置"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </button>
              </div>
              <span class="text-xs font-medium tabular-nums text-white/60">{{ fontScalePercent }}</span>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="previewPlayerFontScale <= MIN_PLAYER_FONT_SCALE"
              @click="adjustPlayerFontScale(-FONT_SCALE_STEP)"
            >
              A-
            </button>

            <input
              class="font-size-slider h-1 flex-1 cursor-pointer appearance-none rounded-full"
              :style="{ background: `linear-gradient(to right, rgba(255,255,255,0.85) ${fontScaleProgress}%, rgba(255,255,255,0.12) ${fontScaleProgress}%)` }"
              type="range"
              :min="MIN_PLAYER_FONT_SCALE"
              :max="MAX_PLAYER_FONT_SCALE"
              :step="FONT_SCALE_STEP"
              :value="previewPlayerFontScale"
              @input="handleFontScaleInput"
              @change="commitDraftLyricsSettings"
            />

            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="previewPlayerFontScale >= MAX_PLAYER_FONT_SCALE"
              @click="adjustPlayerFontScale(FONT_SCALE_STEP)"
            >
              A+
            </button>
          </div>

          <div class="mt-6 mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Spacing</div>
            <div class="mt-1.5 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-[13px] font-medium text-white/85">歌词间距</span>
                <button
                  v-if="previewPlayerLineGap !== DEFAULT_PLAYER_LINE_GAP"
                  type="button"
                  class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="resetPlayerLineGap"
                  title="重置"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </button>
              </div>
              <span class="text-xs font-medium tabular-nums text-white/60">{{ lineGapPercent }}</span>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-full text-base font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="previewPlayerLineGap <= MIN_PLAYER_LINE_GAP"
              @click="setPlayerLineGap(previewPlayerLineGap - LINE_GAP_STEP)"
            >
              -
            </button>

            <input
              class="font-size-slider h-1 flex-1 cursor-pointer appearance-none rounded-full"
              :style="{ background: `linear-gradient(to right, rgba(255,255,255,0.85) ${lineGapProgress}%, rgba(255,255,255,0.12) ${lineGapProgress}%)` }"
              type="range"
              :min="MIN_PLAYER_LINE_GAP"
              :max="MAX_PLAYER_LINE_GAP"
              :step="LINE_GAP_STEP"
              :value="previewPlayerLineGap"
              @input="handleLineGapInput"
              @change="commitDraftLyricsSettings"
            />

            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-full text-base font-light text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="previewPlayerLineGap >= MAX_PLAYER_LINE_GAP"
              @click="setPlayerLineGap(previewPlayerLineGap + LINE_GAP_STEP)"
            >
              +
            </button>
          </div>

          <div class="mt-6 mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Subtitles</div>
            <div class="mt-1.5 flex items-center justify-between gap-3">
              <span class="text-[13px] font-medium text-white/85">副行显示</span>
              <span class="text-[11px] font-medium text-white/42">
                {{ Number(lyricsSettings.showTranslation) + Number(lyricsSettings.showRomaji) }}/2
              </span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="flex h-10 items-center justify-center rounded-2xl border px-3 text-sm font-medium transition"
              :class="lyricsSettings.showTranslation
                ? 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'"
              @click="toggleTranslation"
            >
              显示翻译
            </button>

            <button
              type="button"
              class="flex h-10 items-center justify-center rounded-2xl border px-3 text-sm font-medium transition"
              :class="lyricsSettings.showRomaji
                ? 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'"
              @click="toggleRomaji"
            >
              显示罗马音
            </button>
          </div>

          <div class="mt-6 mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Alignment</div>
            <div class="mt-1.5 flex items-center justify-between gap-3">
              <span class="text-[13px] font-medium text-white/85">歌词位置</span>
              <button
                v-if="lyricsSettings.playerAlignment !== DEFAULT_PLAYER_ALIGNMENT"
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                @click="resetPlayerAlignment"
                title="Reset"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="option in PLAYER_ALIGNMENT_OPTIONS"
              :key="option.value"
              type="button"
              class="flex h-9 items-center justify-center rounded-2xl border px-3 text-xs font-medium transition"
              :class="lyricsSettings.playerAlignment === option.value
                ? 'border-white/25 bg-white/14 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'"
              @click="setPlayerAlignment(option.value)"
            >
              {{ option.label }}
            </button>
          </div>

          <div class="mt-6 mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Offset</div>
            <div class="mt-1.5 flex items-center justify-between gap-3">
              <span class="text-[13px] font-medium text-white/85">歌词偏移</span>
              <div class="flex items-center gap-1">
                <button
                  v-if="previewPlayerOffsetX !== DEFAULT_PLAYER_OFFSET_X"
                  type="button"
                  class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="resetPlayerOffsetX"
                  title="Reset horizontal offset"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </button>
                <button
                  v-if="previewPlayerOffsetY !== DEFAULT_PLAYER_OFFSET_Y"
                  type="button"
                  class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                  @click="resetPlayerOffsetY"
                  title="Reset vertical offset"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </button>
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-white/70">水平</span>
                <span class="text-[11px] font-medium tabular-nums text-white/48">{{ horizontalOffsetPercent }}</span>
              </div>
              <input
                class="font-size-slider h-1 w-full cursor-pointer appearance-none rounded-full"
                :style="{ background: `linear-gradient(to right, rgba(255,255,255,0.85) ${horizontalOffsetProgress}%, rgba(255,255,255,0.12) ${horizontalOffsetProgress}%)` }"
                type="range"
                :min="MIN_PLAYER_OFFSET_X"
                :max="MAX_PLAYER_OFFSET_X"
                :step="OFFSET_STEP"
                :value="previewPlayerOffsetX"
                @input="handleOffsetXInput"
                @change="commitDraftLyricsSettings"
              />
            </div>

            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-white/70">垂直</span>
                <span class="text-[11px] font-medium tabular-nums text-white/48">{{ verticalOffsetPercent }}</span>
              </div>
              <input
                class="font-size-slider h-1 w-full cursor-pointer appearance-none rounded-full"
                :style="{ background: `linear-gradient(to right, rgba(255,255,255,0.85) ${verticalOffsetProgress}%, rgba(255,255,255,0.12) ${verticalOffsetProgress}%)` }"
                type="range"
                :min="MIN_PLAYER_OFFSET_Y"
                :max="MAX_PLAYER_OFFSET_Y"
                :step="OFFSET_STEP"
                :value="previewPlayerOffsetY"
                @input="handleOffsetYInput"
                @change="commitDraftLyricsSettings"
              />
            </div>
          </div>

          <LyricsReadingOrderControl @open="closeFontPresetMenu" />

          <div class="mt-6 mb-3">
            <div class="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/30">Font</div>
            <div class="mt-1.5 flex items-center justify-between gap-3">
              <span class="text-[13px] font-medium text-white/85">歌词字体</span>
              <button
                v-if="lyricsSettings.playerFontPreset !== DEFAULT_PLAYER_FONT_PRESET"
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                @click="resetPlayerFontPreset"
                title="Reset"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </button>
            </div>
          </div>

          <div class="space-y-2">
            <button
              ref="systemFontPresetTriggerRef"
              type="button"
              class="font-preset-trigger"
              :class="[
                !isUsingCustomFont ? 'font-preset-trigger--active' : 'font-preset-trigger--muted',
                isFontPresetMenuOpen && fontPresetMenuMode === 'system' ? 'font-preset-trigger--open' : '',
              ]"
              @click="toggleFontPresetMenu('system')"
            >
              <span class="min-w-0 flex-1 truncate">{{ selectedSystemFontLabel }}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="shrink-0 text-white/45 transition-transform duration-200"
                :class="isFontPresetMenuOpen && fontPresetMenuMode === 'system' ? 'rotate-180 text-white/70' : ''"
              >
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>

            <button
              ref="customFontPresetTriggerRef"
              type="button"
              class="font-preset-trigger"
              :class="[
                isUsingCustomFont ? 'font-preset-trigger--active' : 'font-preset-trigger--muted',
                isFontPresetMenuOpen && fontPresetMenuMode === 'custom' ? 'font-preset-trigger--open' : '',
              ]"
              @click="toggleFontPresetMenu('custom')"
            >
              <span class="min-w-0 flex-1 truncate">{{ selectedCustomFontLabel }}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="shrink-0 text-white/45 transition-transform duration-200"
                :class="isFontPresetMenuOpen && fontPresetMenuMode === 'custom' ? 'rotate-180 text-white/70' : ''"
              >
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
          </div>

          </div>
        </aside>
      </transition>
    </Teleport>

    <Teleport to="body">
      <transition name="font-preset-menu">
        <div
          v-if="isFontPresetMenuOpen"
          ref="fontPresetMenuRef"
          data-shortcut-capture="true"
          class="z-[120] flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/30 p-2 text-white shadow-[0_28px_70px_rgba(0,0,0,0.36)] backdrop-blur-2xl"
          :style="fontPresetMenuStyle"
          @click.stop
          @mousedown.stop
        >
          <div class="min-h-0 overflow-y-auto pr-1 custom-scrollbar">
            <div
              v-if="fontPresetMenuMode === 'system'"
              class="space-y-1"
            >
              <button
                v-for="option in systemFontOptions"
                :key="option.value"
                type="button"
                class="font-option-row"
                :class="lyricsSettings.playerFontPreset === option.value
                  ? 'font-option-row--active active-font-preset'
                  : ''"
                @click="selectFontPreset(option.value)"
              >
                <span class="min-w-0 flex-1 truncate" :title="option.label">{{ option.label }}</span>
                <span
                  v-if="lyricsSettings.playerFontPreset === option.value"
                  class="shrink-0 rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-medium text-white/58"
                >
                  当前
                </span>
              </button>
            </div>

            <div
              v-if="fontPresetMenuMode === 'custom'"
              class="space-y-2"
            >
              <div class="font-custom-menu-header">
                <span>自定义</span>
                <button
                  type="button"
                  class="font-import-button"
                  title="导入自定义字体"
                  @click="importCustomLyricsFont"
                >
                  <span>导入</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                </button>
              </div>
              <div
                v-if="customFontOptions.length > 0"
                class="space-y-1"
              >
                <div
                  v-for="option in customFontOptions"
                  :key="option.value"
                  role="button"
                  tabindex="0"
                  class="font-option-row"
                  :class="lyricsSettings.playerFontPreset === option.value
                    ? 'font-option-row--active active-font-preset'
                    : ''"
                  @click="selectFontPreset(option.value)"
                  @keydown.enter.prevent="selectFontPreset(option.value)"
                  @keydown.space.prevent="selectFontPreset(option.value)"
                >
                  <span class="min-w-0 flex-1 truncate" :title="option.label">{{ option.label }}</span>
                  <button
                    type="button"
                    class="font-delete-button"
                    title="删除自定义字体"
                    aria-label="删除自定义字体"
                    @click.stop="removeCustomLyricsFont(option.value)"
                  >
                    <Trash2 :size="14" :stroke-width="2.1" />
                  </button>
                </div>
              </div>
              <div
                v-else
                class="px-3 py-3 text-xs font-medium text-white/38"
              >
                暂无自定义字体
              </div>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
</template>

<style scoped>
.font-preset-menu-enter-active,
.font-preset-menu-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.font-preset-menu-enter-from,
.font-preset-menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.font-preset-trigger {
  display: flex;
  width: 100%;
  min-height: 50px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 12px 16px;
  text-align: left;
  font-size: 14px;
  font-weight: 650;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.03);
  transition: opacity 160ms ease, color 160ms ease, background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.font-preset-trigger--muted {
  color: rgba(255, 255, 255, 0.48);
  background: rgba(255, 255, 255, 0.025);
}

.font-preset-trigger:hover,
.font-preset-trigger--open {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.95);
}

.font-preset-trigger--active {
  border-color: rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.98);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
}

.font-preset-trigger--open {
  border-color: rgba(255, 255, 255, 0.25);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.16);
}

.font-custom-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 6px 6px;
  color: rgba(255, 255, 255, 0.56);
  font-size: 11px;
  font-weight: 700;
}

.font-import-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  border-radius: 9999px;
  padding: 4px 8px;
  color: rgba(255, 255, 255, 0.62);
  transition: color 140ms ease, background-color 140ms ease;
}

.font-import-button:hover {
  background: rgba(255, 255, 255, 0.09);
  color: rgba(255, 255, 255, 0.95);
}

.font-option-row {
  display: flex;
  width: 100%;
  min-height: 42px;
  align-items: center;
  gap: 10px;
  border-radius: 14px;
  padding: 10px 12px;
  text-align: left;
  color: rgba(255, 255, 255, 0.72);
  transition: color 140ms ease, background-color 140ms ease;
}

.font-option-row:hover,
.font-option-row:focus-visible {
  background: rgba(255, 255, 255, 0.075);
  color: rgba(255, 255, 255, 0.96);
  outline: none;
}

.font-option-row--active {
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.98);
}

.font-delete-button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: rgba(255, 255, 255, 0.52);
  transition: color 140ms ease, background-color 140ms ease;
}

.font-delete-button:hover,
.font-delete-button:focus-visible {
  background: rgba(236, 65, 65, 0.2);
  color: rgba(255, 255, 255, 0.96);
  outline: none;
}

.font-size-slider::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0,0,0,0.05);
}

.font-size-slider::-moz-range-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border: 0;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0,0,0,0.05);
}

.font-size-slider::-moz-range-track {
  height: 4px;
  border-radius: 9999px;
  background: transparent;
}

</style>
