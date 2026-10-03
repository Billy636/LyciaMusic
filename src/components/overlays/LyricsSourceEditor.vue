<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Check, Focus, Search } from 'lucide-vue-next';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { closeSearchPanel, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import SettingsSelect from '../settings/SettingsSelect.vue';
import { LYRICS_READING_ORDER_OPTIONS } from '../../composables/lyrics/readingOrder';
import { createLyricsSourceDocument } from '../../composables/lyrics/sourceDocument';
import { configureLyricsSource, createLyricsSourcePresentation } from '../../composables/lyrics/sourceEditor';
import type { LyricsReadingOrder } from '../../types';

const props = defineProps<{
  modelValue: string;
  loading: boolean;
  active: boolean;
  readingOrder: LyricsReadingOrder;
  readingOrderOverride?: LyricsReadingOrder;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:readingOrder': [value: LyricsReadingOrder | null];
}>();

const host = ref<HTMLDivElement | null>(null);
const weakenTime = ref(true);
const foldWordTime = ref(true);
const focusOriginal = ref(false);
const sourceInfo = shallowRef({ hasWordTiming: false, hasAuxiliary: false, supportsRoles: false });
const position = ref('第 1 行 · 1 列');
const readingOrderOptions = [{ value: '', label: '跟随默认' }, ...LYRICS_READING_ORDER_OPTIONS];
const editable = new Compartment();
let view: EditorView | undefined;
let documentModel: ReturnType<typeof createLyricsSourceDocument>;
let presentation: ReturnType<typeof createLyricsSourcePresentation>;

function options() {
  return { readingOrder: props.readingOrder, weakenTime: weakenTime.value,
    foldWordTime: foldWordTime.value, focusOriginal: focusOriginal.value };
}
function editableExtensions() {
  return [EditorState.readOnly.of(props.loading), EditorView.editable.of(!props.loading)];
}
function updateInfo(state: EditorState) {
  const info = presentation.getAnalysis(state);
  sourceInfo.value = { hasWordTiming: info.hasWordTiming, hasAuxiliary: info.hasAuxiliary, supportsRoles: info.supportsRoles };
  const cursor = state.selection.main.head;
  const line = state.doc.lineAt(cursor);
  position.value = `第 ${line.number} 行 · ${Array.from(line.text.slice(0, cursor - line.from)).length + 1} 列`;
}
function createState(raw: string) {
  documentModel = createLyricsSourceDocument(raw);
  presentation = createLyricsSourcePresentation(options());
  return EditorState.create({
    doc: documentModel.doc,
    extensions: [
      documentModel.extension,
      lineNumbers(),
      presentation.extension,
      editable.of(editableExtensions()),
      EditorState.changeFilter.of((transaction) => !props.loading || !transaction.docChanged),
      EditorState.tabSize.of(2),
      history(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(),
      EditorView.lineWrapping,
      placeholder('在这里粘贴或编辑完整歌词源码…'),
      search({ top: true }),
      keymap.of([
        { key: 'Escape', run: closeSearchPanel, stopPropagation: true },
        ...searchKeymap, ...defaultKeymap, ...historyKeymap,
      ]),
      EditorState.phrases.of({
        'Find': '查找', 'Replace': '替换', 'next': '下一个', 'previous': '上一个', 'all': '全选匹配',
        'match case': '区分大小写', 'regexp': '正则', 'by word': '整词',
        'replace': '替换', 'replace all': '全部替换', 'close': '关闭',
        'Go to line': '跳转到行', 'go': '跳转',
      }),
      EditorView.contentAttributes.of({
        'aria-label': '歌词源码', 'aria-multiline': 'true', spellcheck: 'false', autocapitalize: 'off',
      }),
      EditorView.editorAttributes.of({ 'data-shortcut-capture': 'true' }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) emit('update:modelValue', documentModel.getRaw(update.state));
        if (update.docChanged || update.selectionSet || update.transactions.some((transaction) => transaction.effects.length)) {
          updateInfo(update.state);
        }
      }),
    ],
  });
}
function changeReadingOrder(value: string) {
  emit('update:readingOrder', LYRICS_READING_ORDER_OPTIONS.find((option) => option.value === value)?.value ?? null);
}
function findInSource() {
  if (view) openSearchPanel(view);
}

