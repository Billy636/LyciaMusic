import { describe, expect, it } from 'vitest';

import source from './AudioVisualizer.vue?raw';

describe('AudioVisualizer low power rendering', () => {
  it('does not fetch or animate samples while main window rendering is low power', () => {
    expect(source).toContain('useRenderingPower');
    expect(source).toContain('!isMainWindowLowPower.value');
    expect(source).toContain('props.active && props.isPlaying && !isMainWindowLowPower.value');
    expect(source).toContain('watch(() => [props.active, props.isPlaying, isMainWindowLowPower.value] as const');
  });
});
