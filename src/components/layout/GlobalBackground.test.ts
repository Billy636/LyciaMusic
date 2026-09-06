import { describe, expect, it } from 'vitest';

import source from './GlobalBackground.vue?raw';

describe('GlobalBackground low power rendering', () => {
  it('freezes dynamic background work while main window rendering is low power', () => {
    expect(source).toContain('useRenderingPower');
    expect(source).toContain('showPlayerDetail.value || isMainWindowLowPower.value');
    expect(source).toContain('global-background--low-power');
    expect(source).toContain('animation-play-state: paused !important;');
  });

  it('uses a fixed medium static blur preset', () => {
    expect(source).toContain('blur: 24');
    expect(source).toContain('opacity: 0.75');
  });

  it('uses a fixed flow preset and one cached bitmap texture without continuous animation', () => {
    expect(source).toContain('FIXED_FLOW_PRESET.colorBoost');
    expect(source).toContain('class="flow-accent-texture absolute"');
    expect(source).toContain('createFlowTexture');
    expect(source).toContain("canvas.toDataURL('image/webp', 0.82)");
    expect(source).toContain('dynamicBlobStyle');
    expect(source).toContain('radial-gradient');
    expect(source).toContain('width: 68%;');
    expect(source).toContain('height: 68%;');
    expect(source).not.toContain('@keyframes flow-drift');
    expect(source).not.toContain('setInterval(updateFlowDriftTransform');
    expect(source).not.toContain('flow-blob-field');
    expect(source).not.toContain('filter: blur(60px);');
    expect(source).not.toContain('mix-blend');
    expect(source).not.toContain('animate-mesh-1');
    expect(source).not.toContain('@keyframes mesh-1');
    expect(source).not.toContain('will-change: opacity, transform, filter;');
    expect(source).not.toContain('filter: blur(16px);');
  });

  it('only resets customMediaReady when displayPath or mediaType changes', () => {
    expect(source).toContain('const isPathChanged =');
    expect(source).toContain('if (isPathChanged) {');
    expect(source).toContain('customMediaReady.value = false;');
  });
});
