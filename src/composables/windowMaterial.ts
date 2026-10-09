import { Effect, getCurrentWindow, type Color } from '@tauri-apps/api/window';
import { ref } from 'vue';
import { windowApi, type WindowMaterialCapabilities as TauriWindowMaterialCapabilities } from '../services/tauri/windowApi';

export type WindowMaterialMode = 'none' | 'mica' | 'acrylic' | 'blur' | 'transparent';
export type ResolvedWindowMaterial = WindowMaterialMode;

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
let materialOperation: Promise<unknown> = Promise.resolve();

// Supported by Tauri's Rust WindowEffect enum, but missing from its JS enum.
const MICA_DARK_EFFECT = 'micaDark' as Effect;
const MICA_LIGHT_EFFECT = 'micaLight' as Effect;

function enqueueMaterialOperation<T>(operation: () => Promise<T>): Promise<T> {
  const pending = materialOperation.then(operation, operation);
  materialOperation = pending.then(() => undefined, () => undefined);
  return pending;
}

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

  if (mode === 'transparent') {
    return value.isWindows ? 'transparent' : 'none';
  }

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
  // Keep the legacy midpoint and upper range, but remove the tint floor
  // below 50 so the lowest setting does not keep a dark native mask.
  const alpha = isDark
    ? value < 50 ? Math.round(value * 2.2) : 50 + Math.round(value * 1.2)
    : value < 50 ? Math.round(value * 1.8) : 40 + value;
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
    const finish = () => {
      clearTimeout(timeout);
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame);
      }
      resolve();
    };
    // Hidden/minimized WebViews may suspend animation frames. Do not let a
    // compositor rebuild block every later material operation indefinitely.
    const timeout = setTimeout(finish, 100);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(finish);
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
  if (loadPromise) {
    return loadPromise;
  }

  if (isWindowMaterialReady.value && !force) {
    return capabilities.value;
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

async function applyWindowMaterialNow(
  mode: WindowMaterialMode,
  isDark: boolean,
  blurTint = 50,
): Promise<ResolvedWindowMaterial> {
  const value = await loadWindowMaterialCapabilities();
  const resolved = resolveWindowMaterial(mode, value);
  const appWindow = getCurrentWindow();

  try {
    // Clear an existing material when switching native APIs. A plain window
    // has no effect to clear, and compositor rebuilds already clear once.
    // Keep the legacy direct apply path for startup and rebuilding Blur.
    if (
      activeWindowMaterial.value !== 'none'
      && resolved !== 'none'
      && resolved !== 'transparent'
      && resolved !== activeWindowMaterial.value
    ) {
      await appWindow.clearEffects();
    }

    if (resolved === 'mica') {
      await trySetWindowBackgroundColor(getTransparentWindowColor());
      await trySetWindowShadow(true);
      await appWindow.setEffects({
        effects: [isDark ? MICA_DARK_EFFECT : MICA_LIGHT_EFFECT],
      });
    } else if (resolved === 'acrylic') {
      await trySetWindowBackgroundColor(getTransparentWindowColor());
      await windowApi.setDarkModeForWindow(isDark);
      await trySetWindowShadow(true);
      await appWindow.setEffects({
        effects: [Effect.Acrylic],
        color: getAcrylicTint(isDark),
      });
    } else if (resolved === 'blur') {
      await trySetWindowBackgroundColor(getTransparentWindowColor());
      await windowApi.setDarkModeForWindow(isDark);
      await appWindow.setEffects({
        effects: [Effect.Blur],
        color: getBlurTint(isDark, blurTint),
      });
      await trySetWindowShadow(false);
    } else if (resolved === 'transparent') {
      await appWindow.clearEffects();
      await trySetWindowShadow(false);
      await windowApi.applyTransparentWindow();
    } else {
      await appWindow.clearEffects();
      await trySetWindowBackgroundColor(getBaseWindowColor(isDark));
      await trySetWindowShadow(true);
    }

    activeWindowMaterial.value = resolved;
  } catch (error) {
    console.error('Failed to apply window material:', error);
    try {
      await appWindow.clearEffects();
    } catch (clearError) {
      console.warn('Failed to clear window material after an error:', clearError);
    }
    await trySetWindowBackgroundColor(getBaseWindowColor(isDark));
    await trySetWindowShadow(true);
    activeWindowMaterial.value = 'none';
  }

  return activeWindowMaterial.value;
}

export function applyWindowMaterial(
  mode: WindowMaterialMode,
  isDark: boolean,
  blurTint = 50,
): Promise<ResolvedWindowMaterial> {
  return enqueueMaterialOperation(() => applyWindowMaterialNow(mode, isDark, blurTint));
}

interface RebuildWindowMaterialDeps {
  clearEffects: () => Promise<unknown>;
  waitForRepaint: () => Promise<unknown>;
  applyMaterial: (mode: WindowMaterialMode, isDark: boolean, blurTint: number) => Promise<ResolvedWindowMaterial>;
}

export function rebuildWindowMaterialForCompositor(
  mode: WindowMaterialMode,
  isDark: boolean,
  blurTint = 50,
  deps?: Partial<RebuildWindowMaterialDeps>,
): Promise<ResolvedWindowMaterial> {
  return enqueueMaterialOperation(async () => {
    const clearEffects = deps?.clearEffects ?? (() => getCurrentWindow().clearEffects());
    const waitForRepaint = deps?.waitForRepaint ?? waitForCompositorFrame;
    const applyMaterial = deps?.applyMaterial ?? applyWindowMaterialNow;

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
  });
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
