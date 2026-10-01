<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { ChevronRight, Folder, FolderOpen, LoaderCircle, X } from 'lucide-vue-next';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { libraryApi } from '../../services/tauri/libraryApi';
import { folderMoveTargetError, folderPathKey, isWithinFolder } from '../../utils/folderMove';
import type { FolderNode } from '../../types';

const props = withDefaults(defineProps<{
  visible: boolean;
  selectedCount?: number;
  sourcePaths?: string[];
  sourceFolder?: { path: string; name: string } | null;
  busy?: boolean;
}>(), { selectedCount: 0, sourcePaths: () => [], sourceFolder: null, busy: false });

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'confirm', path: string, name: string): void;
}>();

const { activeRootPath } = usePlayerViewState();
const titleId = useId();
const dialog = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const roots = ref<FolderNode[]>([]);
const children = ref(new Map<string, FolderNode[]>());
const expanded = ref(new Set<string>());
const loading = ref(new Set<string>());
const loadingRoots = ref(false);
const choosingExternal = ref(false);
const selected = ref<{ path: string; name: string } | null>(null);
const error = ref('');
let generation = 0;
let returnFocus: HTMLElement | null = null;

const title = computed(() => props.sourceFolder
  ? '移动“' + props.sourceFolder.name + '”'
  : '移动 ' + props.selectedCount + ' 首歌曲');
const locked = computed(() => props.busy || choosingExternal.value);
const targetError = (path: string) => {
  if (!roots.value.some(root => isWithinFolder(path, root.path))) return '请选择音乐库内的文件夹';
  if (props.sourceFolder) return folderMoveTargetError(props.sourceFolder.path, path);
  if (props.sourcePaths.length > 0 && props.sourcePaths.every(source =>
    folderPathKey(source.replace(/[/\\][^/\\]+$/, '')) === folderPathKey(path),
  )) return '歌曲已在这个文件夹中';
  return '';
};
const selectionError = computed(() => selected.value ? targetError(selected.value.path) : '');
const rows = computed(() => {
  const result: { node: FolderNode; depth: number }[] = [];
  const visit = (nodes: FolderNode[], depth: number) => {
    for (const node of nodes) {
      result.push({ node, depth });
      if (expanded.value.has(node.path)) visit(children.value.get(node.path) || [], depth + 1);
    }
  };
  visit(roots.value, 0);
  return result;
});

const toggle = async (node: FolderNode) => {
  if (locked.value || loading.value.has(node.path)) return;
  if (expanded.value.has(node.path)) { expanded.value.delete(node.path); return; }
  const request = generation;
  if (!children.value.has(node.path)) {
    loading.value.add(node.path);
    try {
      const result = await libraryApi.getFolderChildren(node.path);
      if (request !== generation || !props.visible) return;
      children.value.set(node.path, result);
      error.value = '';
    } catch (cause) {
      if (request === generation) error.value = '无法打开文件夹：' + String(cause);
      return;
    } finally {
      if (request === generation) loading.value.delete(node.path);
    }
  }
  if (request === generation && props.visible) expanded.value.add(node.path);
};

