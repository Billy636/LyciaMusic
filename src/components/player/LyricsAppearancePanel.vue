<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog';
import { AlignLeft, ArrowLeft, ChevronRight, Languages, Move, Pin, RotateCcw, Sparkles, Trash2, Type, X } from 'lucide-vue-next';
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import {
  DEFAULT_PLAYER_ALIGNMENT,
  DEFAULT_PLAYER_FONT_PRESET,
  DEFAULT_PLAYER_FONT_SCALE,
  DEFAULT_PLAYER_LINE_GAP,
  DEFAULT_PLAYER_OFFSET_X,
  DEFAULT_PLAYER_OFFSET_Y,
  DEFAULT_PLAYER_TRANSLATION_FONT_SCALE,
  buildImportedLyricsFontOptions,
  importLyricsFontFile,
  LYRICS_FONT_OPTIONS,
  MAX_PLAYER_FONT_SCALE,
  MAX_PLAYER_LINE_GAP,
  MAX_PLAYER_OFFSET_X,
  MAX_PLAYER_OFFSET_Y,
  MAX_PLAYER_TRANSLATION_FONT_SCALE,
  MIN_PLAYER_FONT_SCALE,
  MIN_PLAYER_LINE_GAP,
  MIN_PLAYER_OFFSET_X,
  MIN_PLAYER_OFFSET_Y,
  MIN_PLAYER_TRANSLATION_FONT_SCALE,
  loadSystemLyricsFonts,
  normalizeLyricsFontPreset,
  systemLyricsFontOptions,
  type LyricsFontPreset,
  type LyricsPlayerAlignment,
  type LyricsPlayerRenderMode,
  type LyricsPlayerWritingMode,
  type LyricsVerticalScrollDirection,
  useLyrics,
} from '../../composables/lyrics';
import { LYRICS_READING_ORDER_OPTIONS, resolveLyricsReadingOrder } from '../../composables/lyrics/readingOrder';
import { usePlayer } from '../../composables/player';
import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import LyricsAppearanceRange from './LyricsAppearanceRange.vue';
import LyricsReadingOrderControl from './LyricsReadingOrderControl.vue';
import { useLyricsAppearanceDraft, type LyricsAppearanceDraft } from './useLyricsAppearanceDraft';
import { useLyricsAppearancePopover, type LyricsAppearanceSection } from './useLyricsAppearancePopover';
import './playerSidePanel.css';

