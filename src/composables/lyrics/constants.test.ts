import { describe, expect, it } from 'vitest';

describe('lyrics font preset normalization', async () => {
  const { normalizeLyricsFontPreset } = await import('./constants');

  it('keeps custom system font names', () => {
    expect(normalizeLyricsFontPreset('Maple Mono NF CN')).toBe('Maple Mono NF CN');
  });

  it('falls back for blank values', () => {
    expect(normalizeLyricsFontPreset('   ')).toBe('system');
  });
});

describe('lyrics settings normalization', async () => {
  const {
    MAX_PLAYER_OFFSET_X,
    MIN_PLAYER_OFFSET_Y,
    normalizeDesktopLyricsSettingsPatch,
    normalizeLyricsSettingsPatch,
  } = await import('./constants');

  it('clamps player offsets for migrated player settings', () => {
    const normalized = normalizeLyricsSettingsPatch({
      playerOffsetX: 999,
      playerOffsetY: -999,
    });

    expect(normalized.playerOffsetX).toBe(MAX_PLAYER_OFFSET_X);
    expect(normalized.playerOffsetY).toBe(MIN_PLAYER_OFFSET_Y);
  });

  it('defaults desktop auto-hide on fullscreen to enabled', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.autoHideWhenFullscreen).toBe(true);
  });

  it('defaults desktop auto-hide on pause to disabled', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.autoHideWhenPaused).toBe(false);
  });

  it('defaults desktop double line display to disabled', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.showDoubleLine).toBe(false);
  });

  it('defaults desktop word effect to enabled', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.enableWordEffect).toBe(true);
  });

  it('restores desktop split-corner alignment from migrated settings', () => {
    expect(normalizeDesktopLyricsSettingsPatch({
      playerAlignment: 'split-corners',
    }).playerAlignment).toBe('split-corners');
  });

  it('keeps non-desktop lyric alignment limited to horizontal values', () => {
    const normalized = normalizeLyricsSettingsPatch({
      playerAlignment: 'split-corners' as any,
    });

    expect(normalized.playerAlignment).toBe('left');
  });

  it('restores desktop auto-hide on fullscreen from migrated values', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      autoHideWhenFullscreen: false,
    });

    expect(normalized.autoHideWhenFullscreen).toBe(false);
  });

  it('restores desktop auto-hide on pause from persisted values', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      autoHideWhenPaused: true,
    });

    expect(normalized.autoHideWhenPaused).toBe(true);
  });

  it('restores desktop double line display from migrated values', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      showDoubleLine: true,
    });

    expect(normalized.showDoubleLine).toBe(true);
  });

  it('restores desktop word effect from migrated values', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      enableWordEffect: false,
    });

    expect(normalized.enableWordEffect).toBe(false);
  });

  it('defaults desktop readability settings with independent disabled shadows', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({});

    expect(normalized.textOpacity).toBe(1);
    expect(normalized.textShadowColor).toBe('#000000');
    expect(normalized.firstLineTextShadowStrength).toBe(0);
    expect(normalized.secondLineTextShadowStrength).toBe(0);
    expect(normalized.textStrokeColor).toBe('#000000');
    expect(normalized.textStrokeDepth).toBe(0);
  });

  it('normalizes desktop readability settings from migrated values', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      textOpacity: 2,
      textShadowColor: 'not-a-color',
      firstLineTextShadowStrength: 180,
      secondLineTextShadowStrength: -20,
      textStrokeColor: '#123abc',
      textStrokeDepth: 180,
    } as any);

    expect(normalized.textOpacity).toBe(1);
    expect(normalized.textShadowColor).toBe('#000000');
    expect(normalized.firstLineTextShadowStrength).toBe(100);
    expect(normalized.secondLineTextShadowStrength).toBe(0);
    expect(normalized.textStrokeColor).toBe('#123ABC');
    expect(normalized.textStrokeDepth).toBe(100);
  });

  it('maps legacy desktop text shadow strength to both lyric lines', () => {
    const normalized = normalizeDesktopLyricsSettingsPatch({
      textShadowStrength: 45,
    } as any);

    expect(normalized.firstLineTextShadowStrength).toBe(45);
    expect(normalized.secondLineTextShadowStrength).toBe(45);
    expect(normalized.textStrokeDepth).toBe(0);
  });
});
