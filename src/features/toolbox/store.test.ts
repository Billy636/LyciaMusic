import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  DEFAULT_TOOLBOX_RULES,
  DEFAULT_TOOLBOX_TEMPLATE,
  defaultSelectedPaths,
  normalizePersistedWorkbenchState,
  normalizeToolboxRules,
  summarizeSelection,
  useToolboxStore,
} from './store';
import { toolboxApi } from '../../services/tauri/toolboxApi';
import { libraryApi } from '../../services/tauri/libraryApi';
import { ensureLddcPath, getSavedLddcPath, selectLddcPath } from '../../composables/lddc';
import type { ToolboxPreviewItem } from '../../services/tauri/contracts';

vi.mock('../../services/tauri/toolboxApi', () => ({
  toolboxApi: {
    preview: vi.fn(),
    applyRename: vi.fn(),
    launchProgram: vi.fn(),
  },
}));

vi.mock('../../services/tauri/libraryApi', () => ({
  libraryApi: {
    refreshFolderSongs: vi.fn(),
  },
}));

vi.mock('../../composables/lddc', () => ({
  ensureLddcPath: vi.fn(),
  getSavedLddcPath: vi.fn(),
  selectLddcPath: vi.fn(),
}));

const createPreviewItem = (overrides: Partial<ToolboxPreviewItem>): ToolboxPreviewItem => ({
  original_path: 'C:\\music\\old.flac',
  original_name: 'old.flac',
  cleaned_name: 'old.flac',
  tag_name: null,
  missing_fields: [],
  final_name: 'old.flac',
  will_change: false,
  conflict: false,
  conflict_reason: null,
  ...overrides,
});

const mockedPreview = vi.mocked(toolboxApi.preview);
const mockedApplyRename = vi.mocked(toolboxApi.applyRename);
const mockedRefreshFolderSongs = vi.mocked(libraryApi.refreshFolderSongs);
const mockedLaunchProgram = vi.mocked(toolboxApi.launchProgram);
const mockedEnsureLddcPath = vi.mocked(ensureLddcPath);
const mockedGetSavedLddcPath = vi.mocked(getSavedLddcPath);
const mockedSelectLddcPath = vi.mocked(selectLddcPath);

describe('toolbox selection helpers', () => {
  it('defaults selection to changing non-conflicting rows only', () => {
    const items = [
      createPreviewItem({ original_path: 'a', will_change: true }),
      createPreviewItem({ original_path: 'b', will_change: true, conflict: true }),
      createPreviewItem({ original_path: 'c' }),
    ];

    expect(defaultSelectedPaths(items)).toEqual(['a']);
  });

  it('summarizes selection into master-checkbox state', () => {
    const items = [
      createPreviewItem({ original_path: 'a', will_change: true }),
      createPreviewItem({ original_path: 'b', will_change: true }),
      createPreviewItem({ original_path: 'c', will_change: true, conflict: true }),
    ];

    expect(summarizeSelection(items, new Set())).toEqual({
      selectableCount: 2,
      selectedCount: 0,
      allSelected: false,
      noneSelected: true,
      indeterminate: false,
    });

    const partial = summarizeSelection(items, new Set(['a']));
    expect(partial.selectedCount).toBe(1);
    expect(partial.indeterminate).toBe(true);

    const all = summarizeSelection(items, new Set(['a', 'b', 'c']));
    expect(all.allSelected).toBe(true);
    expect(all.selectedCount).toBe(2);
  });

  it('normalizes persisted state and rejects invalid values', () => {
    const state = normalizePersistedWorkbenchState(null);
    expect(state).toEqual({
      targetPath: '',
      rules: { ...DEFAULT_TOOLBOX_RULES },
      template: DEFAULT_TOOLBOX_TEMPLATE,
      autoRefresh: true,
      resolveConflicts: true,
    });

    const weird = normalizePersistedWorkbenchState({
      targetPath: 42,
      rules: { remove_track_prefix: 'yes' },
      template: '   ',
      autoRefresh: false,
    });
    expect(weird.targetPath).toBe('');
    expect(weird.rules).toEqual({
      remove_track_prefix: false,
      remove_source_prefix: false,
      replace_underscore: false,
      collapse_spaces: false,
    });
    expect(weird.template).toBe(DEFAULT_TOOLBOX_TEMPLATE);
    expect(weird.autoRefresh).toBe(false);
    expect(weird.resolveConflicts).toBe(true);

    const optOut = normalizePersistedWorkbenchState({ resolveConflicts: false });
    expect(optOut.resolveConflicts).toBe(false);
  });

  it('normalizes rules flags strictly', () => {
    expect(normalizeToolboxRules({ remove_track_prefix: true })).toEqual({
      ...DEFAULT_TOOLBOX_RULES,
      remove_track_prefix: true,
    });
    expect(normalizeToolboxRules('junk')).toEqual({
      remove_track_prefix: false,
      remove_source_prefix: false,
      replace_underscore: false,
      collapse_spaces: false,
    });
  });
});