onMounted(() => {
  if (!host.value) return;
  view = new EditorView({ state: createState(props.modelValue), parent: host.value });
  view.scrollDOM.classList.add('custom-scrollbar');
  updateInfo(view.state);
});
onBeforeUnmount(() => { view?.destroy(); view = undefined; });
watch(() => props.modelValue, (raw) => {
  if (!view || raw === documentModel.getRaw(view.state)) return;
  // Only an external load replaces state. Display switches retain undo/selection.
  view.setState(createState(raw));
  updateInfo(view.state);
});
watch(() => props.loading, () => {
  view?.dispatch({ effects: editable.reconfigure(editableExtensions()) });
});
watch([weakenTime, foldWordTime, focusOriginal, () => props.readingOrder], () => {
  view?.dispatch({ effects: configureLyricsSource.of(options()) });
});
watch(() => props.active, async (active) => {
  if (!active) return;
  await nextTick();
  view?.requestMeasure();
});
</script>

<template>
  <section class="lyrics-source-editor" :aria-busy="loading" aria-label="歌词源码编辑器" data-shortcut-capture="true">
    <div class="source-tools">
      <div class="source-focus-switch" role="group" aria-label="源码语言显示">
        <button type="button" :aria-pressed="!focusOriginal" @click="focusOriginal = false">全部语言</button>
        <button type="button" :aria-pressed="focusOriginal" :disabled="!sourceInfo.hasAuxiliary"
          :title="sourceInfo.hasAuxiliary ? '收起翻译与罗马音，保留原文编辑' : '未识别到可折叠的辅助语言行'" @click="focusOriginal = true">
          <Focus :size="14" aria-hidden="true" />原文聚焦
        </button>
      </div>
      <div class="source-options" role="group" aria-label="时间标签显示">
        <button type="button" :aria-pressed="weakenTime" @click="weakenTime = !weakenTime">
          <Check v-if="weakenTime" :size="13" aria-hidden="true" />弱化时间
        </button>
        <button type="button" :aria-pressed="foldWordTime" :disabled="!sourceInfo.hasWordTiming"
          :title="sourceInfo.hasWordTiming ? '仅折叠显示，不删除时间标签' : '本歌词没有逐字时间标签'" @click="foldWordTime = !foldWordTime">
          <Check v-if="foldWordTime" :size="13" aria-hidden="true" />折叠逐字时间
        </button>
      </div>
      <div v-if="sourceInfo.supportsRoles" class="source-order">
        <span>本曲读取顺序</span>
        <SettingsSelect class="source-order-select" label="本曲读取顺序" hide-label
          :model-value="readingOrderOverride ?? ''" :options="readingOrderOptions" :menu-z-index="10010"
          @update:model-value="changeReadingOrder" />
      </div>
      <button type="button" class="source-search" aria-label="在源码中查找" title="查找 / 替换 (Ctrl+F)" @click="findInSource">
        <Search :size="15" aria-hidden="true" />
      </button>
    </div>
    <div ref="host" class="source-editor-host" />
    <div class="source-status">
      <span>点击折叠标记可展开 · 复制保留完整源码</span>
      <span>{{ position }}</span>
    </div>
  </section>
</template>

