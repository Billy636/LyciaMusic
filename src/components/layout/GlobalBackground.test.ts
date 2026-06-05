import { describe, expect, it } from 'vitest';

import source from './GlobalBackground.vue?raw';

describe('GlobalBackground low power rendering', () => {
  it('freezes dynamic background work while main window rendering is low power', () => {
    expect(source).toContain('useRenderingPower');
    expect(source).toContain('showPlayerDetail.value || isMainWindowLowPower.value');
    expect(source).toContain('global-background--low-power');
    expect(source).toContain('animation-play-state: paused !important;');
  });
});
