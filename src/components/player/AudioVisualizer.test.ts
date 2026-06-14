import { describe, expect, it } from 'vitest';

import source from './AudioVisualizer.vue?raw';

describe('AudioVisualizer low power rendering', () => {
  it('does not fetch or animate samples while main window rendering is low power', () => {
    expect(source).toContain('useRenderingPower');
    expect(source).toContain('!isMainWindowLowPower.value');
    expect(source).toContain('props.active && props.isPlaying && !isMainWindowLowPower.value');
    expect(source).toContain('watch(() => [props.active, props.isPlaying, isMainWindowLowPower.value] as const');
  });

  it('keeps visualizer sampling explicitly capped at 30 FPS and tied to visibility', () => {
    expect(source).toContain('const VISUALIZER_TARGET_FPS = 30;');
    expect(source).toContain('const FETCH_INTERVAL_MS = Math.round(1000 / VISUALIZER_TARGET_FPS);');
    expect(source).toContain('const shouldFetchSamples = () => props.active && props.isPlaying && !isMainWindowLowPower.value;');
  });
});
