import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';

import { ensureMusicTagPath, getSavedMusicTagPath } from '../../composables/musicTag';
import { localStore } from '../../services/storage/localStore';
import { libraryApi } from '../../services/tauri/libraryApi';
import type { RenameApplyResult, ToolboxPreviewItem } from '../../services/tauri/contracts';
import { toolboxApi } from '../../services/tauri/toolboxApi';

export interface ToolboxRules {
  remove_track_prefix: boolean;
  remove_source_prefix: boolean;
  replace_underscore: boolean;
  collapse_spaces: boolean;
}

export const DEFAULT_TOOLBOX_TEMPLATE = '{title} - {artist}';

export const DEFAULT_TOOLBOX_RULES: ToolboxRules = {
  remove_track_prefix: true,
  remove_source_prefix: false,
  replace_underscore: false,
  collapse_spaces: false,
};

const WORKBENCH_STORAGE_KEY = 'toolbox_workbench_state';

interface ToolboxPersistedState {
  targetPath: string;
  rules: ToolboxRules;
  template: string;
  autoRefresh: boolean;
  resolveConflicts: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

export const normalizeToolboxRules = (raw: unknown): ToolboxRules => {
  const source = asRecord(raw);
  return {
    remove_track_prefix: source?.remove_track_prefix === true,
    remove_source_prefix: source?.remove_source_prefix === true,
    replace_underscore: source?.replace_underscore === true,
    collapse_spaces: source?.collapse_spaces === true,
  };
};

export const normalizePersistedWorkbenchState = (raw: unknown): ToolboxPersistedState => {
  const source = asRecord(raw);

  // 首次使用（无存储状态）时套用默认偏好：去序号前缀开启、重名自动加序号
  if (!source) {
    return {
      targetPath: '',
      rules: { ...DEFAULT_TOOLBOX_RULES },
      template: DEFAULT_TOOLBOX_TEMPLATE,
      autoRefresh: true,
      resolveConflicts: true,
    };
  }

  const template =
    typeof source.template === 'string' && source.template.trim().length > 0
      ? source.template
      : DEFAULT_TOOLBOX_TEMPLATE;

  return {
    targetPath: typeof source.targetPath === 'string' ? source.targetPath : '',
    rules: normalizeToolboxRules(source.rules),
    template,
    autoRefresh: source.autoRefresh !== false,
    resolveConflicts: source.resolveConflicts !== false,
  };
};

/** 默认勾选：会改名且无冲突的行 */
export const defaultSelectedPaths = (items: ToolboxPreviewItem[]): string[] =>
  items.filter((item) => item.will_change && !item.conflict).map((item) => item.original_path);

export interface SelectionSummary {
  selectableCount: number;
  selectedCount: number;
  allSelected: boolean;
  noneSelected: boolean;
  indeterminate: boolean;
}

export const summarizeSelection = (
  items: ToolboxPreviewItem[],
  selected: Set<string>,
): SelectionSummary => {
  const selectable = items.filter((item) => item.will_change && !item.conflict);
  const selectedCount = selectable.filter((item) => selected.has(item.original_path)).length;

  return {
    selectableCount: selectable.length,
    selectedCount,
    allSelected: selectable.length > 0 && selectedCount === selectable.length,
    noneSelected: selectedCount === 0,
    indeterminate: selectedCount > 0 && selectedCount < selectable.length,
  };
};

export const useToolboxStore = defineStore('toolbox', () => {
  const legacyTemplateKey = 'toolbox_default_template';
  const hasWorkbenchState = localStore.getJson(WORKBENCH_STORAGE_KEY) !== null;
  const persisted = normalizePersistedWorkbenchState(localStore.getJson(WORKBENCH_STORAGE_KEY));

  // 兼容旧版工具箱的模板持久化键
  if (!hasWorkbenchState) {
    const legacyTemplate = localStore.getString(legacyTemplateKey);
    if (legacyTemplate) {
      persisted.template = legacyTemplate;
    }
  }

  const targetPath = ref(persisted.targetPath);
  const rules = ref<ToolboxRules>(persisted.rules);
  const template = ref(persisted.template);
  const autoRefresh = ref(persisted.autoRefresh);
  const resolveConflicts = ref(persisted.resolveConflicts);
  const musicTagConfigured = ref(Boolean(getSavedMusicTagPath()));

  const previewItems = ref<ToolboxPreviewItem[]>([]);
  const selectedPaths = ref<Set<string>>(new Set());
  const isScanning = ref(false);
  const isApplying = ref(false);
  const isRefreshingLibrary = ref(false);
  const libraryRefreshed = ref(false);
  const scanError = ref('');
  const applyFailures = ref<Record<string, string>>({});
  const lastApplyResult = ref<RenameApplyResult | null>(null);

  let scanToken = 0;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  const hasTarget = computed(() => targetPath.value.trim().length > 0);
  const missingTagCount = computed(
    () => previewItems.value.filter((item) => item.tag_name === null).length,
  );
  const conflictCount = computed(() => previewItems.value.filter((item) => item.conflict).length);
  const changedCount = computed(
    () => previewItems.value.filter((item) => item.will_change).length,
  );
  const selectionSummary = computed(() =>
    summarizeSelection(previewItems.value, selectedPaths.value),
  );
  const canApply = computed(
    () =>
      hasTarget.value &&
      selectionSummary.value.selectedCount > 0 &&
      !isScanning.value &&
      !isApplying.value,
  );

  watch([targetPath, rules, template, autoRefresh, resolveConflicts], () => {
    localStore.setJson(WORKBENCH_STORAGE_KEY, {
      targetPath: targetPath.value,
      rules: rules.value,
      template: template.value,
      autoRefresh: autoRefresh.value,
      resolveConflicts: resolveConflicts.value,
    });
  });

  async function refreshPreview() {
    if (!hasTarget.value) {
      scanToken += 1;
      previewItems.value = [];
      selectedPaths.value = new Set();
      scanError.value = '';
      return;
    }

    const token = ++scanToken;
    isScanning.value = true;
    scanError.value = '';

    try {
      const items = await toolboxApi.preview(targetPath.value, {
        template: template.value,
        resolve_conflicts: resolveConflicts.value,
        ...rules.value,
      });
      if (token !== scanToken) return;

      previewItems.value = items;
      selectedPaths.value = new Set(defaultSelectedPaths(items));
    } catch (error) {
      if (token !== scanToken) return;

      console.error('Failed to preview toolbox renames:', error);
      previewItems.value = [];
      selectedPaths.value = new Set();
      scanError.value = error instanceof Error ? error.message : String(error);
    } finally {
      if (token === scanToken) {
        isScanning.value = false;
      }
    }
  }

  /** 规则/模板变化后的防抖预览，组件卸载后仍会完成 */
  function schedulePreview(delayMs = 300) {
    if (previewTimer) {
      clearTimeout(previewTimer);
    }
    previewTimer = setTimeout(() => {
      previewTimer = null;
      void refreshPreview();
    }, delayMs);
  }

  function setTargetPath(path: string) {
    if (targetPath.value === path) {
      return;
    }

    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }

    targetPath.value = path;
    lastApplyResult.value = null;
    applyFailures.value = {};
    libraryRefreshed.value = false;
    void refreshPreview();
  }

  function patchRules(patch: Partial<ToolboxRules>) {
    rules.value = { ...rules.value, ...patch };
    schedulePreview();
  }

  function setResolveConflicts(value: boolean) {
    resolveConflicts.value = value;
    schedulePreview();
  }

  function setTemplate(value: string) {
    template.value = value;
    schedulePreview();
  }

  function toggleRow(path: string) {
    const next = new Set(selectedPaths.value);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    selectedPaths.value = next;
  }

  function selectAllSelectable() {
    selectedPaths.value = new Set(defaultSelectedPaths(previewItems.value));
  }

  function clearSelection() {
    selectedPaths.value = new Set();
  }

  function toggleMasterSelection() {
    if (selectionSummary.value.allSelected) {
      clearSelection();
    } else {
      selectAllSelectable();
    }
  }

  async function applySelected(minimumDurationSeconds = 0): Promise<RenameApplyResult | null> {
    const operations = previewItems.value
      .filter((item) => selectedPaths.value.has(item.original_path))
      .map((item) => ({ original_path: item.original_path, new_name: item.final_name }));

    if (operations.length === 0) {
      return null;
    }

    isApplying.value = true;

    try {
      const result = await toolboxApi.applyRename(operations);
      lastApplyResult.value = result;
      applyFailures.value = Object.fromEntries(
        result.failures.map((failure) => [failure.original_path, failure.error]),
      );
      // 重新预览，让已改名的文件反映新名字，失败的行保留错误标记
      await refreshPreview();
      if (autoRefresh.value) {
        await refreshLibrary(minimumDurationSeconds);
      }
      return result;
    } catch (error) {
      console.error('Failed to apply renames:', error);
      return null;
    } finally {
      isApplying.value = false;
    }
  }

  async function refreshLibrary(minimumDurationSeconds = 0): Promise<boolean> {
    if (!hasTarget.value) {
      return false;
    }

    isRefreshingLibrary.value = true;

    try {
      await libraryApi.refreshFolderSongs(targetPath.value, minimumDurationSeconds);
      libraryRefreshed.value = true;
      return true;
    } catch (error) {
      console.error('Failed to refresh library:', error);
      return false;
    } finally {
      isRefreshingLibrary.value = false;
    }
  }

  /** 懒配置：走到需要 MusicTag 的动作时才解析/选择路径 */
  async function launchMusicTagForTarget(): Promise<boolean> {
    const musicTagPath = await ensureMusicTagPath();
    if (!musicTagPath) {
      return false;
    }

    musicTagConfigured.value = true;

    try {
      await toolboxApi.launchProgram(musicTagPath, hasTarget.value ? [targetPath.value] : []);
      return true;
    } catch (error) {
      console.error('Failed to launch MusicTag:', error);
      return false;
    }
  }

  /** 处理另一个文件夹：清空会话状态，保留偏好 */
  function resetWorkbench() {
    targetPath.value = '';
    previewItems.value = [];
    selectedPaths.value = new Set();
    lastApplyResult.value = null;
    applyFailures.value = {};
    libraryRefreshed.value = false;
    scanError.value = '';
  }

  return {
    targetPath,
    rules,
    template,
    autoRefresh,
    resolveConflicts,
    musicTagConfigured,
    previewItems,
    selectedPaths,
    isScanning,
    isApplying,
    isRefreshingLibrary,
    libraryRefreshed,
    scanError,
    applyFailures,
    lastApplyResult,
    hasTarget,
    missingTagCount,
    conflictCount,
    changedCount,
    selectionSummary,
    canApply,
    refreshPreview,
    schedulePreview,
    setTargetPath,
    patchRules,
    setResolveConflicts,
    setTemplate,
    toggleRow,
    selectAllSelectable,
    clearSelection,
    toggleMasterSelection,
    applySelected,
    refreshLibrary,
    launchMusicTagForTarget,
    resetWorkbench,
  };
});