const emit = defineEmits<{ preview: [draft: Required<LyricsAppearanceDraft>] }>();
const { lyricsSettings, showLyricsPlayerSettingsPanel } = useLyrics();
const { showPlayerDetail } = usePlayer();
const settingsStore = useSettingsStore();
const playbackStore = usePlaybackStore();
const visible = computed(() => showPlayerDetail.value && showLyricsPlayerSettingsPanel.value);
const panelRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const fontListRef = ref<HTMLElement | null>(null);
const popoverId = `lyrics-appearance-options-${useId()}`;
const fontSource = ref<'system' | 'custom'>('system');
const importingFont = ref(false);
const fontImportError = ref('');
const FONT_SCALE_STEP = 0.05;
const LINE_GAP_STEP = 0.05;
const OFFSET_STEP = 1;
const FONT_FILE_FILTERS = [{ name: 'Font', extensions: ['ttf', 'otf'] }];
const isVerticalWriting = computed(() => lyricsSettings.playerWritingMode === 'vertical');
const PLAYER_ALIGNMENT_OPTIONS = computed<Array<{ value: LyricsPlayerAlignment; label: string }>>(() => [
  { value: 'left', label: isVerticalWriting.value ? '顶部' : '靠左' },
  { value: 'center', label: '居中' },
  { value: 'right', label: isVerticalWriting.value ? '底部' : '靠右' },
]);
const PLAYER_WRITING_MODE_OPTIONS: Array<{ value: LyricsPlayerWritingMode; label: string }> = [
  { value: 'horizontal', label: '横排' },
  { value: 'vertical', label: '竖排' },
];
const VERTICAL_SCROLL_DIRECTION_OPTIONS: Array<{ value: LyricsVerticalScrollDirection; label: string }> = [
  { value: 'left', label: '向左' },
  { value: 'right', label: '向右' },
];
const PLAYER_RENDER_MODE_OPTIONS: Array<{ value: LyricsPlayerRenderMode; label: string }> = [
  { value: 'amll', label: 'AMLL' },
  { value: 'light', label: '轻量' },
];
const SECTIONS = [
  { id: 'layout', label: '排版', icon: AlignLeft },
  { id: 'typography', label: '字体与字号', icon: Type },
  { id: 'position', label: '间距与位置', icon: Move },
  { id: 'subtitles', label: '副行与读取顺序', icon: Languages },
  { id: 'effects', label: '歌词效果', icon: Sparkles },
] as const;
const { draft, setField: setAppearanceField, commit: commitDraftLyricsSettings } = useLyricsAppearanceDraft(
  () => lyricsSettings,
  (patch) => settingsStore.patchSettings({ lyrics: patch }),
  (preview) => emit('preview', preview),
);
const {
  activeSection, pinned, popoverStyle, popoverSide,
  enterSection, leaveSection, toggleSection, keepPopoverOpen, leavePopover, closePopover, pinPopover,
} = useLyricsAppearancePopover({ visible, panelRef, popoverRef, beforeClose: commitDraftLyricsSettings });
const activeSectionLabel = computed(() => SECTIONS.find((section) => section.id === activeSection.value)?.label);
const customFontOptions = computed(() => buildImportedLyricsFontOptions(settingsStore.settings.customLyricsFonts));
const systemFontOptions = computed(() => [...LYRICS_FONT_OPTIONS, ...systemLyricsFontOptions.value]);
const isUsingCustomFont = computed(() => customFontOptions.value.some((option) => option.value === lyricsSettings.playerFontPreset));
const selectedFontLabel = computed(() => [...customFontOptions.value, ...systemFontOptions.value]
  .find((option) => option.value === lyricsSettings.playerFontPreset)?.label
  ?? normalizeLyricsFontPreset(lyricsSettings.playerFontPreset));
const readingOrderLabel = computed(() => LYRICS_READING_ORDER_OPTIONS.find((option) => option.value
  === resolveLyricsReadingOrder(lyricsSettings, playbackStore.currentSong?.path))!.label);
const subtitlesLabel = computed(() => [
  lyricsSettings.showTranslation ? '翻译' : '', lyricsSettings.showRomaji ? '罗马音' : '',
].filter(Boolean).join('、') || '仅原文');
const summaries = computed<Record<LyricsAppearanceSection, string>>(() => ({
  layout: isVerticalWriting.value
    ? `竖排 · ${lyricsSettings.playerVerticalScrollDirection === 'left' ? '向左' : '向右'}` : '横排',
  typography: `${selectedFontLabel.value} · ${Math.round(draft.playerFontScale * 100)}%`,
  position: `${PLAYER_ALIGNMENT_OPTIONS.value.find((option) => option.value === lyricsSettings.playerAlignment)?.label} · 间距 ${Math.round(draft.playerLineGap * 100)}%`,
  subtitles: subtitlesLabel.value,
  effects: `${isVerticalWriting.value ? '竖排' : lyricsSettings.playerRenderMode === 'amll' ? 'AMLL' : '轻量'}${(isVerticalWriting.value || lyricsSettings.playerRenderMode === 'amll') && lyricsSettings.enableBlur ? ' · 模糊' : ''}`,
}));

