<script setup lang="ts">
import { computed, onScopeDispose, ref, useId, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { ChevronDown, ChevronLeft, ChevronRight, Folder, FolderOpen, LoaderCircle, Plus, X } from 'lucide-vue-next';
import type { LibraryScanSettings, LibraryScanSource, RemoteFileEntry, RemoteSourceInput } from '../../types';
import { remoteLibraryApi } from '../../services/tauri/remoteLibraryApi';
import {
  hasLibraryScanFormats,
  libraryScanFormatOptions,
  normalizeScanDirectory,
  relativeScanDirectory,
  scanFormatExtensions,
  supportedScanExtensions,
  type LibraryScanFormatOption,
} from './libraryScanOptions';

const props = withDefaults(defineProps<{
  modelValue: LibraryScanSettings;
  source: LibraryScanSource;
  rootPath: string;
  remoteSourceInput?: RemoteSourceInput;
  disabled?: boolean;
}>(), { disabled: false });
const emit = defineEmits<{ 'update:modelValue': [settings: LibraryScanSettings] }>();
const contentId = useId();
const expanded = ref(true);
const pickerVisible = ref(false);
const browsingPath = ref('');
const remoteDirectories = ref<RemoteFileEntry[]>([]);
const loadingDirectory = ref(false);
const directoryError = ref('');
let browseGeneration = 0;

const supportedOptions = computed(() => libraryScanFormatOptions.filter(option => option[props.source.kind]));
const unavailableOptions = computed(() => libraryScanFormatOptions.filter(option => !option[props.source.kind]));
const availableExtensions = computed(() => supportedScanExtensions(props.source.kind));
const cueAvailable = computed(() => props.source.kind === 'local');
const allSelected = computed(() => availableExtensions.value.every(extension => props.modelValue.includedExtensions.includes(extension))
  && (!cueAvailable.value || props.modelValue.readCue));
const partiallySelected = computed(() => !allSelected.value
  && (hasLibraryScanFormats(props.modelValue, props.source.kind) || (cueAvailable.value && props.modelValue.readCue)));
const validFormats = computed(() => hasLibraryScanFormats(props.modelValue, props.source.kind));
const canBrowseParent = computed(() => relativeScanDirectory(browsingPath.value, props.rootPath, 'remote') !== null);
const canExcludeCurrent = computed(() => {
  const relative = relativeScanDirectory(browsingPath.value, props.rootPath, 'remote');
  return relative !== null && !directoryAlreadyExcluded(relative);
});

function patch(settings: Partial<LibraryScanSettings>) {
  emit('update:modelValue', { ...props.modelValue, ...settings });
}
function formatChecked(option: LibraryScanFormatOption) {
  return scanFormatExtensions(option, props.source.kind).every(extension => props.modelValue.includedExtensions.includes(extension));
}
function formatPartial(option: LibraryScanFormatOption) {
  return !formatChecked(option) && scanFormatExtensions(option, props.source.kind).some(extension => props.modelValue.includedExtensions.includes(extension));
}
function toggleFormat(option: LibraryScanFormatOption, event: Event) {
  const extensions = scanFormatExtensions(option, props.source.kind);
  const checked = (event.target as HTMLInputElement).checked;
  patch({ includedExtensions: checked
    ? [...new Set([...props.modelValue.includedExtensions, ...extensions])]
    : props.modelValue.includedExtensions.filter(extension => !extensions.includes(extension)) });
}
function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  patch({ includedExtensions: checked ? [...availableExtensions.value] : [], readCue: checked && cueAvailable.value });
}
function directoryAlreadyExcluded(relative: string) {
  const key = props.source.kind === 'local' ? relative.toLowerCase() : relative;
  return props.modelValue.excludedDirectories.some(directory => {
    const directoryKey = props.source.kind === 'local' ? directory.toLowerCase() : directory;
    return key === directoryKey || key.startsWith(`${directoryKey}/`);
  });
}
function addDirectory(path: string) {
  const relative = relativeScanDirectory(path, props.rootPath, props.source.kind);
  if (!relative) { directoryError.value = '请选择此音乐库根目录内的子文件夹'; return; }
  if (directoryAlreadyExcluded(relative)) { directoryError.value = '此文件夹已被排除'; return; }
  const key = props.source.kind === 'local' ? relative.toLowerCase() : relative;
  const retained = props.modelValue.excludedDirectories.filter(directory => {
    const directoryKey = props.source.kind === 'local' ? directory.toLowerCase() : directory;
    return !directoryKey.startsWith(`${key}/`);
  });
  patch({ excludedDirectories: [...retained, relative] });
  directoryError.value = '';
  pickerVisible.value = false;
}
async function browseRemote(path: string) {
  const generation = ++browseGeneration;
  const normalized = normalizeScanDirectory(path, 'remote');
  if (normalized !== normalizeScanDirectory(props.rootPath, 'remote') && relativeScanDirectory(normalized, props.rootPath, 'remote') === null) return;
  loadingDirectory.value = true;
  directoryError.value = '';
  browsingPath.value = normalized;
  remoteDirectories.value = [];
  try {
    if (props.source.kind !== 'remote') return;
    const entries = props.remoteSourceInput
      ? await remoteLibraryApi.previewRemoteDirectory(props.remoteSourceInput, normalized)
      : await remoteLibraryApi.listRemoteDirectory(props.source.sourceId, normalized);
    if (generation !== browseGeneration) return;
    remoteDirectories.value = entries.filter(entry => entry.isDir && relativeScanDirectory(entry.remotePath, props.rootPath, 'remote') !== null)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
  } catch (error) {
    if (generation === browseGeneration) directoryError.value = `读取目录失败：${String(error)}`;
  } finally {
    if (generation === browseGeneration) loadingDirectory.value = false;
  }
}
async function chooseDirectory() {
  if (props.disabled) return;
  directoryError.value = '';
  if (props.source.kind === 'remote') {
    pickerVisible.value = !pickerVisible.value;
    if (pickerVisible.value) await browseRemote(props.rootPath);
    return;
  }
  try {
    const generation = browseGeneration;
    const selected = await open({ directory: true, multiple: false, defaultPath: props.rootPath, title: '选择要排除的子文件夹' });
    if (typeof selected === 'string' && !props.disabled && generation === browseGeneration) addDirectory(selected);
  } catch (error) { directoryError.value = `选择文件夹失败：${String(error)}`; }
}
function browseParent() {
  if (!canBrowseParent.value) return;
  void browseRemote(browsingPath.value.replace(/\/[^/]+$/, '') || '/');
}
watch(() => [props.source.kind, props.source.kind === 'local' ? props.source.path : props.source.sourceId, props.rootPath, props.remoteSourceInput?.baseUrl, props.remoteSourceInput?.rootPath, props.remoteSourceInput?.username, props.remoteSourceInput?.password], () => {
  browseGeneration++;
  pickerVisible.value = false;
  loadingDirectory.value = false;
  remoteDirectories.value = [];
  directoryError.value = '';
});
onScopeDispose(() => { browseGeneration++; });
</script>

