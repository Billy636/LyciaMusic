import { describe, expect, it } from 'vitest';

import source from './MainShell.vue?raw';

describe('MainShell heavy UI lifecycle', () => {
  it('mounts heavy overlays only while they are needed', () => {
    expect(source).toContain('<PlayerDetail v-if="isPlayerDetailMounted" />');
    expect(source).toContain('v-if="!isMiniMode && isPlayQueueMounted"');
    expect(source).toContain('v-if="!isMiniMode && showAddToPlaylistModal"');
    expect(source).toContain('v-if="!isMiniMode && isSongInfoVisible"');
  });

  it('keeps detail and queue instances alive until their leave animations finish', () => {
    expect(source).toContain('const PLAYER_DETAIL_LEAVE_MS = 650;');
    expect(source).toContain('const PLAY_QUEUE_LEAVE_MS = 300;');
    expect(source).toContain('watch(showPlayerDetail');
    expect(source).toContain('watch(showPlaylist');
  });

  it('prefetches the player detail chunk while idle without mounting it', () => {
    expect(source).toContain("typeof idleWindow.requestIdleCallback === 'function'");
    expect(source).toContain('void loadPlayerDetail();');
  });
});
