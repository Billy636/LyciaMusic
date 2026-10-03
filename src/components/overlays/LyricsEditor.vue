<script setup lang="ts">
import { computed, defineAsyncComponent, ref, useId, watch } from 'vue';
import { BookOpen, Check, ChevronDown, CodeXml, SlidersHorizontal } from 'lucide-vue-next';
import SettingsSelect from '../settings/SettingsSelect.vue';
import type { LyricsReadingOrder } from '../../types';
import { LYRICS_READING_ORDER_OPTIONS } from '../../composables/lyrics/readingOrder';
import {
  parseLyricsReadingPreview,
  type LyricsReadingPreview,
} from '../../composables/lyrics/readingPreview';

const props = defineProps<{
  modelValue: string;
  songPath: string;
  durationMs?: number;
  loading: boolean;
  readingOrder: LyricsReadingOrder;
  readingOrderOverride?: LyricsReadingOrder;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:readingOrder': [value: LyricsReadingOrder | null];
}>();

const editorId = useId();
const LyricsSourceEditor = defineAsyncComponent(() => import('./LyricsSourceEditor.vue'));
const sourceOpened = ref(false);
const readingOrderOptions = [{ value: '', label: '跟随默认' }, ...LYRICS_READING_ORDER_OPTIONS];
const mode = ref<'read' | 'source'>('read');
const settingsOpen = ref(false);
const showTime = ref(true);
const showTranslation = ref(true);
const showRomaji = ref(false);
const fontSize = ref(20);
const parsing = ref(false);
const preview = ref<LyricsReadingPreview | null>(null);
const sourceText = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
});
watch(mode, (value) => { if (value === 'source') sourceOpened.value = true; });
const hasTranslation = computed(() => preview.value?.lines.some((line) => line.translation));
const hasRomaji = computed(() => preview.value?.lines.some((line) => line.romaji));
const canChooseOrder = computed(() => preview.value && ['lrc', 'enhanced_lrc', 'eslrc', 'qrc', 'yrc']
  .includes(preview.value.format));

watch(() => props.songPath, () => {
  mode.value = 'read';
  settingsOpen.value = false;
}, { flush: 'sync' });

// This is a display projection of the draft, never the model used for saving.
// Cleanup invalidates both the debounce and a parser already in flight.
watch(
  [() => props.modelValue, () => props.songPath, () => props.durationMs,
    () => props.readingOrder, () => props.loading],
  ([raw, songPath, durationMs, readingOrder, loading], previous, onCleanup) => {
    let cancelled = false;
    // Keep the order control mounted (and keyboard focus intact) while regrouping.
    const onlyOrderChanged = raw === previous[0] && songPath === previous[1]
      && durationMs === previous[2] && loading === previous[4];
    if (!onlyOrderChanged) preview.value = null;
    parsing.value = !loading && Boolean(raw.trim());
    const timer = window.setTimeout(async () => {
      if (loading || !raw.trim()) {
        if (!cancelled) parsing.value = false;
        return;
      }
      try {
        const result = await parseLyricsReadingPreview(raw, { durationMs, readingOrder });
        if (!cancelled) preview.value = result;
      } catch {
        if (!cancelled) preview.value = {
          lines: [], metadata: [], unparsedLines: [], format: 'unknown', issues: [],
          error: '暂时无法生成阅读预览，已保留原始内容。', plainText: raw,
        };
      } finally {
        if (!cancelled) parsing.value = false;
      }
    }, mode.value === 'source' ? 220 : 0);
    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
    });
  },
  { immediate: true },
);

function changeReadingOrder(value: string) {
  const option = LYRICS_READING_ORDER_OPTIONS.find((item) => item.value === value);
  emit('update:readingOrder', option?.value ?? null);
}

function formatTimestamp(seconds: number) {
  const hundredths = Math.round(Math.max(0, seconds) * 100);
  const minutes = Math.floor(hundredths / 6000);
  const rest = Math.floor(hundredths / 100) % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
}
</script>