const select = (node: { path: string; name: string }) => {
  if (locked.value) return;
  selected.value = { path: node.path, name: node.name };
  error.value = '';
};
const close = () => { if (!locked.value) emit('close'); };
const confirm = () => {
  if (!selected.value || selectionError.value || locked.value) return;
  emit('confirm', selected.value.path, selected.value.name);
};
const chooseOther = async () => {
  if (locked.value) return;
  const request = generation;
  choosingExternal.value = true;
  try {
    const path = await open({
      directory: true, multiple: false, title: '选择音乐库内的目标文件夹',
      defaultPath: selected.value?.path || activeRootPath.value || undefined,
    });
    if (request !== generation || !props.visible || typeof path !== 'string') return;
    selected.value = { path, name: path.split(/[/\\]/).filter(Boolean).pop() || path };
    error.value = '';
  } catch (cause) {
    if (request === generation) error.value = '选择文件夹失败：' + String(cause);
  } finally {
    if (request === generation) choosingExternal.value = false;
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  if (!props.visible) return;
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  else if (event.key === 'Tab') {
    const buttons = Array.from(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !dialog.value?.contains(document.activeElement))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.value?.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }
};

watch(() => props.visible, async visible => {
  const request = ++generation;
  if (!visible) {
    window.removeEventListener('keydown', handleKeydown, true);
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
    return;
  }
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  window.addEventListener('keydown', handleKeydown, true);
  selected.value = null;
  error.value = '';
  roots.value = [];
  children.value.clear();
  expanded.value.clear();
  loading.value.clear();
  choosingExternal.value = false;
  loadingRoots.value = true;
  await nextTick();
  if (request !== generation || !props.visible) return;
  closeButton.value?.focus();
  try {
    const result = await libraryApi.getLibraryHierarchy();
    if (request !== generation || !props.visible) return;
    roots.value = result;
    const root = result.find(node => folderPathKey(node.path) === folderPathKey(activeRootPath.value || ''));
    if (root) await toggle(root);
  } catch (cause) {
    if (request === generation) error.value = '加载文件夹失败：' + String(cause);
  } finally {
    if (request === generation) loadingRoots.value = false;
  }
}, { immediate: true });

onUnmounted(() => {
  generation++;
  window.removeEventListener('keydown', handleKeydown, true);
  if (returnFocus?.isConnected) returnFocus.focus();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm" @click.self="close">
      <section ref="dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId"
        class="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-2xl dark:border-white/10 dark:bg-[#202020]">
        <header class="flex items-center justify-between gap-3 border-b border-black/5 px-5 py-4 dark:border-white/10">
          <h3 :id="titleId" class="truncate font-semibold text-gray-900 dark:text-white" :title="title">{{ title }}</h3>
          <button ref="closeButton" type="button" aria-label="关闭" :disabled="locked" class="rounded-lg p-1.5 text-gray-500 hover:bg-black/5 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-white/10" @click="close"><X class="h-4 w-4" /></button>
        </header>
        <div class="custom-scrollbar min-h-40 flex-1 overflow-y-auto p-2">
          <div v-if="loadingRoots && !roots.length" class="flex justify-center py-10"><LoaderCircle class="h-5 w-5 animate-spin text-gray-400" /></div>
          <p v-else-if="!roots.length" class="py-10 text-center text-sm text-gray-400">暂无音乐库文件夹</p>
          <div v-for="{ node, depth } in rows" :key="node.path" class="flex items-center rounded-lg"
            :class="selected?.path === node.path ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'text-gray-800 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/5'"
            :style="{ paddingLeft: (depth * 18 + 4) + 'px' }">
            <button v-if="node.child_count > 0" type="button" :disabled="locked || loading.has(node.path)"
              :aria-label="(expanded.has(node.path) ? '折叠 ' : '展开 ') + node.name" :aria-expanded="expanded.has(node.path)"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" @click="toggle(node)">
              <LoaderCircle v-if="loading.has(node.path)" class="h-4 w-4 animate-spin" />
              <ChevronRight v-else class="h-4 w-4 transition-transform" :class="{ 'rotate-90': expanded.has(node.path) }" />
            </button>
            <span v-else class="w-8 shrink-0"></span>
            <button type="button" :disabled="locked" :aria-pressed="selected?.path === node.path" :title="node.path"
              class="flex min-w-0 flex-1 items-center gap-2.5 py-3 pr-3 text-left text-sm disabled:opacity-50" @click="select(node)">
              <FolderOpen v-if="expanded.has(node.path)" class="h-5 w-5 shrink-0 text-blue-400" />
              <Folder v-else class="h-5 w-5 shrink-0 text-blue-400" />
              <span class="truncate" :class="{ 'opacity-40': !!targetError(node.path) }">{{ node.name }}</span>
            </button>
          </div>
        </div>
        <div v-if="selected" class="truncate px-5 pb-3 text-xs text-gray-500 dark:text-gray-400" :title="selected.path">{{ selected.path }}</div>
        <p v-if="error || selectionError" role="status" class="px-5 pb-3 text-sm text-red-500">{{ error || selectionError }}</p>
        <footer class="flex items-center justify-between gap-3 border-t border-black/5 px-4 py-3 dark:border-white/10">
          <button type="button" :disabled="locked || loadingRoots" class="rounded-lg px-2 py-2 text-sm text-gray-500 hover:text-gray-900 disabled:opacity-40 dark:text-gray-400 dark:hover:text-white" @click="chooseOther">其他目录…</button>
          <button type="button" :disabled="locked || !selected || !!selectionError" class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40" @click="confirm">{{ busy ? '正在移动…' : '移动到这里' }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
