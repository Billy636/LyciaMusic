import { describe, expect, it } from 'vitest';

import source from './LyricsView.vue?raw';

describe('LyricsView custom font import', () => {
  it('applies an imported font in the same settings patch that stores it', () => {
    expect(source).toContain('lyrics: { playerFontPreset: importedFont.family }');
    expect(source).toContain('desktopLyrics: { playerFontPreset: importedFont.family }');
  });

  it('renders separate top-level triggers for system and custom font presets', () => {
    expect(source).toContain('systemFontOptions');
    expect(source).toContain('customFontOptions');
    expect(source).toContain('systemFontPresetTriggerRef');
    expect(source).toContain('customFontPresetTriggerRef');
    expect(source).toContain('toggleFontPresetMenu(\'system\')');
    expect(source).toContain('toggleFontPresetMenu(\'custom\')');
  });

  it('keeps system and custom font lists in their own menus', () => {
    expect(source).toContain('fontPresetMenuMode === \'system\'');
    expect(source).toContain('fontPresetMenuMode === \'custom\'');
    expect(source).toContain('v-for="option in systemFontOptions"');
    expect(source).toContain('v-for="option in customFontOptions"');
  });

  it('uses a shrinking label container so long font names do not cover trailing actions', () => {
    expect(source).toContain('min-w-0 flex-1');
    expect(source).toContain('truncate');
    expect(source).toContain(':title="option.label"');
  });

  it('uses a delete icon for custom font removal without selecting the row', () => {
    expect(source).toContain('Trash2');
    expect(source).toContain('removeCustomLyricsFont(option.value)');
    expect(source).toContain('@click.stop');
  });

  it('rebuilds the lyrics layout after imported fonts finish registering', () => {
    expect(source).toContain('importedLyricsFontsRevision');
    expect(source).toContain('lyricsLayoutVersion');
    expect(source).toContain(':layout-version="lyricsLayoutVersion"');
  });

  it('passes playback state into AMLL so word highlighting pauses with audio', () => {
    expect(source).toContain('isPlaying } = usePlayer();');
    expect(source).toContain(':playing="isPlaying"');
  });

  it('passes low power rendering state to AMLL without removing the feature', () => {
    expect(source).toContain('useRenderingPower');
    expect(source).toContain('const shouldReduceLyricsRendering');
    expect(source).toContain(':low-power="shouldReduceLyricsRendering"');
  });

  it('offers AMLL and light lyrics render modes at the top of the style panel', () => {
    expect(source).toContain('PLAYER_RENDER_MODE_OPTIONS');
    expect(source).toContain('AMLL');
    expect(source).toContain('轻量');
    expect(source).toContain('setPlayerRenderMode');
  });

  it('switches the player lyrics renderer based on the persisted render mode', () => {
    expect(source).toContain('LightLyricPlayer');
    expect(source).toContain('lyricsSettings.playerRenderMode === \'amll\'');
    expect(source).toContain('lyricsSettings.playerRenderMode === \'light\'');
  });
  it('previews high-frequency slider changes locally before persisting lyrics settings', () => {
    expect(source).toContain('previewPlayerFontScale');
    expect(source).toContain('previewPlayerLineGap');
    expect(source).toContain('scheduleLyricsSettingsCommit');
    expect(source).toContain('@change="commitDraftLyricsSettings"');
    expect(source).toContain(':line-gap="previewPlayerLineGap"');
  });

  it('starts playback from the clicked lyric line instead of only seeking while paused', () => {
    expect(source).toContain('const { playAt, currentTime, isPlaying } = usePlayer();');
    expect(source).toContain('await playAt(targetSeconds);');
    expect(source).not.toContain('await seekTo(targetSeconds);');
  });
});