function setPlayerAlignment(value: LyricsPlayerAlignment) {
  lyricsSettings.playerAlignment = value;
}
function setPlayerFontPreset(value: LyricsFontPreset) {
  lyricsSettings.playerFontPreset = normalizeLyricsFontPreset(value);
}
function setPlayerRenderMode(value: LyricsPlayerRenderMode) {
  settingsStore.patchSettings({ lyrics: { playerRenderMode: value } });
}
function setPlayerWritingMode(value: LyricsPlayerWritingMode) {
  commitDraftLyricsSettings();
  settingsStore.patchSettings({ lyrics: { playerWritingMode: value } });
}
function setVerticalScrollDirection(value: LyricsVerticalScrollDirection) {
  commitDraftLyricsSettings();
  settingsStore.patchSettings({ lyrics: { playerVerticalScrollDirection: value } });
}
function toggleTranslation() {
  lyricsSettings.showTranslation = !lyricsSettings.showTranslation;
}
function toggleRomaji() {
  lyricsSettings.showRomaji = !lyricsSettings.showRomaji;
}
async function importCustomLyricsFont() {
  if (importingFont.value) return;
  pinPopover();
  importingFont.value = true;
  fontImportError.value = '';
  try {
    const selected = await open({ multiple: false, directory: false, title: '导入歌词字体', filters: FONT_FILE_FILTERS });
    if (typeof selected !== 'string') return;
    const importedFont = await importLyricsFontFile(selected);
    const remainingFonts = settingsStore.settings.customLyricsFonts.filter((font) =>
      font.family !== importedFont.family && font.filePath !== importedFont.filePath);
    const shouldApplyToDesktopLyrics = settingsStore.settings.desktopLyrics.playerFontPreset === DEFAULT_PLAYER_FONT_PRESET;
    settingsStore.patchSettings({
      customLyricsFonts: [importedFont, ...remainingFonts],
      lyrics: { playerFontPreset: importedFont.family },
      ...(shouldApplyToDesktopLyrics ? { desktopLyrics: { playerFontPreset: importedFont.family } } : {}),
    });
  } catch (error) {
    fontImportError.value = '字体导入失败，请重新选择字体文件';
    console.warn('Failed to import custom lyrics font:', error);
  } finally {
    importingFont.value = false;
  }
}
function removeCustomLyricsFont(value: LyricsFontPreset) {
  const normalizedFamily = normalizeLyricsFontPreset(value);
  const remainingFonts = settingsStore.settings.customLyricsFonts.filter((font) => font.family !== normalizedFamily);
  settingsStore.patchSettings({
    customLyricsFonts: remainingFonts,
    ...(lyricsSettings.playerFontPreset === normalizedFamily
      ? { lyrics: { playerFontPreset: DEFAULT_PLAYER_FONT_PRESET } } : {}),
    ...(settingsStore.settings.desktopLyrics.playerFontPreset === normalizedFamily
      ? { desktopLyrics: { playerFontPreset: DEFAULT_PLAYER_FONT_PRESET } } : {}),
  });
}
function handleClickOutside(event: MouseEvent) {
  if (!visible.value) return;
  const target = event.target as Node | null;
  if (!target || panelRef.value?.contains(target) || popoverRef.value?.contains(target)) return;
  showLyricsPlayerSettingsPanel.value = false;
}
function handlePanelKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.key !== 'Escape' || !visible.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (activeSection.value) closePopover(true);
  else showLyricsPlayerSettingsPanel.value = false;
}
watch(activeSection, (section) => {
  if (section === 'typography') fontSource.value = isUsingCustomFont.value ? 'custom' : 'system';
});
watch([activeSection, fontSource], async () => {
  if (activeSection.value !== 'typography') return;
  await nextTick();
  const list = fontListRef.value;
  const selected = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (list && selected) {
    const offset = selected.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop += offset - (list.clientHeight - selected.offsetHeight) / 2;
  }
}, { flush: 'post' });
watch(showLyricsPlayerSettingsPanel, (isVisible) => {
  if (!isVisible) commitDraftLyricsSettings();
});
watch(showPlayerDetail, (detailVisible) => {
  if (!detailVisible) showLyricsPlayerSettingsPanel.value = false;
}, { flush: 'sync' });
onMounted(() => {
  window.addEventListener('mousedown', handleClickOutside);
  window.addEventListener('keydown', handlePanelKeydown);
  void loadSystemLyricsFonts();
});
onUnmounted(() => {
  commitDraftLyricsSettings();
  window.removeEventListener('mousedown', handleClickOutside);
  window.removeEventListener('keydown', handlePanelKeydown);
  showLyricsPlayerSettingsPanel.value = false;
});
</script>

