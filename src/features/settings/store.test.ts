import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { mergeAppSettings, useSettingsStore } from './store';
import type { EqualizerSettings } from '../../types';

// Helper: allows partial EqualizerSettings patches in tests
const partialEq = (patch: Partial<EqualizerSettings>) => patch as EqualizerSettings;

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('patches theme settings without losing nested custom background fields', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchTheme({
      mode: 'custom',
      customBackground: {
        imagePath: '/covers/demo.jpg',
        blur: 32,
      },
    });

    expect(settingsStore.theme.mode).toBe('custom');
    expect(settingsStore.theme.customBackground.imagePath).toBe('/covers/demo.jpg');
    expect(settingsStore.theme.customBackground.blur).toBe(32);
    expect(settingsStore.theme.customBackground.maskColor).toBe('#000000');
  });

  it('replaces theme through the settings domain instead of mutating ui state', () => {
    const settingsStore = useSettingsStore();

    settingsStore.replaceTheme({
      mode: 'dark',
      dynamicBgType: 'blur',
      windowMaterial: 'mica',
      flowColorBoost: 62,
      flowDepth: 54,
      flowSpeed: 48,
      flowTexture: 28,
      windowBlurTint: 50,
      customBgPath: '',
      opacity: 0.75,
      blur: 18,
      customBackground: {
        imagePath: '/covers/fallback.jpg',
        blur: 24,
        opacity: 0.85,
        maskColor: '#101010',
        maskAlpha: 0.45,
        scale: 1.08,
        foregroundStyle: 'light',
      },
    });

    expect(settingsStore.settings.theme.windowMaterial).toBe('mica');
    expect(settingsStore.settings.theme.customBackground.foregroundStyle).toBe('light');
  });

  it('normalizes legacy auto foreground style to light', () => {
    const settingsStore = useSettingsStore();

    settingsStore.replaceTheme({
      mode: 'custom',
      dynamicBgType: 'none',
      windowMaterial: 'none',
      flowColorBoost: 25,
      flowDepth: 30,
      flowSpeed: 52,
      flowTexture: 34,
      windowBlurTint: 50,
      customBgPath: '',
      opacity: 0.8,
      blur: 20,
      customBackground: {
        imagePath: '/covers/legacy.jpg',
        blur: 20,
        opacity: 1,
        maskColor: '#000000',
        maskAlpha: 0.4,
        scale: 1,
        foregroundStyle: 'auto' as unknown as 'light',
      },
    });

    expect(settingsStore.settings.theme.customBackground.foregroundStyle).toBe('light');
  });

  it('merges shortcut settings without dropping untouched bindings', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchSettings({
      shortcuts: {
        enabled: false,
        local: {
          togglePlay: {
            code: 'Enter',
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
          },
        },
      },
    });

    expect(settingsStore.settings.shortcuts.enabled).toBe(false);
    expect(settingsStore.settings.shortcuts.local.togglePlay?.code).toBe('Enter');
    expect(settingsStore.settings.shortcuts.local.nextSong?.code).toBe('ArrowRight');
    expect(settingsStore.settings.shortcuts.global.togglePlay?.code).toBe('KeyP');
  });

  it('ignores deprecated minimizeToTray when merging persisted settings', () => {
    const settingsStore = useSettingsStore();

    const merged = mergeAppSettings(settingsStore.settings, {
      minimizeToTray: true,
      closeToTray: true,
    });

    expect(merged.closeToTray).toBe(true);
    expect('minimizeToTray' in merged).toBe(false);
  });

  it('enables the scroll to top button by default', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.enableScrollToTopButton).toBe(true);
  });

  it('shows song comments by default', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.showSongComments).toBe(true);
  });

  it('minimizes to tray on close by default', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.closeToTray).toBe(true);
  });

  it('disables short audio exclusion by default and preserves persisted threshold', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.libraryMinDurationSeconds).toBe(0);

    const merged = mergeAppSettings(settingsStore.settings, {
      libraryMinDurationSeconds: 12,
    });

    expect(merged.libraryMinDurationSeconds).toBe(12);
  });

  it('normalizes invalid short audio thresholds to disabled', () => {
    const settingsStore = useSettingsStore();

    const merged = mergeAppSettings(settingsStore.settings, {
      libraryMinDurationSeconds: -5,
    });

    expect(merged.libraryMinDurationSeconds).toBe(0);
  });

  it('remembers whether desktop lyrics were open', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.showDesktopLyrics).toBe(false);

    const merged = mergeAppSettings(settingsStore.settings, {
      showDesktopLyrics: true,
    });

    expect(merged.showDesktopLyrics).toBe(true);
  });

  it('uses shared audio output by default and preserves persisted output mode', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.audio.outputMode).toBe('shared');
    expect(settingsStore.settings.audio.volumeBalance.gainOffsetDb).toBe(0);

    const merged = mergeAppSettings(settingsStore.settings, {
      audio: {
        outputMode: 'wasapiExclusive',
      },
    });

    expect(merged.audio.outputMode).toBe('wasapiExclusive');
  });

  it('migrates legacy target LUFS volume balance settings to gain offset dB', () => {
    const settingsStore = useSettingsStore();

    const merged = mergeAppSettings(settingsStore.settings, {
      audio: {
        volumeBalance: {
          enabled: true,
          targetLufs: -14,
          preventClipping: false,
        },
      },
    });

    expect(merged.audio.volumeBalance).toEqual({
      enabled: true,
      gainOffsetDb: 4,
      preventClipping: false,
    });
  });

  it('merges lyrics settings without dropping untouched display preferences', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchSettings({
      lyrics: {
        showRomaji: true,
        playerOffsetX: 999,
      },
    });

    expect(settingsStore.settings.lyrics.showTranslation).toBe(true);
    expect(settingsStore.settings.lyrics.showRomaji).toBe(true);
    expect(settingsStore.settings.lyrics.playerOffsetX).toBe(30);
  });

  it('uses AMLL as the default player lyrics render mode', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.lyrics.playerRenderMode).toBe('amll');
  });

  it('preserves a persisted light player lyrics render mode', () => {
    const settingsStore = useSettingsStore();

    const merged = mergeAppSettings(settingsStore.settings, {
      lyrics: {
        playerRenderMode: 'light',
      },
    });

    expect(merged.lyrics.playerRenderMode).toBe('light');
  });

  it('normalizes invalid player lyrics render modes to AMLL', () => {
    const settingsStore = useSettingsStore();

    const merged = mergeAppSettings(settingsStore.settings, {
      lyrics: {
        playerRenderMode: 'canvas' as unknown as 'amll',
      },
    });

    expect(merged.lyrics.playerRenderMode).toBe('amll');
  });

  it('merges desktop lyrics settings while keeping the desktop defaults intact', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchSettings({
      desktopLyrics: {
        autoHideWhenFullscreen: false,
        colorScheme: 'pink',
      },
    });

    expect(settingsStore.settings.desktopLyrics.autoHideWhenFullscreen).toBe(false);
    expect(settingsStore.settings.desktopLyrics.colorScheme).toBe('pink');
    expect(settingsStore.settings.desktopLyrics.playerAlignment).toBe('center');
  });

  it('merges desktop romaji played and unplayed custom colors independently', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchSettings({
      desktopLyrics: {
        customRomajiPlayedColor: '#123456',
        customRomajiUnplayedColor: '#ABCDEF',
      },
    });

    expect(settingsStore.settings.desktopLyrics.customRomajiPlayedColor).toBe('#123456');
    expect(settingsStore.settings.desktopLyrics.customRomajiUnplayedColor).toBe('#ABCDEF');
  });

  it('preserves outputMode when patching only equalizer', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        outputMode: 'wasapiExclusive',
      },
    });

    store.patchSettings({
      audio: {
        equalizer: {
          currentPresetId: 'preset_1',
        } as unknown as import('../../types').EqualizerSettings,
      },
    });

    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');
  });

  it('save/load/delete preset preserve wasapiExclusive output mode', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        outputMode: 'wasapiExclusive',
      },
    });

    const preset = store.saveEqualizerPreset('Custom');
    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');

    store.loadEqualizerPreset(preset.id);
    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');

    store.deleteEqualizerPreset(preset.id);
    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');
  });

  // ============================================================
  // 均衡器边界场景测试
  // 参考：音乐播放器常见bug场景
  // ============================================================

  it('preserves outputMode through multiple sequential equalizer patches', () => {
    // 场景：用户连续多次调整均衡器，outputMode 不应丢失
    // 参考：汽车论坛反馈 - 均衡器设置保存后总是复位
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        outputMode: 'wasapiExclusive',
        equalizer: partialEq({ enabled: true, preamp: 0, gains: Array(10).fill(0) }),
      },
    });

    // 模拟用户多次调整
    store.patchSettings({
      audio: { equalizer: partialEq({ preamp: -3 }) },
    });
    store.patchSettings({
      audio: { equalizer: partialEq({ gains: [1, 2, 3, 4, 5, 5, 4, 3, 2, 1] }) },
    });
    store.patchSettings({
      audio: { equalizer: partialEq({ enabled: false }) },
    });

    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');
  });

  it('preserves volumeBalance when patching only equalizer gains', () => {
    // 场景：用户只调整EQ增益，音量平衡设置不应丢失
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        volumeBalance: { enabled: true, gainOffsetDb: 5, preventClipping: true },
      },
    });

    store.patchSettings({
      audio: {
        equalizer: partialEq({ gains: [1, 2, 3, 4, 5, 5, 4, 3, 2, 1] }),
      },
    });

    expect(store.settings.audio.volumeBalance).toEqual({
      enabled: true,
      gainOffsetDb: 5,
      preventClipping: true,
    });
  });

  it('handles rapid save-delete-save preset operations', () => {
    // 场景：快速连续保存和删除预设（压力测试）
    // 参考：参数均衡器自动保存预设关不掉的bug
    const store = useSettingsStore();

    store.patchSettings({
      audio: { outputMode: 'wasapiExclusive' },
    });

    const preset1 = store.saveEqualizerPreset('Preset 1');
    const preset2 = store.saveEqualizerPreset('Preset 2');
    const preset3 = store.saveEqualizerPreset('Preset 3');

    store.deleteEqualizerPreset(preset2.id);
    store.deleteEqualizerPreset(preset1.id);

    const preset4 = store.saveEqualizerPreset('Preset 4');

    expect(store.userPresets).toHaveLength(2);
    expect(store.userPresets.map(p => p.id)).toContain(preset3.id);
    expect(store.userPresets.map(p => p.id)).toContain(preset4.id);
    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');
  });

  it('handles preset operations with extreme gain values', () => {
    // 场景：极端增益值（±12dB是常见范围）
    // 参考：均衡器增益范围边界问题
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        equalizer: partialEq({
          preamp: -12,
          gains: [-12, -12, -12, -12, -12, 12, 12, 12, 12, 12],
        }),
      },
    });

    const preset = store.saveEqualizerPreset('Extreme');
    expect(preset.gains).toEqual([-12, -12, -12, -12, -12, 12, 12, 12, 12, 12]);
    expect(preset.preamp).toBe(-12);

    // 加载后值应保持
    store.patchSettings({
      audio: { equalizer: partialEq({ gains: Array(10).fill(0), preamp: 0 }) },
    });
    store.loadEqualizerPreset(preset.id);
    expect(store.settings.audio.equalizer.gains).toEqual([-12, -12, -12, -12, -12, 12, 12, 12, 12, 12]);
    expect(store.settings.audio.equalizer.preamp).toBe(-12);
  });

  it('handles preset operations with decimal gain values', () => {
    // 场景：小数增益值（精确调节）
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        equalizer: partialEq({
          preamp: -3.5,
          gains: [1.5, 2.5, -0.5, 3.75, -1.25, 0, 4.5, -2.75, 1.125, -0.875],
        }),
      },
    });

    const preset = store.saveEqualizerPreset('Decimal');
    expect(preset.gains).toEqual([1.5, 2.5, -0.5, 3.75, -1.25, 0, 4.5, -2.75, 1.125, -0.875]);

    store.loadEqualizerPreset(preset.id);
    expect(store.settings.audio.equalizer.gains).toEqual([1.5, 2.5, -0.5, 3.75, -1.25, 0, 4.5, -2.75, 1.125, -0.875]);
  });

  it('preserves showEqualizerInFooter through equalizer patches', () => {
    // 场景：调整均衡器不应影响footer显示设置
    const store = useSettingsStore();

    store.patchSettings({
      audio: { showEqualizerInFooter: false },
    });

    store.patchSettings({
      audio: {
        equalizer: partialEq({ enabled: true, gains: Array(10).fill(5) }),
      },
    });

    expect(store.settings.audio.showEqualizerInFooter).toBe(false);
  });

  it('handles loading preset after manual equalizer adjustments', () => {
    // 场景：用户手动调EQ后加载预设，应完全覆盖手动设置
    // 参考：切换预设时设置不同步
    const store = useSettingsStore();

    const preset = store.saveEqualizerPreset('Initial');

    // 用户手动调整
    store.patchSettings({
      audio: {
        equalizer: partialEq({
          preamp: -6,
          gains: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
          currentPresetId: null,
        }),
      },
    });

    expect(store.settings.audio.equalizer.preamp).toBe(-6);
    expect(store.settings.audio.equalizer.currentPresetId).toBeNull();

    // 加载预设应恢复预设值
    store.loadEqualizerPreset(preset.id);
    expect(store.settings.audio.equalizer.preamp).toBe(0);
    expect(store.settings.audio.equalizer.gains).toEqual(Array(10).fill(0));
    expect(store.settings.audio.equalizer.currentPresetId).toBe(preset.id);
  });

  it('deleting non-current preset does not affect current equalizer state', () => {
    // 场景：删除非当前预设不应影响当前均衡器状态
    const store = useSettingsStore();

    const preset1 = store.saveEqualizerPreset('Preset 1');
    const preset2 = store.saveEqualizerPreset('Preset 2');

    store.loadEqualizerPreset(preset2.id);

    // 删除非当前预设
    store.deleteEqualizerPreset(preset1.id);

    expect(store.settings.audio.equalizer.currentPresetId).toBe(preset2.id);
    expect(store.settings.audio.equalizer.enabled).toBe(true);
  });

  it('handles save preset with special characters in name', () => {
    // 场景：特殊字符预设名称
    const store = useSettingsStore();

    const preset1 = store.saveEqualizerPreset('摇滚 & Bass');
    const preset2 = store.saveEqualizerPreset('预设 <1>');
    const preset3 = store.saveEqualizerPreset('Test "Quote"');

    expect(preset1.name).toBe('摇滚 & Bass');
    expect(preset2.name).toBe('预设 <1>');
    expect(preset3.name).toBe('Test "Quote"');

    expect(store.userPresets).toHaveLength(3);
  });

  it('handles save preset with empty name', () => {
    // 场景：空名称预设
    const store = useSettingsStore();

    const preset = store.saveEqualizerPreset('');
    expect(preset.name).toBe('');
    expect(store.userPresets).toHaveLength(1);
  });

  it('preset gains are independent copies - modifying one does not affect others', () => {
    // 场景：预设数据隔离 - 修改一个预设不应影响其他预设
    const store = useSettingsStore();

    store.patchSettings({
      audio: { equalizer: partialEq({ gains: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }) },
    });
    const preset1 = store.saveEqualizerPreset('P1');

    store.patchSettings({
      audio: { equalizer: partialEq({ gains: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] }) },
    });
    const preset2 = store.saveEqualizerPreset('P2');

    expect(preset1.gains).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(preset2.gains).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);

    // 加载P1不应获得P2的值
    store.loadEqualizerPreset(preset1.id);
    expect(store.settings.audio.equalizer.gains).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('updateEqualizerPreset captures current settings at update time', () => {
    // 场景：更新预设时应捕获当前的均衡器设置
    // 参考：预设更新后设置没有同步
    const store = useSettingsStore();

    store.patchSettings({
      audio: { equalizer: partialEq({ preamp: 0, gains: Array(10).fill(0) }) },
    });
    const preset = store.saveEqualizerPreset('Original');

    // 用户调整后更新预设
    store.patchSettings({
      audio: { equalizer: partialEq({ preamp: -5, gains: [5, 4, 3, 2, 1, -1, -2, -3, -4, -5] }) },
    });
    store.updateEqualizerPreset(preset.id, 'Updated');

    // 加载更新后的预设应获得新值
    store.patchSettings({ audio: { equalizer: partialEq({ preamp: 0, gains: Array(10).fill(0) }) } });
    store.loadEqualizerPreset(preset.id);

    expect(store.settings.audio.equalizer.preamp).toBe(-5);
    expect(store.settings.audio.equalizer.gains).toEqual([5, 4, 3, 2, 1, -1, -2, -3, -4, -5]);
  });

  it('outputMode resets correctly from wasapiExclusive to shared', () => {
    // 场景：用户主动切换回shared模式
    const store = useSettingsStore();

    store.patchSettings({
      audio: { outputMode: 'wasapiExclusive' },
    });
    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');

    store.patchSettings({
      audio: { outputMode: 'shared' },
    });
    expect(store.settings.audio.outputMode).toBe('shared');
  });

  it('mergeAudioSettings handles undefined patch gracefully', () => {
    // 场景：空patch不应改变任何设置
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        outputMode: 'wasapiExclusive',
        equalizer: partialEq({ enabled: true, preamp: -3, gains: Array(10).fill(5) }),
      },
    });

    const before = { ...store.settings.audio };
    store.patchSettings({ audio: {} });
    const after = store.settings.audio;

    expect(after.outputMode).toBe(before.outputMode);
    expect(after.equalizer.enabled).toBe(before.equalizer.enabled);
    expect(after.equalizer.preamp).toBe(before.equalizer.preamp);
    expect(after.equalizer.gains).toEqual(before.equalizer.gains);
  });

  it('resetSettings clears all equalizer state including custom presets', () => {
    // 场景：重置设置应清除所有均衡器状态
    const store = useSettingsStore();

    store.patchSettings({ audio: { outputMode: 'wasapiExclusive' } });
    store.saveEqualizerPreset('Custom 1');
    store.saveEqualizerPreset('Custom 2');

    store.resetSettings();

    expect(store.settings.audio.outputMode).toBe('shared');
    expect(store.settings.audio.equalizer.enabled).toBe(false);
    expect(store.settings.audio.equalizer.preamp).toBe(0);
    expect(store.settings.audio.equalizer.gains).toEqual(Array(10).fill(0));
    // 注意：equalizerPresets 是独立的ref，resetSettings不会清除它
    // 这是设计决定，因为预设存储在localStorage中
  });
});
