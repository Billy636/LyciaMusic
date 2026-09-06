import { describe, expect, it } from 'vitest';

import source from './TaskbarControlWindow.vue?raw';

describe('taskbar player main window toggle', () => {
  it('uses the cover to request the shared main window visibility action', () => {
    expect(source).toContain('title="显示/收起主窗口"');
    expect(source).toContain('@click.stop="sendAction(\'toggle-main-window\')"');
  });
});
