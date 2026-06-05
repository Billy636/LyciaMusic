import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';

import { useSettingsStore } from '../features/settings/store';
import { useAppThemeSync } from './useAppThemeSync';

const setTheme = vi.fn(() => Promise.resolve());
const onFocusChanged = vi.fn(() => Promise.resolve(() => undefined));
const applyWindowMaterial = vi.fn(() => Promise.resolve('none'));
const rebuildWindowMaterialForCompositor = vi.fn(() => Promise.resolve('none'));
const loadWindowMaterialCapabilities = vi.fn(() => Promise.resolve({
  isWindows: true,
  supportsAcrylic: true,
  supportsMica: true,
  supportsBlur: true,
  systemTransparencyEnabled: true,
  windowsBuildNumber: 22631,
}));
const activeWindowMaterial = ref('none');
let scope: EffectScope | null = null;

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setTheme,
    onFocusChanged,
  }),
}));

vi.mock('./windowMaterial', () => ({
  useWindowMaterial: () => ({
    activeWindowMaterial,
    applyWindowMaterial,
    rebuildWindowMaterialForCompositor,
    loadWindowMaterialCapabilities,
  }),
}));

async function flushThemeSync() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
}

describe('useAppThemeSync', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    scope = effectScope();
    vi.stubGlobal('document', {
      documentElement: {
        classList: {
          add: vi.fn(),
          contains: vi.fn(() => false),
          remove: vi.fn(),
        },
      },
    });
    setTheme.mockClear();
    onFocusChanged.mockClear();
    applyWindowMaterial.mockClear();
    rebuildWindowMaterialForCompositor.mockClear();
    loadWindowMaterialCapabilities.mockClear();
    activeWindowMaterial.value = 'none';
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
    vi.unstubAllGlobals();
  });

  it('does not resync native window material for custom background paint-only changes', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.patchTheme({
      mode: 'custom',
      windowMaterial: 'none',
      customBackground: {
        imagePath: '/covers/demo.jpg',
        foregroundStyle: 'light',
      },
    });

    scope?.run(() => useAppThemeSync());
    await flushThemeSync();

    const initialSetThemeCalls = setTheme.mock.calls.length;
    const initialMaterialCalls = applyWindowMaterial.mock.calls.length;

    settingsStore.patchTheme({
      customBackground: {
        blur: 36,
        opacity: 0.82,
        maskAlpha: 0.56,
        scale: 1.14,
      },
    });
    await flushThemeSync();

    expect(setTheme).toHaveBeenCalledTimes(initialSetThemeCalls);
    expect(applyWindowMaterial).toHaveBeenCalledTimes(initialMaterialCalls);
  });

  it('resyncs native window material when custom foreground style changes resolved theme darkness', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.patchTheme({
      mode: 'custom',
      windowMaterial: 'none',
      customBackground: {
        imagePath: '/covers/demo.jpg',
        foregroundStyle: 'light',
      },
    });

    scope?.run(() => useAppThemeSync());
    await flushThemeSync();

    const initialSetThemeCalls = setTheme.mock.calls.length;
    const initialMaterialCalls = applyWindowMaterial.mock.calls.length;

    settingsStore.patchTheme({
      customBackground: {
        foregroundStyle: 'dark',
      },
    });
    await flushThemeSync();

    expect(setTheme.mock.calls.length).toBeGreaterThan(initialSetThemeCalls);
    expect(applyWindowMaterial.mock.calls.length).toBeGreaterThan(initialMaterialCalls);
  });
});