<template>
  <Teleport to="body">
    <transition name="player-side-panel">
      <aside
        v-if="showPlayerDetail && showLyricsPlayerSettingsPanel"
        ref="panelRef"
        aria-labelledby="lyrics-appearance-title"
        data-shortcut-capture="true"
        class="player-side-panel player-side-panel--left pointer-events-auto"
        :class="{ 'lyrics-appearance-panel': true, 'lyrics-appearance-panel--covered': activeSection && popoverSide === 'overlay' }"
        :inert="activeSection && popoverSide === 'overlay' ? true : undefined"
        @click.stop
        @mousedown.stop
      >
        <header class="player-side-panel__header">
          <div>
            <div class="player-side-panel__eyebrow">Style</div>
            <h3 id="lyrics-appearance-title" class="player-side-panel__title">歌词样式</h3>
          </div>
          <button type="button" class="player-side-panel__icon-button" title="关闭歌词样式" aria-label="关闭歌词样式" @click="showLyricsPlayerSettingsPanel = false"><X :size="16" /></button>
        </header>
        <div class="player-side-panel__scroll lyrics-appearance-directory">
          <button
            v-for="section in SECTIONS" :key="section.id" type="button"
            class="appearance-section" :class="{ 'appearance-section--active': activeSection === section.id }"
            :data-lyrics-section="section.id" :aria-expanded="activeSection === section.id"
            :aria-controls="activeSection === section.id ? popoverId : undefined"
            @pointerenter="enterSection(section.id, $event)" @pointerleave="leaveSection($event)"
            @click="toggleSection(section.id)" @keydown.right.prevent="toggleSection(section.id)"
          >
            <component :is="section.icon" :size="17" :stroke-width="1.6" class="appearance-section-icon" aria-hidden="true" />
            <span class="appearance-section-copy">
              <span class="appearance-section-label">{{ section.label }}</span>
              <span class="appearance-section-summary" :title="section.id === 'subtitles' ? `${summaries[section.id]} · ${readingOrderLabel}` : summaries[section.id]">{{ summaries[section.id] }}</span>
            </span>
            <Pin v-if="activeSection === section.id && pinned" :size="12" class="appearance-section-pin" aria-hidden="true" />
            <ChevronRight :size="14" class="appearance-section-chevron" aria-hidden="true" />
          </button>
        </div>
      </aside>
    </transition>
    <transition name="appearance-popover">
      <section
        v-if="visible && activeSection" :id="popoverId" ref="popoverRef"
        class="appearance-popover pointer-events-auto" :class="`appearance-popover--${popoverSide}`"
        :style="popoverStyle" role="region" :aria-labelledby="`${popoverId}-title`"
        data-shortcut-capture="true" tabindex="-1"
        @pointerenter="keepPopoverOpen" @pointerleave="leavePopover($event)" @click.stop @mousedown.stop
      >
        <header class="appearance-popover-header">
          <button v-if="popoverSide === 'overlay'" type="button" class="player-side-panel__icon-button" aria-label="返回歌词样式" @click="closePopover(true)"><ArrowLeft :size="16" /></button>
          <h3 :key="activeSection" :id="`${popoverId}-title`" class="appearance-section-content">{{ activeSectionLabel }}</h3>
          <button type="button" class="player-side-panel__icon-button appearance-pin-button" data-lyrics-popover-pin :aria-pressed="pinned" :aria-label="pinned ? '取消固定选项' : '固定当前选项'" :title="pinned ? '取消固定' : '固定当前选项'" @click="pinned = !pinned"><Pin :size="14" /></button>
          <button type="button" class="player-side-panel__icon-button" aria-label="关闭当前选项" @click="closePopover(true)"><X :size="16" /></button>
        </header>
        <div :key="activeSection" class="appearance-popover-scroll appearance-section-content">
          <div v-if="activeSection === 'layout'" class="appearance-controls appearance-layout-controls">
            <div class="appearance-control-group">
              <span class="appearance-control-label">排版方向</span>
              <div class="appearance-options" role="group" aria-label="排版方向">
                <button v-for="option in PLAYER_WRITING_MODE_OPTIONS" :key="option.value" type="button" :aria-pressed="lyricsSettings.playerWritingMode === option.value" @click="setPlayerWritingMode(option.value)"><span class="writing-mode-preview" :class="{ 'writing-mode-preview--vertical': option.value === 'vertical' }" aria-hidden="true"><span></span><span></span><span></span></span>{{ option.label }}</button>
              </div>
            </div>
            <Transition name="appearance-direction">
              <div v-if="isVerticalWriting" class="appearance-direction">
                <div class="appearance-direction-content">
                  <div class="appearance-control-group appearance-direction-group">
                    <span class="appearance-control-label">移动方向</span>
                    <div class="appearance-options" role="group" aria-label="移动方向">
                      <button v-for="option in VERTICAL_SCROLL_DIRECTION_OPTIONS" :key="option.value" type="button" :aria-pressed="lyricsSettings.playerVerticalScrollDirection === option.value" @click="setVerticalScrollDirection(option.value)">{{ option.label }}</button>
                    </div>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
          <div v-else-if="activeSection === 'typography'" class="appearance-controls">
            <LyricsAppearanceRange label="字体大小" :model-value="draft.playerFontScale" :min="MIN_PLAYER_FONT_SCALE" :max="MAX_PLAYER_FONT_SCALE" :step="FONT_SCALE_STEP" :default-value="DEFAULT_PLAYER_FONT_SCALE" decrease-label="A−" increase-label="A+" @update:model-value="setAppearanceField('playerFontScale', $event, false)" @commit="commitDraftLyricsSettings" />
            <LyricsAppearanceRange label="翻译字号" :model-value="draft.playerTranslationFontScale" :min="MIN_PLAYER_TRANSLATION_FONT_SCALE" :max="MAX_PLAYER_TRANSLATION_FONT_SCALE" :step="FONT_SCALE_STEP" :default-value="DEFAULT_PLAYER_TRANSLATION_FONT_SCALE" decrease-label="A−" increase-label="A+" @update:model-value="setAppearanceField('playerTranslationFontScale', $event, false)" @commit="commitDraftLyricsSettings" />
            <div class="appearance-control-group appearance-control-group--divided">
              <div class="appearance-control-heading">
                <span class="appearance-control-label">歌词字体</span>
                <button v-if="lyricsSettings.playerFontPreset !== DEFAULT_PLAYER_FONT_PRESET" type="button" class="appearance-reset" aria-label="重置歌词字体" @click="setPlayerFontPreset(DEFAULT_PLAYER_FONT_PRESET)"><RotateCcw :size="13" /></button>
              </div>
              <div class="appearance-options appearance-font-tabs" role="group" aria-label="字体来源">
                <button type="button" :aria-pressed="fontSource === 'system'" @click="fontSource = 'system'">系统字体</button>
                <button type="button" :aria-pressed="fontSource === 'custom'" @click="fontSource = 'custom'">自定义字体</button>
              </div>
              <div ref="fontListRef" class="appearance-font-list" role="group" aria-label="歌词字体">
                <template v-if="fontSource === 'system'">
                  <button v-for="option in systemFontOptions" :key="option.value" type="button" class="appearance-font-option" :title="option.label" :aria-pressed="lyricsSettings.playerFontPreset === option.value" @click="setPlayerFontPreset(option.value)"><span class="min-w-0 flex-1 truncate">{{ option.label }}</span><span v-if="lyricsSettings.playerFontPreset === option.value" class="appearance-current-badge">当前</span></button>
                </template>
                <template v-else>
                  <div v-for="option in customFontOptions" :key="option.value" class="appearance-custom-font">
                    <button type="button" class="appearance-font-option" :title="option.label" :aria-pressed="lyricsSettings.playerFontPreset === option.value" @click="setPlayerFontPreset(option.value)"><span class="min-w-0 flex-1 truncate">{{ option.label }}</span><span v-if="lyricsSettings.playerFontPreset === option.value" class="appearance-current-badge">当前</span></button>
                    <button type="button" class="appearance-font-delete" :aria-label="`删除字体 ${option.label}`" :title="`删除字体 ${option.label}`" @click.stop="removeCustomLyricsFont(option.value)"><Trash2 :size="14" /></button>
                  </div>
                  <p v-if="customFontOptions.length === 0" class="appearance-empty">导入字体后，即可在这里选择</p>
                </template>
              </div>
              <template v-if="fontSource === 'custom'">
                <button type="button" class="appearance-import" :disabled="importingFont" @click="importCustomLyricsFont">{{ importingFont ? '正在导入…' : '导入字体' }}</button>
                <p v-if="fontImportError" class="appearance-empty" role="status">{{ fontImportError }}</p>
              </template>
            </div>
          </div>
          <div v-else-if="activeSection === 'position'" class="appearance-controls">
            <LyricsAppearanceRange :label="isVerticalWriting ? '列间距' : '歌词间距'" :model-value="draft.playerLineGap" :min="MIN_PLAYER_LINE_GAP" :max="MAX_PLAYER_LINE_GAP" :step="LINE_GAP_STEP" :default-value="DEFAULT_PLAYER_LINE_GAP" @update:model-value="setAppearanceField('playerLineGap', $event, false)" @commit="commitDraftLyricsSettings" />
            <div class="appearance-control-group">
              <div class="appearance-control-heading">
                <span class="appearance-control-label">歌词位置</span>
                <button v-if="lyricsSettings.playerAlignment !== DEFAULT_PLAYER_ALIGNMENT" type="button" class="appearance-reset" aria-label="重置歌词位置" @click="setPlayerAlignment(DEFAULT_PLAYER_ALIGNMENT)"><RotateCcw :size="13" /></button>
              </div>
              <div class="appearance-options" role="group" aria-label="歌词位置">
                <button v-for="option in PLAYER_ALIGNMENT_OPTIONS" :key="option.value" type="button" :aria-pressed="lyricsSettings.playerAlignment === option.value" @click="setPlayerAlignment(option.value)">{{ option.label }}</button>
              </div>
            </div>
            <div class="appearance-control-group appearance-control-group--divided">
              <span class="appearance-control-label">歌词偏移</span>
              <LyricsAppearanceRange label="水平" format="offset" :model-value="draft.playerOffsetX" :min="MIN_PLAYER_OFFSET_X" :max="MAX_PLAYER_OFFSET_X" :step="OFFSET_STEP" :default-value="DEFAULT_PLAYER_OFFSET_X" @update:model-value="setAppearanceField('playerOffsetX', $event, false)" @commit="commitDraftLyricsSettings" />
              <LyricsAppearanceRange label="垂直" format="offset" :model-value="draft.playerOffsetY" :min="MIN_PLAYER_OFFSET_Y" :max="MAX_PLAYER_OFFSET_Y" :step="OFFSET_STEP" :default-value="DEFAULT_PLAYER_OFFSET_Y" @update:model-value="setAppearanceField('playerOffsetY', $event, false)" @commit="commitDraftLyricsSettings" />
            </div>
          </div>
          <div v-else-if="activeSection === 'subtitles'" class="appearance-controls">
            <div class="appearance-control-group">
              <span class="appearance-control-label">副行显示</span>
              <div class="appearance-options" role="group" aria-label="副行显示">
                <button type="button" :aria-pressed="lyricsSettings.showTranslation" @click="toggleTranslation">显示翻译</button>
                <button type="button" :aria-pressed="lyricsSettings.showRomaji" @click="toggleRomaji">显示罗马音</button>
              </div>
            </div>
            <div class="appearance-control-group--divided"><LyricsReadingOrderControl inline /></div>
          </div>
          <div v-else-if="activeSection === 'effects'" class="appearance-controls">
            <div v-if="!isVerticalWriting" class="appearance-control-group">
              <span class="appearance-control-label">歌词效果</span>
              <div class="appearance-options" role="group" aria-label="歌词效果">
                <button v-for="option in PLAYER_RENDER_MODE_OPTIONS" :key="option.value" type="button" :aria-pressed="lyricsSettings.playerRenderMode === option.value" @click="setPlayerRenderMode(option.value)">{{ option.label }}</button>
              </div>
            </div>
            <div v-if="isVerticalWriting || lyricsSettings.playerRenderMode === 'amll'" class="appearance-switch-row">
              <span id="lyrics-blur-label" class="appearance-control-label">歌词模糊效果</span>
              <button type="button" role="switch" aria-labelledby="lyrics-blur-label" :aria-checked="lyricsSettings.enableBlur" class="appearance-switch" @click="settingsStore.patchSettings({ lyrics: { enableBlur: !lyricsSettings.enableBlur } })"><span></span></button>
            </div>
          </div>
        </div>
      </section>
    </transition>
  </Teleport>