<template>
  <section class="scan-options">
    <div class="scan-options-heading">
      <button type="button" class="scan-disclosure" :aria-expanded="expanded" :aria-controls="contentId" :disabled="disabled" @click="expanded = !expanded">
        <span>扫描范围</span>
      </button>
      <label class="scan-select-all"><input type="checkbox" :checked="allSelected" :indeterminate.prop="partiallySelected" :disabled="disabled" @change="toggleAll"><span>全选可用</span></label>
      <button type="button" class="scan-chevron" :aria-label="expanded ? '折叠扫描范围' : '展开扫描范围'" :aria-expanded="expanded" :aria-controls="contentId" :disabled="disabled" @click="expanded = !expanded"><ChevronDown :size="17" :class="{ 'is-collapsed': !expanded }" aria-hidden="true" /></button>
    </div>
    <div :id="contentId" class="scan-expand" :class="{ 'is-expanded': expanded }" :inert="!expanded" :aria-hidden="!expanded">
      <div class="scan-expand-inner">
        <fieldset class="scan-format-field" aria-label="收录格式" :disabled="disabled">
          <div class="scan-format-list">
            <label v-for="option in supportedOptions" :key="option.label" class="scan-format" :class="{ 'is-checked': formatChecked(option) }" :title="scanFormatExtensions(option, source.kind).map(extension => `.${extension}`).join(' / ')">
              <input type="checkbox" :checked="formatChecked(option)" :indeterminate.prop="formatPartial(option)" @change="toggleFormat(option, $event)"><span>{{ option.label }}</span>
            </label>
            <label v-if="cueAvailable" class="scan-format" :class="{ 'is-checked': modelValue.readCue }"><input type="checkbox" :checked="modelValue.readCue" @change="patch({ readCue: ($event.target as HTMLInputElement).checked })"><span>CUE（曲目索引）</span></label>
          </div>
          <div class="scan-unavailable-label">{{ source.kind === 'local' ? '本地暂不支持' : '此来源暂不支持' }}</div>
          <div class="scan-format-list scan-unavailable">
            <label v-for="option in unavailableOptions" :key="option.label" class="scan-format"><input type="checkbox" disabled><span>{{ option.label }}</span></label>
            <label v-if="!cueAvailable" class="scan-format"><input type="checkbox" disabled><span>CUE（曲目索引）</span></label>
          </div>
          <p v-if="!validFormats" class="scan-error" role="alert">{{ cueAvailable ? '请至少选择一种音频格式，CUE 需搭配对应的音源格式' : '请至少选择一种音频格式' }}</p>
        </fieldset>

        <div class="scan-directory-heading"><span>排除的文件夹</span><button type="button" class="scan-add-directory" :disabled="disabled" @click="chooseDirectory"><Plus :size="14" aria-hidden="true" />添加文件夹</button></div>
        <div class="scan-directory-list">
          <div v-for="directory in modelValue.excludedDirectories" :key="directory" class="scan-directory-row"><Folder :size="17" aria-hidden="true" /><span :title="directory">{{ directory.replace(/\/$/, '') }}/</span><button type="button" :disabled="disabled" :aria-label="`移除 ${directory} 的排除规则`" @click="patch({ excludedDirectories: modelValue.excludedDirectories.filter(value => value !== directory) })"><X :size="16" aria-hidden="true" /></button></div>
          <p v-if="!modelValue.excludedDirectories.length" class="scan-directory-empty">尚未排除文件夹</p>
        </div>

        <div v-if="pickerVisible" class="scan-directory-picker" aria-label="选择要排除的文件夹">
          <div class="scan-picker-heading"><span>选择文件夹</span><button type="button" :disabled="disabled" aria-label="关闭文件夹选择" @click="pickerVisible = false"><X :size="16" aria-hidden="true" /></button></div>
          <div class="scan-picker-path"><button type="button" aria-label="上级文件夹" :disabled="disabled || loadingDirectory || !canBrowseParent" @click="browseParent"><ChevronLeft :size="16" aria-hidden="true" /></button><FolderOpen :size="16" aria-hidden="true" /><span :title="browsingPath">{{ browsingPath }}</span></div>
          <div v-if="loadingDirectory" class="scan-picker-empty"><LoaderCircle :size="18" class="animate-spin" aria-hidden="true" />读取中…</div>
          <div v-else class="scan-picker-entries">
            <button v-for="entry in remoteDirectories" :key="entry.remotePath" type="button" class="scan-picker-entry" :disabled="disabled" @click="browseRemote(entry.remotePath)"><Folder :size="17" aria-hidden="true" /><span>{{ entry.name }}</span><ChevronRight :size="15" aria-hidden="true" /></button>
            <p v-if="!remoteDirectories.length" class="scan-picker-empty">没有子文件夹</p>
          </div>
          <div class="scan-picker-footer"><button type="button" :disabled="disabled || loadingDirectory || !canExcludeCurrent" @click="addDirectory(browsingPath)">排除此文件夹</button></div>
        </div>
        <p v-if="directoryError" class="scan-error" role="alert">{{ directoryError }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.scan-options { color: #29292f; border-top: 1px solid var(--settings-divider); }
.scan-options-heading { display: flex; align-items: center; gap: 18px; min-height: 58px; }
.scan-disclosure, .scan-chevron { display: flex; align-items: center; padding: 6px 0; border: 0; background: transparent; color: inherit; cursor: pointer; }
.scan-disclosure { font-size: 14px; font-weight: 500; }
.scan-select-all { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--app-text-secondary); cursor: pointer; }
.scan-select-all input, .scan-format input { accent-color: #ec4141; margin: 0; }
.scan-chevron { margin-left: auto; padding: 6px; border-radius: 6px; }
.scan-chevron svg { transition: transform 180ms ease; }
.scan-chevron .is-collapsed { transform: rotate(-90deg); }
.scan-expand { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 200ms ease, opacity 180ms ease; }
.scan-expand.is-expanded { grid-template-rows: 1fr; opacity: 1; }
.scan-expand-inner { min-height: 0; overflow: hidden; }
.scan-format-field { margin: 0; padding: 0; border: 0; min-width: 0; }
.scan-format-list { display: flex; flex-wrap: wrap; gap: 9px; }
.scan-format { display: inline-flex; align-items: center; gap: 7px; min-height: 33px; padding: 5px 12px; border: 1px solid rgb(148 163 184 / .24); border-radius: 8px; background: rgb(255 255 255 / .45); font-size: 12px; cursor: pointer; transition: background 150ms ease, border-color 150ms ease; }
.scan-format input { width: 13px; height: 13px; }
.scan-format.is-checked { color: #c83232; background: rgb(236 65 65 / .07); border-color: rgb(236 65 65 / .25); }
.scan-unavailable-label { margin-top: 16px; margin-bottom: 9px; color: var(--app-text-secondary); font-size: 12px; }
.scan-unavailable .scan-format { color: var(--app-text-secondary); border-color: transparent; background: rgb(0 0 0 / .035); cursor: not-allowed; }
.scan-directory-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 18px 0 7px; font-size: 12px; color: var(--app-text-secondary); }
.scan-add-directory { display: inline-flex; align-items: center; gap: 4px; padding: 4px 0 4px 6px; border: 0; border-radius: 5px; background: transparent; color: #ec4141; font: inherit; cursor: pointer; }
.scan-directory-list { padding-bottom: 18px; }
.scan-directory-row { display: flex; align-items: center; gap: 9px; min-height: 39px; margin-top: 6px; padding: 4px 7px 4px 11px; border-radius: 8px; background: rgb(0 0 0 / .035); font-size: 12px; }
.scan-directory-row > svg { flex-shrink: 0; color: var(--app-text-secondary); }
.scan-directory-row > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.scan-directory-row button, .scan-picker-heading button, .scan-picker-path button { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 29px; height: 29px; padding: 5px; border: 0; border-radius: 6px; background: transparent; color: var(--app-text-secondary); cursor: pointer; }
.scan-directory-row button:hover, .scan-picker-heading button:hover, .scan-picker-path button:hover { background: rgb(0 0 0 / .06); }
.scan-directory-empty { margin: 0; padding: 8px 0 3px; color: var(--app-text-secondary); font-size: 12px; }
.scan-directory-picker { margin: 0 0 18px; padding: 12px; border: 1px solid var(--settings-divider); border-radius: 10px; background: rgb(255 255 255 / .38); }
.scan-picker-heading, .scan-picker-path { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.scan-picker-heading { justify-content: space-between; font-weight: 500; }
.scan-picker-path { padding: 5px 0 10px; color: var(--app-text-secondary); }
.scan-picker-path > span { min-width: 0; overflow-wrap: anywhere; }
.scan-picker-entries { max-height: 220px; overflow-y: auto; }
.scan-picker-entry { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 10px; border: 0; border-radius: 7px; background: transparent; color: inherit; text-align: left; font: inherit; font-size: 12px; cursor: pointer; }
.scan-picker-entry span { flex: 1; }
.scan-picker-entry:hover { background: rgb(236 65 65 / .07); }
.scan-picker-empty { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 0; padding: 18px 0; color: var(--app-text-secondary); font-size: 12px; }
.scan-picker-footer { display: flex; justify-content: flex-end; margin-top: 10px; }
.scan-picker-footer button { min-height: 32px; padding: 6px 11px; border: 0; border-radius: 7px; background: #ec4141; color: white; font: inherit; font-size: 12px; cursor: pointer; }
.scan-error { margin: 10px 0 16px; color: #ec4141; font-size: 12px; overflow-wrap: anywhere; }
button:disabled, fieldset:disabled .scan-format, .scan-select-all:has(input:disabled) { cursor: not-allowed; opacity: .55; }
button:focus-visible, .scan-format:has(input:focus-visible), .scan-select-all:has(input:focus-visible) { outline: 2px solid rgb(236 65 65 / .65); outline-offset: 3px; }
:global(.dark) .scan-options { color: #eeeeef; }
:global(.dark) .scan-format { border-color: rgb(255 255 255 / .14); background: rgb(255 255 255 / .035); }
:global(.dark) .scan-format.is-checked { color: #ff9393; border-color: rgb(236 65 65 / .3); background: rgb(236 65 65 / .1); }
:global(.dark) .scan-unavailable .scan-format, :global(.dark) .scan-directory-row { background: rgb(255 255 255 / .04); }
:global(.dark) .scan-directory-picker { background: rgb(255 255 255 / .025); }
@media (pointer: coarse) { .scan-format, .scan-picker-entry, .scan-add-directory, .scan-picker-footer button, .scan-select-all { min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .scan-expand, .scan-chevron svg, .scan-format { transition: none; } }
</style>
