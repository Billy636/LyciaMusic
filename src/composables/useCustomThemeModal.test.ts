import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick, type EffectScope } from 'vue';

import { useSettingsStore } from '../features/settings/store';
import { useCustomThemeModal } from './useCustomThemeModal';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

async function flushPreviewUpdates() {
  await nextTick();
  await Promise.resolve();
}

describe('useCustomThemeModal', () => {
  let scope: EffectScope | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
    scope = effectScope();
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  it('keeps slider edits local until the user saves the custom skin', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.patchTheme({
      mode: 'light',
      dynamicBgType: 'flow',
      windowMaterial: 'none',
      customBackground: {
        imagePath: '/covers/original.jpg',
        blur: 20,
        opacity: 1,
        maskAlpha: 0.4,
        scale: 1,
        foregroundStyle: 'light',
      },
    });

    const modal = scope!.run(() => useCustomThemeModal())!;
    modal.preview.value.blur = 36;
    modal.preview.value.opacity = 0.82;
    modal.preview.value.maskAlpha = 0.56;
    modal.preview.value.scale = 1.14;
    await flushPreviewUpdates();

    expect(settingsStore.theme.mode).toBe('light');
    expect(settingsStore.theme.dynamicBgType).toBe('flow');
    expect(settingsStore.theme.customBackground.blur).toBe(20);
    expect(settingsStore.theme.customBackground.opacity).toBe(1);
    expect(settingsStore.theme.customBackground.maskAlpha).toBe(0.4);
    expect(settingsStore.theme.customBackground.scale).toBe(1);

    modal.handleSave();

    expect(settingsStore.theme.mode).toBe('custom');
    expect(settingsStore.theme.dynamicBgType).toBe('none');
    expect(settingsStore.theme.windowMaterial).toBe('none');
    expect(settingsStore.theme.customBackground.blur).toBe(36);
    expect(settingsStore.theme.customBackground.opacity).toBe(0.82);
    expect(settingsStore.theme.customBackground.maskAlpha).toBe(0.56);
    expect(settingsStore.theme.customBackground.scale).toBe(1.14);
  });

  it('drops local edits on cancel without rewriting the applied theme', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.patchTheme({
      mode: 'light',
      customBackground: {
        imagePath: '/covers/original.jpg',
        blur: 20,
        foregroundStyle: 'light',
      },
    });

    const modal = scope!.run(() => useCustomThemeModal())!;
    modal.preview.value.blur = 42;
    modal.preview.value.foregroundStyle = 'dark';
    await flushPreviewUpdates();

    modal.handleCancel();

    expect(settingsStore.theme.mode).toBe('light');
    expect(settingsStore.theme.customBackground.blur).toBe(20);
    expect(settingsStore.theme.customBackground.foregroundStyle).toBe('light');
  });
});