<template>
  <div class="lyrics-workbench" data-shortcut-capture="true">
    <div class="lyrics-workbench-toolbar">
      <div class="lyrics-mode-switch" role="group" aria-label="歌词查看模式">
        <button type="button" :aria-pressed="mode === 'read'" @click="mode = 'read'">
          <BookOpen :size="15" aria-hidden="true" />阅读
        </button>
        <button type="button" :aria-pressed="mode === 'source'" @click="mode = 'source'">
          <CodeXml :size="15" aria-hidden="true" />源码
        </button>
      </div>
      <button
        v-if="mode === 'read'"
        type="button"
        class="lyrics-display-toggle"
        :aria-expanded="settingsOpen"
        :aria-controls="`${editorId}-settings`"
        @click="settingsOpen = !settingsOpen"
      >
        <SlidersHorizontal :size="15" aria-hidden="true" />显示
      </button>
      <span v-else class="lyrics-source-label">编辑原始歌词</span>
    </div>

    <div v-if="mode === 'read' && settingsOpen" :id="`${editorId}-settings`" class="lyrics-display-settings">
      <div class="lyrics-display-options" role="group" aria-label="阅读显示内容">
        <button type="button" :aria-pressed="showTime" @click="showTime = !showTime">
          <Check v-if="showTime" :size="13" aria-hidden="true" />时间
        </button>
        <button type="button" :aria-pressed="showTranslation" :disabled="!hasTranslation" @click="showTranslation = !showTranslation">
          <Check v-if="showTranslation" :size="13" aria-hidden="true" />翻译
        </button>
        <button type="button" :aria-pressed="showRomaji" :disabled="!hasRomaji" @click="showRomaji = !showRomaji">
          <Check v-if="showRomaji" :size="13" aria-hidden="true" />罗马音
        </button>
      </div>
      <label class="lyrics-font-control">
        <span>字号</span>
        <input v-model.number="fontSize" type="range" min="16" max="28" step="1" aria-label="歌词阅读字号" />
        <output>{{ fontSize }}</output>
      </label>
      <div v-if="canChooseOrder" class="lyrics-order-control">
        <span>本曲读取顺序</span>
        <SettingsSelect
          class="lyrics-order-select"
          label="本曲读取顺序"
          hide-label
          :model-value="readingOrderOverride ?? ''"
          :options="readingOrderOptions"
          :menu-z-index="10010"
          @update:model-value="changeReadingOrder"
        />
      </div>
    </div>

    <div
      v-show="mode === 'read'"
      class="lyrics-reading-scroll custom-scrollbar"
      :style="{ '--lyrics-reading-font-size': `${fontSize}px` }"
      :aria-busy="loading || parsing"
      aria-label="歌词阅读预览"
    >
      <div v-if="loading || parsing" class="lyrics-reading-empty" role="status">
        {{ loading ? '正在读取歌词…' : '正在整理歌词…' }}
      </div>
      <div v-else-if="!modelValue.trim()" class="lyrics-reading-empty">
        <BookOpen :size="28" :stroke-width="1.4" aria-hidden="true" />
        <p>还没有歌词</p>
        <button type="button" @click="mode = 'source'">在源码中添加歌词</button>
      </div>
      <div v-else-if="preview" class="lyrics-reading-content selectable-text">
        <details v-if="preview.metadata.length" class="lyrics-metadata">
          <summary>
            <span>歌词信息</span><span class="lyrics-metadata-count">{{ preview.metadata.length }} 项</span>
            <ChevronDown :size="14" aria-hidden="true" />
          </summary>
          <dl>
            <div v-for="(item, index) in preview.metadata" :key="`${item.key}-${index}`">
              <dt>{{ item.label }}</dt><dd>{{ item.value || '—' }}</dd>
            </div>
          </dl>
        </details>

        <div v-if="preview.error" class="lyrics-preview-notice" role="status">
          {{ preview.error }}
          <button type="button" @click="mode = 'source'">查看源码</button>
        </div>

        <div v-if="preview.lines.length" class="lyrics-reading-lines" :class="{ 'lyrics-reading-lines--timed': showTime }">
          <article v-for="(line, index) in preview.lines" :key="index" class="lyrics-reading-line">
            <span v-if="showTime" class="lyrics-line-time" :aria-label="`开始时间 ${formatTimestamp(line.time)}`">{{ formatTimestamp(line.time) }}</span>
            <div class="lyrics-line-body">
              <span v-if="line.isBG || line.isDuet" class="lyrics-voice-label">{{ line.isBG ? '和声' : '声部 2' }}</span>
              <p class="lyrics-line-main">{{ line.text }}</p>
              <p v-if="showTranslation && line.translation" class="lyrics-line-translation">{{ line.translation }}</p>
              <p v-if="showRomaji && line.romaji" class="lyrics-line-romaji">{{ line.romaji }}</p>
              <p v-for="(secondary, secondaryIndex) in line.secondary" :key="secondaryIndex" class="lyrics-line-translation">{{ secondary }}</p>
            </div>
          </article>
        </div>
        <div v-else-if="preview.plainText" class="lyrics-reading-plain">{{ preview.plainText }}</div>
        <p v-else class="lyrics-content-empty">没有可显示的歌词正文，可切换源码查看完整内容。</p>

        <section v-if="preview.unparsedLines.length" class="lyrics-unparsed">
          <h3>其他原文</h3>
          <p class="lyrics-unparsed-note">以下内容未参与分组，仍完整保留。</p>
          <div v-for="(line, index) in preview.unparsedLines" :key="index">{{ line }}</div>
        </section>
        <details v-if="preview.issues.length && !preview.error" class="lyrics-parse-details">
          <summary>解析提示 · {{ preview.issues.length }}</summary>
          <ul><li v-for="(issue, index) in preview.issues" :key="index">{{ issue }}</li></ul>
        </details>
      </div>
    </div>

    <LyricsSourceEditor
      v-if="sourceOpened"
      v-show="mode === 'source'"
      v-model="sourceText"
      :active="mode === 'source'"
      :loading="loading"
      :reading-order="readingOrder"
      :reading-order-override="readingOrderOverride"
      @update:reading-order="emit('update:readingOrder', $event)"
    />
  </div>
