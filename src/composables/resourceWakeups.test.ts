import { describe, expect, it } from 'vitest';

import lifecycleSource from './playerLifecycle.ts?raw';
import taskbarSource from './useTaskbarPlayerBridge.ts?raw';

describe('background resource wakeups', () => {
  it('keeps fullscreen response fast while reducing taskbar geometry polling', () => {
    expect(taskbarSource).toContain('TASKBAR_FULLSCREEN_CHECK_INTERVAL_MS = 1_000');
    expect(taskbarSource).toContain('TASKBAR_GEOMETRY_FALLBACK_INTERVAL_MS = 10_000');
    expect(taskbarSource).toContain('Date.now() - lastGeometryFallbackAt');
  });

  it('persists playback less often and flushes on user-visible lifecycle boundaries', () => {
    expect(lifecycleSource).toContain('setInterval(persistCurrentPlaybackTime, 5000)');
    expect(lifecycleSource).toContain("watch(currentSongPath, () => {");
    expect(lifecycleSource).toContain("document.visibilityState === 'hidden'");
    expect(lifecycleSource).toContain("watch(isPlaying, playing => {");
    expect(lifecycleSource).toContain("window.addEventListener('beforeunload', beforeUnloadHandler)");
  });
});
