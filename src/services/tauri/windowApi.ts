import { tauriInvoke } from './invoke';
import type { ForegroundFullscreenState, ImmersiveFullscreenState, WindowMaterialCapabilities } from './contracts';
export type { ForegroundFullscreenState, ImmersiveFullscreenState, WindowMaterialCapabilities } from './contracts';

export const windowApi = {
  setRetainMaterialOnUnfocus: (enabled: boolean) =>
    tauriInvoke('set_retain_material_on_unfocus', { enabled }),
  setDarkModeForWindow: (dark: boolean) =>
    tauriInvoke('set_dark_mode_for_window', { dark }),
  getWindowMaterialCapabilities: () =>
    tauriInvoke('get_window_material_capabilities') as Promise<WindowMaterialCapabilities>,
  applyTransparentWindow: () =>
    tauriInvoke('apply_transparent_window'),
  getForegroundFullscreenState: () =>
    tauriInvoke('get_foreground_fullscreen_state') as Promise<ForegroundFullscreenState>,
  setImmersiveFullscreen: (fullscreen: boolean, restoreMaximized: boolean) =>
    tauriInvoke('set_immersive_fullscreen', {
      fullscreen,
      restoreMaximized,
    }) as Promise<ImmersiveFullscreenState>,
  refreshCurrentWindowTopmost: (enabled: boolean) =>
    tauriInvoke('refresh_current_window_topmost', { enabled }),
  startTopmostGuard: () =>
    tauriInvoke('start_topmost_guard'),
  stopTopmostGuard: () =>
    tauriInvoke('stop_topmost_guard'),
};
