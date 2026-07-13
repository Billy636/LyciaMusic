import { describe, expect, it } from 'vitest';

import source from './PlayerDetail.vue?raw';

describe('PlayerDetail hidden runtime boundaries', () => {
  it('keeps the lyrics view reliable while unmounting it with the closed detail page', () => {
    expect(source).toContain("import LyricsView from './LyricsView.vue'");
    expect(source).not.toContain("defineAsyncComponent(() => import('./LyricsView.vue'))");
    expect(source).toContain('v-else-if="showPlayerDetail && parsedLyrics.length > 0"');
  });

  it('uses the native immersive transition instead of fullscreening a maximized window directly', () => {
    expect(source).toContain('windowApi.setImmersiveFullscreen(');
    expect(source).not.toContain('appWindow.setFullscreen(');
    expect(source).toContain('await exitImmersiveFullscreen();');
  });
});
