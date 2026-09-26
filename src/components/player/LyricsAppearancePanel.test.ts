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

  it('has a persistent shared header and close button above independently scrollable controls', () => {
    expect(source).toContain('class="player-side-panel__header"');
    expect(source).toContain('class="player-side-panel__title">歌词样式</h3>');
    expect(source).toContain('aria-label="关闭歌词样式"');
    expect(source).toContain('@click="showLyricsPlayerSettingsPanel = false"');
    expect(source).toContain('class="player-side-panel__scroll px-4 py-4"');
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

  it('keeps system/custom font menus separate with truncated names and delete actions', () => {
    expect(source).toContain("toggleFontPresetMenu('system')");
    expect(source).toContain("toggleFontPresetMenu('custom')");
    expect(source).toContain("fontPresetMenuMode === 'system'");
    expect(source).toContain("fontPresetMenuMode === 'custom'");
    expect(source).toContain('v-for="option in systemFontOptions"');
    expect(source).toContain('v-for="option in customFontOptions"');
    expect(source).toContain('min-w-0 flex-1 truncate');
    expect(source).toContain(':title="option.label"');
    expect(source).toContain('<Teleport to="body">');
  });

  it('owns all appearance controls and emits local preview updates', () => {
    expect(source).toContain('useLyricsAppearanceDraft(');
    expect(source).toContain("(preview) => emit('preview', preview)");
    expect(source).toContain('@change="commitDraftLyricsSettings"');
    expect(source).toContain('PLAYER_RENDER_MODE_OPTIONS');
    expect(source).toContain('PLAYER_ALIGNMENT_OPTIONS');
    expect(source).toContain('handleFontScaleInput');
    expect(source).toContain('handleLineGapInput');
    expect(source).toContain('handleOffsetXInput');
    expect(source).toContain('handleOffsetYInput');
    expect(source).toContain('toggleTranslation');
    expect(source).toContain('toggleRomaji');
    expect(source).not.toContain('playAt(');
  });

  it('places reading order after lyric offsets and before the font controls', () => {
    const controlPosition = source.indexOf('<LyricsReadingOrderControl ');
    expect(controlPosition).toBeGreaterThan(source.indexOf('>歌词偏移</span>'));
    expect(controlPosition).toBeGreaterThan(source.lastIndexOf('@input="handleOffsetYInput"'));
    expect(controlPosition).toBeLessThan(source.indexOf('>Font</div>'));
    expect(source).toContain('<LyricsReadingOrderControl @open="closeFontPresetMenu" />');
  });

  it('closes floating menus, commits drafts, and removes listeners on unmount', () => {
    expect(source).toContain('watch(showLyricsPlayerSettingsPanel');
    expect(source).toContain('fontPresetMenuRef.value?.contains(target)');
    expect(source).not.toContain('watch(() => props.available');
    expect(source).toContain('onUnmounted(() => {\n  commitDraftLyricsSettings();');
    expect(source).toContain("window.removeEventListener('mousedown', handleClickOutside)");
    expect(source).toContain("window.removeEventListener('resize', updateFontPresetMenuPosition)");
    expect(source).toContain("window.removeEventListener('keydown', handlePanelKeydown)");
  });

  it('protects teleported controls from playback shortcuts and hides them with their owning view', () => {
    expect(source.match(/data-shortcut-capture="true"/g)).toHaveLength(2);
    expect(source).toContain("event.defaultPrevented || event.key !== 'Escape'");
    expect(source).toContain('trigger?.focus()');
    expect(source).toContain('watch(showPlayerDetail,');
    expect(source).toMatch(/watch\(showPlayerDetail,\s*\(?(\w+)\)?\s*=>\s*\{[^}]*?if\s*\(!\1\)\s*showLyricsPlayerSettingsPanel\.value\s*=\s*false/);
    expect(source).not.toContain('watch([showPlayerDetail, showQueue]');
    expect(source).toContain("{ flush: 'sync' }");
    expect(source).toContain('const panel = fontPanelRef.value');
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
