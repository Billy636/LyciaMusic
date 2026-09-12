import { describe, expect, it } from 'vitest';

import settingsToolboxSource from './SettingsToolbox.vue?raw';
import fileTableSource from './ToolboxFileTable.vue?raw';
import actionBarSource from './ToolboxActionBar.vue?raw';
import rulesPanelSource from './ToolboxRulesPanel.vue?raw';
import templatePanelSource from './ToolboxTemplatePanel.vue?raw';

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

  it('describes MusicTag as fetching tags rather than repairing them', () => {
    expect(settingsToolboxSource).toContain('MusicTag 获取标签');
    expect(settingsToolboxSource).toContain('使用外部软件 MusicTag 获取标签信息，需自行下载');
    expect(settingsToolboxSource).not.toContain('修复标签');
    expect(actionBarSource).not.toContain('修正标签');
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

describe('Toolbox flat layout', () => {
  const sources = [
    settingsToolboxSource,
    fileTableSource,
    actionBarSource,
    rulesPanelSource,
    templatePanelSource,
  ];

  it('drops the glass card containers in favour of a flat layout', () => {
    for (const source of sources) {
      expect(source).not.toContain('backdrop-blur');
      expect(source).not.toContain('bg-white/55');
    }
  });

  it('uses the brand-red section header convention across panels', () => {
    expect(rulesPanelSource).toContain('清理规则');
    expect(templatePanelSource).toContain('命名模板');
    for (const source of [rulesPanelSource, templatePanelSource, settingsToolboxSource]) {
      expect(source).toContain('rounded-full bg-[#EC4141]');
    }
  });

  it('keeps a light surface only for the long file list', () => {
    expect(fileTableSource).toContain('bg-white/25 dark:bg-white/[0.04]');
  });
});
