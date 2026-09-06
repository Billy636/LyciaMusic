import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';

import { useSettingsStore } from '../features/settings/store';
import { useAppThemeSync } from './useAppThemeSync';
import { useThemeSettings } from './useThemeSettings';

const setTheme = vi.fn(() => Promise.resolve());
const getTheme = vi.fn(() => Promise.resolve<'light' | 'dark' | null>('light'));
const onThemeChanged = vi.fn(() => Promise.resolve(() => undefined));
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
    theme: getTheme,
    onThemeChanged,
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

vi.mock('../services/tauri/windowApi', () => ({
  windowApi: {
    setRetainMaterialOnUnfocus: vi.fn(() => Promise.resolve()),
  },
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
    getTheme.mockClear();
    getTheme.mockResolvedValue('light');
    onThemeChanged.mockClear();
    onFocusChanged.mockClear();
    applyWindowMaterial.mockClear();
    rebuildWindowMaterialForCompositor.mockClear();
    loadWindowMaterialCapabilities.mockClear();
    activeWindowMaterial.value = 'none';
    useThemeSettings().setResolvedSystemTheme('light');
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

  it('restores native system following and applies the resolved system theme', async () => {
    getTheme.mockResolvedValue('dark');
    const { isDarkTheme } = useThemeSettings();

    scope?.run(() => useAppThemeSync());
    await flushThemeSync();

    expect(setTheme).toHaveBeenCalledWith(null);
    expect(getTheme).toHaveBeenCalled();
    expect(isDarkTheme.value).toBe(true);
    expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
  });

  it('falls back to matchMedia when appWindow.theme() returns null', async () => {
    getTheme.mockResolvedValue(null);
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({
        matches: query.includes('dark'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
      }),
    });

    const { isDarkTheme } = useThemeSettings();

    scope?.run(() => useAppThemeSync());
    await flushThemeSync();

    expect(setTheme).toHaveBeenCalledWith(null);
    expect(isDarkTheme.value).toBe(true);
    expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
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
