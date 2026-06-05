import { describe, expect, it } from 'vitest';

import miniPlayerSource from './MiniPlayerWindow.vue?raw';
import trayMenuSource from './TrayMenuWindow.vue?raw';

describe('auxiliary transparent windows', () => {
  it('forces the mini player webview background to transparent', () => {
    expect(miniPlayerSource).toContain('setBackgroundColor([0, 0, 0, 0])');
  });

  it('forces the tray menu webview background to transparent', () => {
    expect(trayMenuSource).toContain('setBackgroundColor([0, 0, 0, 0])');
  });

  it('hides the tray menu when clicking the transparent shell outside menu panels', () => {
    expect(trayMenuSource).toContain('@pointerdown.self="hideWindow"');
  });
});
