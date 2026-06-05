import { describe, expect, it } from 'vitest';

import source from './SongInfoModal.vue?raw';

describe('SongInfoModal window drag area', () => {
  it('keeps a Tauri drag region available above the dialog panels', () => {
    expect(source).toContain('song-info-window-drag-strip');
    expect(source).toContain('data-tauri-drag-region');
  });
});

describe('SongInfoModal text selection', () => {
  it('opts the song information page back into browser text selection', () => {
    expect(source).toContain('.song-info-stage {');
    expect(source).toContain('-webkit-user-select: text;');
    expect(source).toContain('user-select: text;');
  });
});

describe('SongInfoModal lyrics editor theme', () => {
  it('defines dark surface tokens for the lyrics editor panel', () => {
    expect(source).toContain('--lyrics-editor-panel-bg: rgba(255, 255, 255, 0.82);');
    expect(source).toContain("isDarkTheme ? 'song-info-stage--dark' : ''");
    expect(source).toContain('.song-info-stage--dark');
    expect(source).toContain('--lyrics-editor-panel-bg: rgba(15, 23, 42, 0.92);');
    expect(source).toContain('--modal-external-header-bg: rgba(15, 23, 42, 0.72);');
    expect(source).toContain('--lyrics-editor-button-bg: rgba(255, 255, 255, 0.06);');
  });

  it('keeps dark editor selectors local to the modal instead of compiling to global .dark rules', () => {
    expect(source).not.toContain(':global(.dark) .song-info-stage');
    expect(source).not.toContain(':global(.dark) .lyrics-editor-expand-button');
    expect(source).not.toContain(':global(.dark) .modal-action-button');
  });
});

describe('SongInfoModal responsive layout', () => {
  it('lets the song info body keep its content height when the modal stacks on narrow windows', () => {
    const narrowWindowStyles = source.slice(source.indexOf('@media (max-width: 1100px)'));

    expect(narrowWindowStyles).toContain('.song-info-main {');
    expect(narrowWindowStyles).toContain('flex: 0 0 auto;');
    expect(narrowWindowStyles).toContain('.song-info-content {');
    expect(narrowWindowStyles).toContain('overflow: visible;');
  });
});
