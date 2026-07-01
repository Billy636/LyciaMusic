import { describe, expect, it } from 'vitest';

import source from './PlayerDetail.vue?raw';

describe('PlayerDetail close to tray', () => {
  it('updates rendering power state when hiding the main window', () => {
    expect(source).toContain('hideMainWindowToTray');
    expect(source).not.toContain('await appWindow.hide()');
  });
});
