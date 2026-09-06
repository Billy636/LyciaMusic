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
    expect(source).toContain('timestamp - lastDrawTimestamp < DRAW_INTERVAL_MS - 1');
    expect(source).toContain('fetchInFlight');
  });

  it('enables backend sampling only while the visualizer is actually active', () => {
    expect(source).toContain('playbackApi.setAudioVisualizerEnabled(enabled)');
    expect(source).toContain('playbackApi.setAudioVisualizerEnabled(false)');
    expect(source).toContain('syncBackendVisualizer();');
  });

  it('reuses fixed level buffers, canvas size, and quantized gradients', () => {
    expect(source).toContain('new Float32Array(BAR_COUNT)');
    expect(source).toContain('new Float32Array(DISPLAY_BAR_COUNT)');
    expect(source).toContain('const gradientCache = new Map<string, CanvasGradient>();');
    expect(source).toContain('resizeObserver = new ResizeObserver(() => {');
    expect(source).toContain('context.fillStyle = getBarGradient');
  });
});
