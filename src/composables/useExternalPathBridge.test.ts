import { describe, expect, it, vi } from 'vitest';

import { showMainWindowAfterStartup } from './useExternalPathBridge';

describe('startup window reveal', () => {
  it('waits for theme material sync before showing and refreshes material after focus', async () => {
    const calls: string[] = [];
    const appWindow = {
      show: vi.fn(async () => {
        calls.push('show');
      }),
      setFocus: vi.fn(async () => {
        calls.push('focus');
      }),
    };

    await showMainWindowAfterStartup(appWindow, {
      beforeShow: async () => {
        calls.push('before');
      },
      afterShow: async () => {
        calls.push('after');
      },
    });

    expect(calls).toEqual(['before', 'show', 'focus', 'after']);
  });
});