</template>

<style scoped>
.lyrics-appearance-panel { width: 280px; height: max-content; max-height: calc(100dvh - 180px); margin-block: auto; }
.lyrics-appearance-panel--covered { visibility: hidden; }
.lyrics-appearance-directory { padding: 8px; }
.appearance-section { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 60px; padding: 10px 12px; border: 1px solid transparent; border-radius: 14px; text-align: left; transition: background-color 160ms, border-color 160ms; }
.appearance-section:hover, .appearance-section--active { border-color: rgb(255 255 255 / 10%); background: rgb(255 255 255 / 8%); }
.appearance-section-icon { flex-shrink: 0; color: rgb(255 255 255 / 55%); }
.appearance-section-copy { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; }
.appearance-section-label { color: rgb(255 255 255 / 88%); font-size: 13px; font-weight: 500; line-height: 18px; }
.appearance-section-summary { overflow: hidden; color: rgb(255 255 255 / 43%); font-size: 11px; line-height: 15px; text-overflow: ellipsis; white-space: nowrap; }
.appearance-section-chevron, .appearance-section-pin { flex-shrink: 0; color: rgb(255 255 255 / 38%); }
.appearance-section--active .appearance-section-chevron { color: rgb(255 255 255 / 80%); }
.appearance-popover { z-index: 101; display: flex; flex-direction: column; min-height: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 12%); border-radius: 20px; background: rgb(14 20 30 / 65%); color: rgb(255 255 255 / 85%); box-shadow: 0 18px 48px rgb(0 0 0 / 24%); backdrop-filter: blur(28px); font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --popover-enter-x: -10px; }
.appearance-popover--left { --popover-enter-x: 10px; }
.appearance-popover--overlay { --popover-enter-x: 12px; }
.appearance-popover-header { display: flex; flex-shrink: 0; align-items: center; gap: 4px; padding: 10px 12px; border-bottom: 1px solid rgb(255 255 255 / 8%); }
.appearance-popover-header h3 { flex: 1; min-width: 0; margin: 0; font-size: 13px; font-weight: 600; }
.appearance-pin-button[aria-pressed="true"] { background: rgb(255 255 255 / 12%); color: white; }
.appearance-popover-scroll { min-height: 0; overflow-y: auto; padding: 16px; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / 20%) transparent; }
.appearance-section-content { animation: appearance-section-in 180ms cubic-bezier(.22, 1, .36, 1) both; }
@keyframes appearance-section-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.appearance-controls { display: flex; flex-direction: column; gap: 20px; }
.appearance-layout-controls { gap: 0; }
.appearance-direction { display: grid; grid-template-rows: 1fr; opacity: 1; }
.appearance-direction-content { min-height: 0; overflow: hidden; }
.appearance-direction-group { padding-top: 20px; }
.appearance-direction-enter-active, .appearance-direction-leave-active { transition: grid-template-rows 280ms cubic-bezier(.22, 1, .36, 1), opacity 180ms ease, transform 280ms cubic-bezier(.22, 1, .36, 1); }
.appearance-direction-enter-from, .appearance-direction-leave-to { grid-template-rows: 0fr; opacity: 0; transform: translateY(-6px); }
.appearance-control-group { display: flex; flex-direction: column; gap: 10px; }
.appearance-control-group--divided { padding-top: 16px; border-top: 1px solid rgb(255 255 255 / 8%); }
.appearance-control-label { color: rgb(255 255 255 / 82%); font-size: 13px; font-weight: 500; }
.appearance-control-heading { display: flex; align-items: center; justify-content: space-between; }
.appearance-reset { display: flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 8px; color: rgb(255 255 255 / 45%); }
.appearance-reset:hover { background: rgb(255 255 255 / 8%); color: white; }
.appearance-options { display: flex; gap: 6px; }
.appearance-options button { display: flex; flex: 1; align-items: center; justify-content: center; gap: 8px; min-width: 0; min-height: 36px; padding: 6px 8px; border: 1px solid rgb(255 255 255 / 10%); border-radius: 12px; background: rgb(255 255 255 / 3%); color: rgb(255 255 255 / 55%); font-size: 12px; transition: color 160ms, background-color 160ms, border-color 160ms; }
.appearance-options button:hover { background: rgb(255 255 255 / 7%); color: white; }
.appearance-options button[aria-pressed="true"] { border-color: rgb(255 255 255 / 22%); background: rgb(255 255 255 / 13%); color: white; }
.writing-mode-preview { display: flex; flex-direction: column; justify-content: center; gap: 3px; width: 16px; height: 16px; }
.writing-mode-preview span { height: 2px; border-radius: 2px; background: currentColor; }
.writing-mode-preview span:nth-child(2) { width: 75%; }
.writing-mode-preview span:nth-child(3) { width: 50%; }
.writing-mode-preview--vertical { transform: rotate(90deg); }
.appearance-font-tabs { padding: 3px; border: 1px solid rgb(255 255 255 / 10%); border-radius: 12px; background: rgb(255 255 255 / 3%); }
.appearance-font-tabs button { min-height: 28px; border-color: transparent; border-radius: 8px; background: transparent; font-size: 11px; }
.appearance-font-tabs button[aria-pressed="true"] { border-color: transparent; }
.appearance-font-list { max-height: 220px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / 20%) transparent; }
.appearance-font-option { display: flex; width: 100%; align-items: center; gap: 8px; min-height: 38px; padding: 8px 10px; border-radius: 10px; color: rgb(255 255 255 / 65%); text-align: left; font-size: 12px; }
.appearance-font-option:hover { background: rgb(255 255 255 / 6%); color: white; }
.appearance-font-option[aria-pressed="true"] { background: rgb(255 255 255 / 12%); color: white; }
.appearance-current-badge { flex-shrink: 0; padding: 2px 6px; border-radius: 6px; background: rgb(255 255 255 / 10%); color: rgb(255 255 255 / 65%); font-size: 10px; }
.appearance-custom-font { display: flex; align-items: center; gap: 4px; }
.appearance-custom-font .appearance-font-option { flex: 1; min-width: 0; }
.appearance-font-delete { display: flex; width: 28px; height: 28px; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 8px; color: rgb(255 255 255 / 40%); }
.appearance-font-delete:hover { background: rgb(255 255 255 / 8%); color: white; }
.appearance-import { min-height: 36px; border: 1px solid rgb(255 255 255 / 14%); border-radius: 12px; background: rgb(255 255 255 / 5%); color: rgb(255 255 255 / 75%); font-size: 12px; }
.appearance-import:hover { background: rgb(255 255 255 / 10%); color: white; }
.appearance-import:disabled { opacity: .5; cursor: wait; }
.appearance-empty { margin: 10px 4px; color: rgb(255 255 255 / 40%); font-size: 11px; line-height: 1.6; text-align: center; }
.appearance-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.appearance-switch { display: flex; width: 38px; height: 24px; flex-shrink: 0; align-items: center; padding: 3px; border: 1px solid rgb(255 255 255 / 10%); border-radius: 20px; background: rgb(255 255 255 / 10%); }
.appearance-switch span { width: 16px; height: 16px; border-radius: 50%; background: white; transition: transform 160ms; }
.appearance-switch[aria-checked="true"] { border-color: rgb(255 255 255 / 25%); background: rgb(255 255 255 / 30%); }
.appearance-switch[aria-checked="true"] span { transform: translateX(14px); }
.appearance-section:focus-visible, .appearance-popover button:focus-visible { outline: 2px solid rgb(255 255 255 / 70%); outline-offset: -2px; }
.appearance-popover-enter-active, .appearance-popover-leave-active { transition: opacity 150ms, transform 180ms; }
.appearance-popover-enter-from, .appearance-popover-leave-to { opacity: 0; transform: translateX(var(--popover-enter-x)); }
@media (max-height: 599px) {
  .lyrics-appearance-panel { top: 12px; bottom: 12px; max-height: calc(100dvh - 24px); }
}
@media (pointer: coarse) {
  .appearance-options button, .appearance-font-option, .appearance-import { min-height: 40px; }
  .appearance-popover .player-side-panel__icon-button, .appearance-reset, .appearance-font-delete { min-width: 40px; min-height: 40px; }
}
@media (prefers-reduced-motion: reduce) {
  .appearance-section-content { animation: none; }
  .appearance-section, .appearance-options button, .appearance-switch span, .appearance-popover-enter-active, .appearance-popover-leave-active, .appearance-direction-enter-active, .appearance-direction-leave-active { transition: none; }
}
</style>