</template>

<style scoped>
.lyrics-workbench {
  --reader-text: var(--lyrics-editor-text-color, #1f2937);
  --reader-secondary: var(--lyrics-reader-secondary, #526070);
  --reader-muted: var(--lyrics-reader-muted, #64748b);
  --reader-accent: var(--lyrics-reader-accent, #c93240);
  --reader-divider: color-mix(in srgb, var(--reader-text) 10%, transparent);
  --reader-soft-bg: color-mix(in srgb, var(--reader-text) 4%, transparent);
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  color: var(--reader-text);
  container-type: inline-size;
}

.lyrics-workbench button,
.lyrics-workbench input { font: inherit; }
.lyrics-workbench button { cursor: pointer; }
.lyrics-workbench button:disabled { cursor: default; opacity: .45; }
.lyrics-workbench button:focus-visible,
.lyrics-workbench input:focus-visible,
.lyrics-workbench summary:focus-visible {
  outline: 2px solid var(--reader-accent) !important;
  outline-offset: 3px;
}
.lyrics-workbench-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--reader-divider);
  user-select: none;
}
.lyrics-mode-switch {
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 11px;
  background: var(--reader-soft-bg);
}
.lyrics-mode-switch button,
.lyrics-display-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 32px;
  border: 0;
  border-radius: 8px;
  padding: 6px 12px;
  background: transparent;
  color: var(--reader-secondary);
  font-size: 13px;
  white-space: nowrap;
}
.lyrics-mode-switch button[aria-pressed='true'] {
  background: var(--lyrics-editor-button-bg, #fff);
  color: var(--reader-text);
  box-shadow: 0 1px 4px rgb(0 0 0 / .07);
  font-weight: 600;
}
.lyrics-display-toggle:hover,
.lyrics-display-toggle[aria-expanded='true'] { background: var(--reader-soft-bg); color: var(--reader-accent); }
.lyrics-source-label { color: var(--reader-muted); font-size: 12px; }
.lyrics-display-settings {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px 20px;
  max-height: 45%;
  overflow: auto;
  padding: 16px 20px;
  border-bottom: 1px solid var(--reader-divider);
  background: var(--reader-soft-bg);
  font-size: 12px;
  user-select: none;
}
.lyrics-display-options { display: flex; flex-wrap: wrap; gap: 6px; }
.lyrics-display-options button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid var(--reader-divider);
  border-radius: 7px;
  background: transparent;
  color: var(--reader-secondary);
  font-size: 12px;
}
.lyrics-display-options button[aria-pressed='true'] {
  color: var(--reader-accent);
  border-color: color-mix(in srgb, var(--reader-accent) 25%, transparent);
  background: color-mix(in srgb, var(--reader-accent) 7%, transparent);
}
.lyrics-font-control {
  --range-track: rgb(15 23 42 / .1);
  --range-track-hover: rgb(15 23 42 / .16);
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  color: var(--reader-secondary);
}
.dark .lyrics-font-control {
  --range-track: rgb(255 255 255 / .22);
  --range-track-hover: rgb(255 255 255 / .32);
}
.lyrics-font-control input {
  -webkit-appearance: none;
  appearance: none;
  width: 108px;
  height: 20px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}
.lyrics-font-control input::-webkit-slider-runnable-track {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: var(--range-track);
  transition: background 150ms ease;
}
.lyrics-font-control input:hover::-webkit-slider-runnable-track { background: var(--range-track-hover); }
.lyrics-font-control input::-moz-range-track {
  width: 100%;
  height: 4px;
  border: 0;
  border-radius: 999px;
  background: var(--range-track);
  transition: background 150ms ease;
}
.lyrics-font-control input:hover::-moz-range-track { background: var(--range-track-hover); }
.lyrics-font-control input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  box-sizing: border-box;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border: 1px solid rgb(15 23 42 / .06);
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 2px 4px rgb(15 23 42 / .12), 0 0 1px rgb(15 23 42 / .2);
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.lyrics-font-control input::-webkit-slider-thumb:hover {
  transform: scale(1.18);
  box-shadow: 0 3px 6px rgb(15 23 42 / .16), 0 0 2px rgb(15 23 42 / .24);
}
.lyrics-font-control input::-webkit-slider-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 1px 3px rgb(15 23 42 / .14);
}
.lyrics-font-control input::-moz-range-thumb {
  box-sizing: border-box;
  width: 14px;
  height: 14px;
  border: 1px solid rgb(15 23 42 / .06);
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 2px 4px rgb(15 23 42 / .12), 0 0 1px rgb(15 23 42 / .2);
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.lyrics-font-control input::-moz-range-thumb:hover {
  transform: scale(1.18);
  box-shadow: 0 3px 6px rgb(15 23 42 / .16), 0 0 2px rgb(15 23 42 / .24);
}
.lyrics-font-control input::-moz-range-thumb:active {
  transform: scale(1.05);
  box-shadow: 0 1px 3px rgb(15 23 42 / .14);
}
.lyrics-font-control output { width: 2ch; text-align: right; font-variant-numeric: tabular-nums; }
.lyrics-order-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  min-width: 0;
  color: var(--reader-secondary);
}
.lyrics-order-select {
  width: 212px;
  max-width: 100%;
}
.lyrics-reading-scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.lyrics-reading-content {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 24px 20px 40px;
  user-select: text;
  -webkit-user-select: text;
}
.lyrics-metadata { margin-bottom: 26px; color: var(--reader-secondary); font-size: 12px; }
.lyrics-metadata summary { display: flex; align-items: center; gap: 8px; width: fit-content; cursor: pointer; list-style: none; user-select: none; }
.lyrics-metadata summary::-webkit-details-marker { display: none; }
.lyrics-metadata summary svg { transition: transform 150ms ease; }
.lyrics-metadata[open] summary svg { transform: rotate(180deg); }
.lyrics-metadata-count { color: var(--reader-muted); }
.lyrics-metadata dl { margin: 14px 0 0; padding: 14px 16px; border-radius: 10px; background: var(--reader-soft-bg); }
.lyrics-metadata dl > div { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 12px; line-height: 1.8; }
.lyrics-metadata dt { color: var(--reader-muted); }
.lyrics-metadata dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.lyrics-reading-lines { display: flex; flex-direction: column; gap: 27px; }
.lyrics-reading-line { display: grid; grid-template-columns: minmax(0, 1fr); align-items: baseline; }
.lyrics-reading-lines--timed .lyrics-reading-line { grid-template-columns: 62px minmax(0, 1fr); column-gap: 20px; }
.lyrics-line-time { padding-top: 4px; color: var(--reader-muted); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lyrics-line-body { min-width: 0; }
.lyrics-line-body p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.lyrics-line-main { color: var(--reader-text); font-size: var(--lyrics-reading-font-size); font-weight: 500; line-height: 1.75; }
.lyrics-line-body .lyrics-line-translation { margin-top: 5px; color: var(--reader-secondary); font-size: calc(var(--lyrics-reading-font-size) * .82); line-height: 1.7; }
.lyrics-line-body .lyrics-line-romaji { margin-top: 6px; color: var(--reader-muted); font-size: calc(var(--lyrics-reading-font-size) * .75); line-height: 1.7; }
.lyrics-voice-label { display: inline-block; margin-bottom: 4px; color: var(--reader-muted); font-size: 11px; }
.lyrics-reading-plain { font-size: var(--lyrics-reading-font-size); line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; }
.lyrics-reading-empty { display: flex; box-sizing: border-box; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 0; height: 100%; padding: 24px; color: var(--reader-muted); font-size: 14px; text-align: center; }
.lyrics-reading-empty p { margin: 0; color: var(--reader-secondary); }
.lyrics-reading-empty button,
.lyrics-preview-notice button { padding: 4px 0; border: 0; background: transparent; color: var(--reader-accent); font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
.lyrics-content-empty { color: var(--reader-muted); font-size: 14px; line-height: 1.7; }
.lyrics-preview-notice { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 20px; padding: 12px 14px; border-radius: 8px; background: var(--reader-soft-bg); color: var(--reader-secondary); font-size: 13px; line-height: 1.6; }
.lyrics-unparsed { margin-top: 32px; padding-top: 18px; border-top: 1px solid var(--reader-divider); }
.lyrics-unparsed h3 { margin: 0 0 4px; color: var(--reader-secondary); font-size: 13px; font-weight: 500; }
.lyrics-unparsed-note { margin: 0; color: var(--reader-muted); font-size: 12px; line-height: 1.6; }
.lyrics-unparsed > div { margin-top: 12px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: calc(var(--lyrics-reading-font-size) * .82); line-height: 1.7; }
.lyrics-parse-details { margin-top: 24px; color: var(--reader-muted); font-size: 12px; line-height: 1.7; }
.lyrics-parse-details summary { cursor: pointer; }
.lyrics-parse-details ul { margin: 8px 0 0; padding-left: 18px; overflow-wrap: anywhere; }
@container (max-width: 480px) {
  .lyrics-reading-content { padding: 20px 20px 32px; }
  .lyrics-reading-lines--timed .lyrics-reading-line { grid-template-columns: 56px minmax(0, 1fr); column-gap: 12px; }
  .lyrics-reading-lines { gap: 23px; }
  .lyrics-display-settings { gap: 12px; padding: 12px 18px; }
}
@container (max-width: 300px) {
  .lyrics-workbench-toolbar { padding: 10px 12px; }
  .lyrics-reading-content { padding-inline: 14px; }
  .lyrics-reading-lines--timed .lyrics-reading-line { grid-template-columns: minmax(0, 1fr); gap: 4px; }
}
@media (prefers-reduced-motion: reduce) {
  .lyrics-metadata summary svg { transition: none; }
  .lyrics-font-control input::-webkit-slider-runnable-track { transition: none; }
  .lyrics-font-control input::-webkit-slider-thumb { transition: none; }
  .lyrics-font-control input::-moz-range-track { transition: none; }
  .lyrics-font-control input::-moz-range-thumb { transition: none; }
}
</style>
