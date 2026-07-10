import { describe, expect, it } from 'vitest';

import source from './PlayerDetail.vue?raw';

describe('PlayerDetail hidden runtime boundaries', () => {
  it('unmounts the lyrics view while the detail page is closed', () => {
    expect(source).toContain('v-else-if="showPlayerDetail && parsedLyrics.length > 0"');
  });

  it('uses the native immersive transition instead of fullscreening a maximized window directly', () => {
    expect(source).toContain('windowApi.setImmersiveFullscreen(');
    expect(source).not.toContain('appWindow.setFullscreen(');
    expect(source).toContain('await exitImmersiveFullscreen();');
  });
});
