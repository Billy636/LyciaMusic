import { describe, expect, it } from 'vitest';

import settingsToolboxSource from './SettingsToolbox.vue?raw';
import fileTableSource from './ToolboxFileTable.vue?raw';
import actionBarSource from './ToolboxActionBar.vue?raw';

describe('SettingsToolbox workbench structure', () => {
  it('uses the store-driven workbench instead of the removed step wizard', () => {
    expect(settingsToolboxSource).toContain('useToolboxStore');
    expect(settingsToolboxSource).not.toContain('currentView');
    expect(settingsToolboxSource).not.toContain('progressSteps');
  });

  it('keeps the MusicTag path lazily configured instead of blocking startup', () => {
    expect(settingsToolboxSource).toContain('launchMusicTagForTarget');
    expect(settingsToolboxSource).not.toContain('MUSICTAG_PATH_KEY');
  });

  it('restores the previous session when the tab is revisited', () => {
    expect(settingsToolboxSource).toContain('if (store.hasTarget)');
    expect(settingsToolboxSource).toContain('store.refreshPreview()');
  });

  it('passes the library minimum duration setting into the apply flow', () => {
    expect(settingsToolboxSource).toContain('libraryMinDurationSeconds');
  });
});

describe('ToolboxFileTable rendering contract', () => {
  it('renders conflict, missing-tag and failure states per row', () => {
    expect(fileTableSource).toContain('冲突');
    expect(fileTableSource).toContain('缺标签');
    expect(fileTableSource).toContain('失败');
    expect(fileTableSource).toContain('applyFailures');
  });

  it('explains conflict reasons instead of a generic badge', () => {
    expect(fileTableSource).toContain("conflict_reason === 'occupied'");
    expect(fileTableSource).toContain('占用');
    expect(fileTableSource).toContain('重名');
    expect(fileTableSource).toContain('重名自动加序号');
    expect(fileTableSource).toContain('store.resolveConflicts');
  });

  it('shows the old-to-new name diff with a master checkbox', () => {
    expect(fileTableSource).toContain('toggleMasterSelection');
    expect(fileTableSource).toContain('indeterminate');
    expect(fileTableSource).toContain('line-through');
  });

  it('does not rely on the unavailable animate-in utility classes', () => {
    expect(fileTableSource).not.toContain('animate-in');
    expect(actionBarSource).not.toContain('animate-in');
    expect(settingsToolboxSource).not.toContain('animate-in');
  });
});

describe('ToolboxActionBar flow', () => {
  it('auto refreshes the library after applying and offers the next batch reset', () => {
    expect(actionBarSource).toContain('应用后自动刷新音乐库');
    expect(actionBarSource).toContain('store.lastApplyResult');
    expect(actionBarSource).toContain('处理另一个文件夹');
  });
});