<style scoped>
.lyrics-source-editor { --source-surface: var(--lyrics-editor-panel-bg, #fafafa); --source-font-size: 14px; --source-line-height: calc(var(--source-font-size) * 1.95); display: flex; flex: 1 1 0; flex-direction: column; min-width: 0; min-height: 0; color: var(--reader-text); }
.dark .lyrics-source-editor { --source-surface: var(--lyrics-editor-panel-bg, #172033); }
.source-tools { display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 10px 16px; max-height: 45%; overflow: auto; padding: 12px 18px; border-bottom: 1px solid var(--reader-divider); background: var(--reader-soft-bg); font-size: 12px; user-select: none; }
.source-tools button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 30px; padding: 5px 9px; border: 0; border-radius: 7px; background: transparent; color: var(--reader-secondary); font: inherit; cursor: pointer; white-space: nowrap; }
.source-tools button:disabled { opacity: .45; cursor: default; }
.source-tools button:focus-visible { outline: 2px solid var(--reader-accent) !important; outline-offset: 2px; }
.source-focus-switch { display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--reader-soft-bg); }
.source-focus-switch button[aria-pressed='true'] { background: var(--lyrics-editor-button-bg, #fff); color: var(--reader-text); box-shadow: 0 1px 4px rgb(0 0 0 / .07); font-weight: 600; }
.source-options { display: flex; flex-wrap: wrap; gap: 6px; }
.source-options button { border: 1px solid var(--reader-divider); }
.source-options button[aria-pressed='true'] { border-color: color-mix(in srgb, var(--reader-accent) 25%, transparent); color: var(--reader-accent); background: color-mix(in srgb, var(--reader-accent) 7%, transparent); }
.source-order { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; min-width: 0; color: var(--reader-secondary); }
.source-order-select { width: 206px; max-width: 100%; }
.source-tools .source-search { margin-left: auto; width: 32px; }
.source-search:hover { background: var(--reader-soft-bg); }
.source-editor-host { display: flex; flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden; }
.source-status { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: 8px 18px; border-top: 1px solid var(--reader-divider); color: var(--reader-muted); font-size: 11px; user-select: none; }
.source-editor-host :deep(.cm-editor) { width: 100%; height: 100%; background: transparent; color: var(--reader-text); font-size: var(--source-font-size); }
.source-editor-host :deep(.cm-editor.cm-focused) { outline: none; }
.source-editor-host :deep(.cm-scroller) { overflow: auto; overscroll-behavior: contain; font-family: 'Sarasa Mono SC', 'Cascadia Code', Consolas, 'Microsoft YaHei', monospace; line-height: var(--source-line-height); }
.source-editor-host :deep(.cm-content) { padding: 14px 0 24px; caret-color: var(--reader-accent); user-select: text; -webkit-user-select: text; }
.source-editor-host :deep(.cm-line) { padding: 2px 20px 2px 12px; overflow-wrap: anywhere; }
.source-editor-host :deep(.cm-gutters) { border: 0; border-right: 1px solid var(--reader-divider); background: var(--source-surface); color: var(--reader-muted); user-select: none; font-size: 11px; }
/* Only real rows get padding; zero-height gutter spacers must stay zero-height. */
.source-editor-host :deep(.cm-lyric-gutter-line) { padding-top: 2px; }
.source-editor-host :deep(.cm-lineNumbers .cm-gutterElement) { min-width: 30px; padding-right: 6px; padding-left: 8px; font-variant-numeric: tabular-nums; }
.source-editor-host :deep(.cm-lyric-role-gutter .cm-gutterElement) { width: 49px; padding-right: 7px; text-align: right; }
.source-editor-host :deep(.cm-lyric-role) { font-family: system-ui, 'Microsoft YaHei', sans-serif; font-size: 10px; white-space: nowrap; }
.source-editor-host :deep(.cm-lyric-role-main) { color: var(--reader-accent); font-weight: 600; }
.source-editor-host :deep(.cm-lyric-role-translation) { color: var(--reader-secondary); }
.source-editor-host :deep(.cm-lyric-role-roman) { color: var(--reader-muted); }
.source-editor-host :deep(.cm-lyric-role-empty) { color: var(--reader-muted); }
.source-editor-host :deep(.cm-lyric-role-metadata),
.source-editor-host :deep(.cm-lyric-role-other) { opacity: .75; }
.source-editor-host :deep(.cm-lyric-line-metadata) { color: var(--reader-secondary); }
.source-editor-host :deep(.cm-lyric-group-start) { border-top: 1px solid var(--reader-divider); padding-top: 10px; }
.source-editor-host :deep(.cm-activeLine),
.source-editor-host :deep(.cm-activeLineGutter) { background: transparent; }
.source-editor-host :deep(.cm-lyric-focus-main) { background: color-mix(in srgb, var(--reader-accent) 5%, transparent); }
.source-editor-host :deep(.cm-focused .cm-activeLine),
.source-editor-host :deep(.cm-focused .cm-activeLineGutter) { background: color-mix(in srgb, var(--reader-accent) 8%, transparent); }
.source-editor-host :deep(.cm-lyric-time-muted) { color: color-mix(in srgb, var(--reader-muted) 85%, transparent); }
.source-editor-host :deep(.cm-lyric-time) { font-weight: 400; }
.source-editor-host :deep(.cm-cursor) { border-left-color: var(--reader-accent); }
.source-editor-host :deep(.cm-selectionBackground),
.source-editor-host :deep(.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground) { background: color-mix(in srgb, var(--reader-accent) 22%, transparent); }
.source-editor-host :deep(.cm-lyric-fold-time) { display: inline; min-width: 8px; padding: 0 2px; border: 0; border-radius: 3px; background: transparent; color: var(--reader-muted); font: inherit; cursor: pointer; }
.source-editor-host :deep(.cm-lyric-fold-time:hover) { color: var(--reader-accent); background: color-mix(in srgb, var(--reader-accent) 12%, transparent); }
.source-editor-host :deep(.cm-lyric-fold-line) { display: inline-flex; align-items: center; min-height: 25px; padding: 0 6px; border: 0; border-radius: 5px; background: var(--reader-soft-bg); color: var(--reader-muted); font: 11px/1.6 system-ui, 'Microsoft YaHei', sans-serif; cursor: pointer; }
.source-editor-host :deep(.cm-lyric-fold-line:hover) { color: var(--reader-accent); }
.source-editor-host :deep(.cm-placeholder) { color: var(--reader-muted); }
.source-editor-host :deep(.cm-panels) { background: var(--source-surface); color: var(--reader-text); border-color: var(--reader-divider); font-size: 12px; }
.source-editor-host :deep(.cm-textfield) { min-width: 0; max-width: 100%; border: 1px solid var(--reader-divider); border-radius: 5px; background: var(--lyrics-editor-button-bg, #fff); color: var(--reader-text); }
.source-editor-host :deep(.cm-button) { border: 1px solid var(--reader-divider); border-radius: 5px; background: var(--reader-soft-bg); color: var(--reader-text); font-size: 11px; }
.source-editor-host :deep(.cm-panel button:focus-visible) { outline: 2px solid var(--reader-accent) !important; outline-offset: 1px; }
.source-editor-host :deep(.cm-searchMatch) { background: color-mix(in srgb, #dba437 25%, transparent); }
.source-editor-host :deep(.cm-searchMatch-selected) { background: color-mix(in srgb, var(--reader-accent) 24%, transparent); }
@container (max-width: 480px) {
  .source-tools { gap: 8px 12px; padding: 10px 12px; }
  .source-status { padding: 8px 12px; }
  .source-editor-host :deep(.cm-line) { padding-right: 12px; padding-left: 8px; }
  .source-editor-host :deep(.cm-lineNumbers .cm-gutterElement) { min-width: 24px; padding-left: 4px; }
  .source-editor-host :deep(.cm-lyric-role-gutter .cm-gutterElement) { width: 42px; padding-right: 4px; }
}
</style>