describe('LDDC shortcut', () => {
  const programPath = 'C:\\tools\\LDDC\\LDDC.exe';

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    mockedGetSavedLddcPath.mockReturnValue(null);
    mockedEnsureLddcPath.mockResolvedValue(programPath);
    mockedLaunchProgram.mockResolvedValue(undefined);
  });

  it('restores the saved program configuration', () => {
    mockedGetSavedLddcPath.mockReturnValue(programPath);
    const store = useToolboxStore();

    expect(store.lddcPath).toBe(programPath);
    expect(store.lddcConfigured).toBe(true);
    expect(mockedEnsureLddcPath).not.toHaveBeenCalled();
  });

  it.each(['', 'C:\\music'])('launches with empty arguments regardless of target %j', async (target) => {
    const store = useToolboxStore();
    store.targetPath = target;
    mockedGetSavedLddcPath.mockReturnValue(programPath);

    expect(await store.launchLddc()).toBe(true);
    expect(mockedLaunchProgram).toHaveBeenCalledExactlyOnceWith(programPath, []);
    expect(store.lddcConfigured).toBe(true);
    expect(store.lddcPath).toBe(programPath);
    expect(store.isLddcBusy).toBe(false);
    expect(store.lddcError).toBe('');
    expect(mockedPreview).not.toHaveBeenCalled();
  });

  it('does not launch when selection is cancelled and clears a stale configured indicator', async () => {
    mockedGetSavedLddcPath.mockReturnValue(programPath);
    const store = useToolboxStore();
    mockedGetSavedLddcPath.mockReturnValue(null);
    mockedEnsureLddcPath.mockResolvedValue(null);

    expect(await store.launchLddc()).toBe(false);
    expect(mockedLaunchProgram).not.toHaveBeenCalled();
    expect(store.lddcConfigured).toBe(false);
    expect(store.isLddcBusy).toBe(false);
    expect(store.lddcError).toBe('');
  });

  it('prevents duplicate launch or reconfiguration while the picker is pending', async () => {
    let resolvePath!: (path: string | null) => void;
    mockedEnsureLddcPath.mockImplementation(() => new Promise((resolve) => { resolvePath = resolve; }));
    const store = useToolboxStore();

    const firstLaunch = store.launchLddc();
    expect(store.isLddcBusy).toBe(true);
    expect(await store.launchLddc()).toBe(false);
    expect(await store.changeLddcPath()).toBe(false);
    expect(mockedEnsureLddcPath).toHaveBeenCalledTimes(1);
    expect(mockedSelectLddcPath).not.toHaveBeenCalled();

    resolvePath(programPath);
    expect(await firstLaunch).toBe(true);
    expect(mockedLaunchProgram).toHaveBeenCalledTimes(1);
    expect(store.isLddcBusy).toBe(false);
  });

  it('reports a launch failure and allows retrying', async () => {
    const store = useToolboxStore();
    mockedLaunchProgram.mockRejectedValueOnce(new Error('无法启动程序'));

    expect(await store.launchLddc()).toBe(false);
    expect(store.lddcError).toBe('无法启动程序');
    expect(store.isLddcBusy).toBe(false);

    expect(await store.launchLddc()).toBe(true);
    expect(store.lddcError).toBe('');
  });

  it('handles path validation and dialog exceptions without launching', async () => {
    const store = useToolboxStore();
    mockedEnsureLddcPath.mockRejectedValueOnce('无法检查程序路径');

    expect(await store.launchLddc()).toBe(false);
    expect(store.lddcError).toBe('无法检查程序路径');
    expect(store.isLddcBusy).toBe(false);
    expect(mockedLaunchProgram).not.toHaveBeenCalled();
  });

  it('updates the selected program without launching it', async () => {
    const store = useToolboxStore();
    mockedSelectLddcPath.mockResolvedValue(programPath);
    mockedGetSavedLddcPath.mockReturnValue(programPath);

    expect(await store.changeLddcPath()).toBe(true);
    expect(store.lddcPath).toBe(programPath);
    expect(store.lddcConfigured).toBe(true);
    expect(store.isLddcBusy).toBe(false);
    expect(mockedLaunchProgram).not.toHaveBeenCalled();
  });

  it('keeps the existing program when reconfiguration is cancelled', async () => {
    mockedGetSavedLddcPath.mockReturnValue(programPath);
    mockedSelectLddcPath.mockResolvedValue(null);
    const store = useToolboxStore();

    expect(await store.changeLddcPath()).toBe(false);
    expect(store.lddcPath).toBe(programPath);
    expect(store.lddcConfigured).toBe(true);
    expect(store.lddcError).toBe('');
  });

  it('reports reconfiguration errors and releases the busy state', async () => {
    const store = useToolboxStore();
    mockedSelectLddcPath.mockRejectedValue(new Error('无法打开选择框'));

    expect(await store.changeLddcPath()).toBe(false);
    expect(store.lddcError).toBe('无法打开选择框');
    expect(store.isLddcBusy).toBe(false);
  });
});

