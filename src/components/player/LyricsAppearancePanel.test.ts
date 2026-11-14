import { compileTemplate, parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';

import source from './LyricsAppearancePanel.vue?raw';

describe('LyricsAppearancePanel', () => {
  it('uses a body-anchored left drawer instead of positioning against the lyric column', () => {
    expect(source).toContain('class="player-side-panel player-side-panel--left pointer-events-auto"');
    expect(source).toContain("import './playerSidePanel.css'");
    expect(source).toContain('<transition name="player-side-panel">');
    expect(source).toContain('v-if="showPlayerDetail && showLyricsPlayerSettingsPanel"');
    expect(source.indexOf('<Teleport to="body">')).toBeLessThan(source.indexOf('<aside'));
    expect(source).not.toContain('--shift-vw');
    expect(source).not.toContain('lyric-style-panel');
    expect(source).not.toContain('name="font-panel"');
  });

  it('can open without playing lyrics, including loading, empty, error, and queue views', () => {
    const drawer = source.match(/<aside\b[\s\S]*?>/)?.[0] ?? '';
    expect(drawer).toContain('v-if="showPlayerDetail && showLyricsPlayerSettingsPanel"');
    expect(drawer).not.toMatch(/isPlaying|parsedLyrics|lyricsStatus|hasLyricsPresentation|available|showQueue/);
    expect(source).not.toContain('available: boolean');
    expect(source).not.toContain('props.available');
    expect(source).not.toContain('showQueue');
  });

  it('shares imported font registration and removal with desktop lyrics', () => {
    expect(source).toContain('customLyricsFonts: [importedFont, ...remainingFonts]');
    expect(source).toContain('lyrics: { playerFontPreset: importedFont.family }');
    expect(source).toContain('desktopLyrics: { playerFontPreset: importedFont.family }');
    expect(source).toContain('desktopLyrics: { playerFontPreset: DEFAULT_PLAYER_FONT_PRESET }');
    expect(source).toContain('removeCustomLyricsFont(option.value)');
    expect(source).toContain('Trash2');
    expect(source).toContain('@click.stop');
  });

  it('compiles the panel and teleported font menu after extraction', () => {
    const { descriptor } = parse(source);
    const result = compileTemplate({
      source: descriptor.template!.content,
      filename: 'LyricsAppearancePanel.vue',
      id: 'lyrics-appearance-panel',
    });
    expect(result.errors).toEqual([]);
  });
});
