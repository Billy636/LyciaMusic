import { describe, expect, it } from 'vitest';

import footerSource from './PlayerFooter.vue?raw';
import source from './MainShell.vue?raw';
import detailSource from '../player/PlayerDetail.vue?raw';

describe('MainShell heavy UI lifecycle', () => {
  it('keeps the player detail mounted because it owns the animated footer cover', () => {
    expect(source).toContain('<PlayerDetail />');
    expect(source).not.toContain('<PlayerDetail v-if=');
    expect(footerSource).toContain('data-footer-cover');
    expect(detailSource).toContain('<PlayerDetailLeft :isExpanded="showPlayerDetail" />');
  });

  it('mounts the remaining heavy overlays only while they are needed', () => {
    expect(source).toContain('v-if="!isMiniMode && isPlayQueueMounted"');
    expect(source).toContain('v-if="!isMiniMode && showAddToPlaylistModal"');
    expect(source).toContain('v-if="!isMiniMode && isSongInfoVisible"');
  });

  it('keeps the queue instance alive until its leave animation finishes', () => {
    expect(source).toContain('const PLAY_QUEUE_LEAVE_MS = 300;');
    expect(source).toContain('watch(showPlaylist');
  });
});
