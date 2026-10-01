import { Effect, getCurrentWindow, type Color } from '@tauri-apps/api/window';
import { ref } from 'vue';
import { windowApi, type WindowMaterialCapabilities as TauriWindowMaterialCapabilities } from '../services/tauri/windowApi';

export type WindowMaterialMode = 'none' | 'mica' | 'acrylic' | 'blur';
export type ResolvedWindowMaterial = 'none' | 'mica' | 'acrylic' | 'blur';

export interface WindowMaterialCapabilities {
  isWindows: boolean;
  supportsAcrylic: boolean;
  supportsMica: boolean;
  supportsBlur: boolean;
  systemTransparencyEnabled: boolean | null;
  windowsBuildNumber: number | null;
}

const defaultCapabilities = (): WindowMaterialCapabilities => ({
  isWindows: false,
  supportsAcrylic: false,
  supportsMica: false,
  supportsBlur: false,
  systemTransparencyEnabled: null,
  windowsBuildNumber: null,
});

const capabilities = ref<WindowMaterialCapabilities>(defaultCapabilities());
const activeWindowMaterial = ref<ResolvedWindowMaterial>('none');
const isWindowMaterialReady = ref(false);

let loadPromise: Promise<WindowMaterialCapabilities> | null = null;

const MICA_DARK_EFFECT = 'micaDark' as Effect;
const MICA_LIGHT_EFFECT = 'micaLight' as Effect;

function normalizeCapabilities(
  value: Partial<WindowMaterialCapabilities> | null | undefined,
): WindowMaterialCapabilities {
  return {
    ...defaultCapabilities(),
    ...value,
  };
}

export function resolveWindowMaterial(
  mode: WindowMaterialMode,
  value: WindowMaterialCapabilities = capabilities.value,
): ResolvedWindowMaterial {
  const isWindows11 = value.isWindows && value.windowsBuildNumber !== null && value.windowsBuildNumber >= 22000;

  if (value.systemTransparencyEnabled === false) {
    return 'none';
  }

  if (mode === 'mica') {
    return isWindows11 && value.supportsMica ? 'mica' : 'none';
  }

  if (mode === 'acrylic') {
    return isWindows11 && value.supportsAcrylic ? 'acrylic' : 'none';
  }

  if (mode === 'blur') {
    return value.isWindows && value.supportsBlur ? 'blur' : 'none';
  }

  return 'none';
}

function getAcrylicTint(isDark: boolean): Color {
  return isDark ? [18, 18, 18, 140] : [248, 248, 248, 125];
}

function normalizeTintValue(value = 50): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function getBlurTint(isDark: boolean, tintValue = 50): Color {
  const value = normalizeTintValue(tintValue);
  const alpha = isDark
    ? 50 + Math.round(value * 1.2)
    : 40 + value;
  return isDark ? [18, 18, 18, alpha] : [248, 248, 248, alpha];
}

function getBaseWindowColor(isDark: boolean): Color {
  return isDark ? [18, 18, 18, 255] : [250, 250, 250, 255];
}

function getTransparentWindowColor(): Color {
  return [0, 0, 0, 0];
}

function waitForCompositorFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise(resolve => setTimeout(resolve, 16));
  }

  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function trySetWindowBackgroundColor(color: Color): Promise<void> {
  const appWindow = getCurrentWindow();

  try {
    await appWindow.setBackgroundColor(color);
  } catch (error) {
    console.warn('Failed to set window background color:', error);
  }
}

async function trySetWindowShadow(enabled: boolean): Promise<void> {
  const appWindow = getCurrentWindow();

  try {
    if (appWindow.setShadow) {
      await appWindow.setShadow(enabled);
    }
  } catch (error) {
    console.warn('Failed to set window shadow:', error);
  }
}

export async function loadWindowMaterialCapabilities(force = false): Promise<WindowMaterialCapabilities> {
  if (isWindowMaterialReady.value && !force) {
    return capabilities.value;
  }

  if (loadPromise && !force) {
    return loadPromise;
  }

  loadPromise = windowApi.getWindowMaterialCapabilities()
    .then((result) => {
      const normalized = normalizeCapabilities(result as TauriWindowMaterialCapabilities);
      capabilities.value = normalized;
      isWindowMaterialReady.value = true;
      return normalized;
    })
    .catch((error) => {
      console.error('Failed to query window material capabilities:', error);
      const fallback = defaultCapabilities();
      capabilities.value = fallback;
      isWindowMaterialReady.value = true;
      return fallback;
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

export async function applyWindowMaterial(
  mode: WindowMaterialMode,
  isDark: boolean,
  blurTint = 50,
): Promise<ResolvedWindowMaterial> {
  const value = await loadWindowMaterialCapabilities();
  const resolved = resolveWindowMaterial(mode, value);
  const appWindow = getCurrentWindow();

  try {
    if (resolved === 'mica') {
      await trySetWindowBackgroundColor(getTransparentWindowColor());
      await appWindow.setEffects({
        effects: [isDark ? MICA_DARK_EFFECT : MICA_LIGHT_EFFECT],
      });
      await trySetWindowShadow(true);
    } else if (resolved === 'acrylic') {
      await trySetWindowBackgroundColor(getTransparentWindowColor());
      await windowApi.setDarkModeForWindow(isDark);
      await appWindow.setEffects({
        effects: [Effect.Acrylic],
        color: getAcrylicTint(isDark),
      });
      await trySetWindowShadow(true);
    } else if (resolved === 'blur') {
      await trySetWindowBackgroundColor(getTransparentWindowColor());
      await windowApi.setDarkModeForWindow(isDark);
      await appWindow.setEffects({
        effects: [Effect.Blur],
        color: getBlurTint(isDark, blurTint),
      });
      await trySetWindowShadow(false);
    } else {
      await appWindow.clearEffects();
      await trySetWindowBackgroundColor(getBaseWindowColor(isDark));
      await trySetWindowShadow(true);
    }

    activeWindowMaterial.value = resolved;
  } catch (error) {
    console.error('Failed to apply window material:', error);
    activeWindowMaterial.value = 'none';
  }

  return activeWindowMaterial.value;
}

interface RebuildWindowMaterialDeps {
  clearEffects: () => Promise<unknown>;
  waitForRepaint: () => Promise<unknown>;
  applyMaterial: (mode: WindowMaterialMode, isDark: boolean, blurTint: number) => Promise<ResolvedWindowMaterial>;
}

export async function rebuildWindowMaterialForCompositor(
  mode: WindowMaterialMode,
  isDark: boolean,
  blurTint = 50,
  deps?: Partial<RebuildWindowMaterialDeps>,
): Promise<ResolvedWindowMaterial> {
  const clearEffects = deps?.clearEffects ?? (() => getCurrentWindow().clearEffects());
  const waitForRepaint = deps?.waitForRepaint ?? waitForCompositorFrame;
  const applyMaterial = deps?.applyMaterial ?? applyWindowMaterial;

  if (mode === 'none') {
    return applyMaterial(mode, isDark, blurTint);
  }

  try {
    await clearEffects();
    activeWindowMaterial.value = 'none';
    await waitForRepaint();
  } catch (error) {
    console.warn('Failed to rebuild window material compositor:', error);
  }

  return applyMaterial(mode, isDark, blurTint);
}

export function useWindowMaterial() {
  return {
    capabilities,
    activeWindowMaterial,
    isWindowMaterialReady,
    loadWindowMaterialCapabilities,
    applyWindowMaterial,
    rebuildWindowMaterialForCompositor,
  };
}
