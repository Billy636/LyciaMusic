import { describe, expect, it } from 'vitest';

import source from './TaskbarControlWindow.vue?raw';

describe('taskbar player main window toggle', () => {
  it('uses the cover to request the shared main window visibility action', () => {
    expect(source).toContain('title="显示/收起主窗口"');
    expect(source).toContain('@click.stop="sendAction(\'toggle-main-window\')"');
  });
});

describe('taskbar player lyrics', () => {
  it('renders a muted title above timed words and falls back when lyrics are unavailable', () => {
    expect(source).toContain('{{ songTitle }}');
    expect(source).toContain('v-if="currentLyric"');
    expect(source).toContain('getTaskbarLyricWordProgress(word, lyricTime)');
    expect(source).toContain('--word-progress');
    expect(source).toContain('{{ fallbackText }}');
  });

  it('keeps playback controls available on hover and keyboard focus without retaining mouse focus', () => {
    expect(source).toContain('.taskbar-player:hover .taskbar-controls');
    expect(source).toContain('.taskbar-player:focus-within .taskbar-controls');
    for (const action of ['prev-song', 'toggle-play', 'next-song']) {
      expect(source).toMatch(new RegExp(`@mousedown\\.prevent\\s+@click\\.stop="sendAction\\('${action}'\\)"`));
    }
  });

  it('uses a local clock only while visible and rejects playback ticks for another song', () => {
    expect(source).toContain('TASKBAR_PLAYER_PLAYBACK_EVENT');
    expect(source).toContain('payload.songPath !== (currentSong.value?.path ?? null)');
    expect(source).toContain('!isVisible.value || !isPlaying.value || document.hidden');
    expect(source).toContain("document.removeEventListener('visibilitychange', refreshLyricClock)");
    expect(source).not.toContain('useLyrics(');
  });
});
