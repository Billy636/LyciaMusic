import { describe, expect, it } from 'vitest';

import mainSource from './main.ts?raw';
import miniPlayerSource from './components/layout/MiniPlayerWindow.vue?raw';
import taskbarSource from './components/layout/TaskbarControlWindow.vue?raw';
import desktopRootSource from './components/window/DesktopLyricsWindowRoot.vue?raw';
import mainRootSource from './components/window/MainWindowRoot.vue?raw';
import bootstrapSource from './windowBootstrap.ts?raw';
import { resolveWindowKind, windowUsesPinia, windowUsesRouter } from './windowBootstrap';

describe('window bootstrap isolation', () => {
  it('resolves every known auxiliary label without falling back to the main window', () => {
    expect(resolveWindowKind('main')).toBe('main');
    expect(resolveWindowKind('desktop-lyrics')).toBe('desktop-lyrics');
    expect(resolveWindowKind('mini-player')).toBe('mini-player');
    expect(resolveWindowKind('tray-menu')).toBe('tray-menu');
    expect(resolveWindowKind('taskbar-player')).toBe('taskbar-player');
    expect(resolveWindowKind('unknown-window')).toBe('main');
  });

  it('installs router and Pinia only in windows that use them', () => {
    expect(windowUsesRouter('main')).toBe(true);
    expect(windowUsesRouter('mini-player')).toBe(false);
    expect(windowUsesRouter('tray-menu')).toBe(false);
    expect(windowUsesRouter('taskbar-player')).toBe(false);

    expect(windowUsesPinia('main')).toBe(true);
    expect(windowUsesPinia('desktop-lyrics')).toBe(true);
    expect(windowUsesPinia('mini-player')).toBe(false);
    expect(windowUsesPinia('tray-menu')).toBe(false);
    expect(windowUsesPinia('taskbar-player')).toBe(false);
  });

  it('loads window roots through literal dynamic imports', () => {
    expect(bootstrapSource).toContain("main: () => import('./components/window/MainWindowRoot.vue')");
    expect(bootstrapSource).toContain("'desktop-lyrics': () => import('./components/window/DesktopLyricsWindowRoot.vue')");
    expect(bootstrapSource).toContain("'mini-player': () => import('./components/layout/MiniPlayerWindow.vue')");
    expect(bootstrapSource).toContain("'tray-menu': () => import('./components/layout/TrayMenuWindow.vue')");
    expect(bootstrapSource).toContain("'taskbar-player': () => import('./components/layout/TaskbarControlWindow.vue')");
  });

  it('does not statically import router, Pinia, AMLL styles, or the old aggregate App root', () => {
    expect(mainSource).not.toContain("import router from './router'");
    expect(mainSource).not.toContain("import { createPinia } from 'pinia'");
    expect(mainSource).not.toContain("import '@applemusic-like-lyrics/core/style.css'");
    expect(mainSource).not.toContain("import App from './App.vue'");
    expect(mainSource).toContain("windowUsesRouter(windowKind) ? import('./router')");
    expect(mainSource).toContain("windowUsesPinia(windowKind) ? import('pinia')");
  });

  it('keeps imported lyrics fonts registered in both lyrics-capable windows', () => {
    expect(mainRootSource).toContain('useImportedLyricsFonts();');
    expect(desktopRootSource).toContain('useImportedLyricsFonts();');
    expect(mainRootSource).toContain("import '@applemusic-like-lyrics/core/style.css';");
    expect(desktopRootSource).not.toContain("import '@applemusic-like-lyrics/core/style.css';");
  });

  it('keeps taskbar-only code detached from the main taskbar bridge', () => {
    expect(taskbarSource).toContain('writeSavedTaskbarPositionX');
    expect(taskbarSource).not.toContain("from '../../composables/useTaskbarPlayerBridge'");
  });

  it('keeps mini-player volume math detached from the main UI shell stores', () => {
    expect(miniPlayerSource).toContain("from '../../utils/volume'");
    expect(miniPlayerSource).not.toContain("from '../../composables/playerUiShell'");
  });
});
