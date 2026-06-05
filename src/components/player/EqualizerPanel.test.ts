import { describe, expect, it } from 'vitest';

import source from './EqualizerPanel.vue?raw';

describe('EqualizerPanel slider rendering', () => {
  it('drives slider values and fill bars from immediate draft values while dragging', () => {
    expect(source).toContain('displayPreamp');
    expect(source).toContain('displayGains');
    expect(source).toContain(':value="displayPreamp"');
    expect(source).toContain('height: displayPreamp >= 0');
    expect(source).toContain('v-for="(gain, index) in displayGains"');
    expect(source).toContain('height: gain >= 0');
  });

  it('does not animate fill bars independently from the native range thumb', () => {
    expect(source).not.toContain('pointer-events-none transition-all duration-100');
  });
});