describe('toolbox store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('previews a folder and resets selection to the safe defaults', async () => {
    const store = useToolboxStore();

    mockedPreview.mockResolvedValue([
      createPreviewItem({ original_path: 'C:\\music\\a.flac', will_change: true }),
      createPreviewItem({
        original_path: 'C:\\music\\b.flac',
        will_change: true,
        conflict: true,
      }),
    ]);

    store.setTargetPath('C:\\music');
    await vi.waitFor(() => expect(store.previewItems).toHaveLength(2));

    expect(mockedPreview).toHaveBeenCalledWith('C:\\music', {
      template: DEFAULT_TOOLBOX_TEMPLATE,
      resolve_conflicts: true,
      ...DEFAULT_TOOLBOX_RULES,
    });
    expect(store.selectedPaths.has('C:\\music\\a.flac')).toBe(true);
    expect(store.selectedPaths.has('C:\\music\\b.flac')).toBe(false);
    expect(store.scanError).toBe('');
  });

  it('records scan errors and clears previous items', async () => {
    const store = useToolboxStore();
    store.previewItems = [createPreviewItem({})];

    mockedPreview.mockRejectedValue(new Error('文件夹不存在'));

    store.setTargetPath('C:\\missing');
    await vi.waitFor(() => expect(store.scanError).toContain('文件夹不存在'));

    expect(store.previewItems).toHaveLength(0);
    expect(store.selectedPaths.size).toBe(0);
  });

  it('applies selected rows, reports failures and refreshes the library', async () => {
    const store = useToolboxStore();
    store.autoRefresh = true;
    store.targetPath = 'C:\\music';

    const item = createPreviewItem({
      original_path: 'C:\\music\\a.flac',
      final_name: 'A - B.flac',
      will_change: true,
    });
    store.previewItems = [item];
    store.selectedPaths = new Set([item.original_path]);

    mockedApplyRename.mockResolvedValue({
      success_count: 0,
      failures: [
        { original_path: item.original_path, new_name: item.final_name, error: '目标文件名已被占用' },
      ],
    });
    mockedPreview.mockResolvedValue([item]);
    mockedRefreshFolderSongs.mockResolvedValue(undefined);

    const result = await store.applySelected();

    expect(mockedApplyRename).toHaveBeenCalledWith([
      { original_path: item.original_path, new_name: 'A - B.flac' },
    ]);
    expect(result?.success_count).toBe(0);
    expect(store.applyFailures[item.original_path]).toBe('目标文件名已被占用');
    expect(mockedRefreshFolderSongs).toHaveBeenCalledWith('C:\\music', 0);
  });

  it('skips library refresh when auto refresh is disabled', async () => {
    const store = useToolboxStore();
    store.autoRefresh = false;

    const item = createPreviewItem({ original_path: 'p', final_name: 'n', will_change: true });
    store.previewItems = [item];
    store.selectedPaths = new Set(['p']);

    mockedApplyRename.mockResolvedValue({ success_count: 1, failures: [] });
    mockedPreview.mockResolvedValue([]);

    await store.applySelected();

    expect(mockedRefreshFolderSongs).not.toHaveBeenCalled();
    expect(store.applyFailures).toEqual({});
  });

  it('does not apply when selection is empty', async () => {
    const store = useToolboxStore();
    store.previewItems = [createPreviewItem({})];
    store.selectedPaths = new Set();

    await store.applySelected();

    expect(mockedApplyRename).not.toHaveBeenCalled();
  });

  it('resets the workbench but keeps preferences', () => {
    const store = useToolboxStore();
    store.targetPath = 'C:\\music';
    store.previewItems = [createPreviewItem({})];
    store.lastApplyResult = { success_count: 1, failures: [] };

    store.resetWorkbench();

    expect(store.targetPath).toBe('');
    expect(store.previewItems).toHaveLength(0);
    expect(store.lastApplyResult).toBeNull();
    expect(store.template).toBe(DEFAULT_TOOLBOX_TEMPLATE);
    expect(store.autoRefresh).toBe(true);
  });
});
