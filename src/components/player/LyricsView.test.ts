import { compileTemplate, parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
import { readFileSync } from 'node:fs';

import source from './LyricsView.vue?raw';

const officialStyles = readFileSync(
  new URL('../../../node_modules/@applemusic-like-lyrics/core/dist/style.css', import.meta.url),
  'utf8',
);

describe('LyricsView official AMLL integration', () => {
  it('receives optional appearance previews from its parent without owning the settings panel', () => {
    expect(source).not.toContain('LyricsAppearancePanel');
    expect(source).not.toContain('@preview=');
    expect(source).toMatch(/appearancePreview\?:\s*LyricsAppearanceDraft/);
    expect(source).toMatch(/props\.appearancePreview\s*\?\?\s*readLyricsAppearanceDraft\(lyricsSettings\)/);
    expect(source).not.toContain('const appearancePreview = ref(');
    expect(source).not.toContain('importCustomLyricsFont');
    expect(source).not.toContain('fontPresetMenu');
    expect(source).not.toContain('commitDraftLyricsSettings');
    expect(source).not.toContain('<Teleport');
  });

  it('uses native lines for every format without a second legacy conversion', () => {
    expect(source).toContain('useAmlDisplayLines(nativeAmlLyrics, () => lyricsSettings)');
    expect(source).not.toContain('selectAmlLyricLines');
    expect(source).not.toContain('convertLyricsToAmlLines');
    expect(source).not.toContain('activeLyricsFormat');
  });

  it('keeps AMLL and light render modes wired to the same appearance preview', () => {
    expect(source).toContain("lyricsSettings.playerRenderMode === 'amll'");
    expect(source).toContain("lyricsSettings.playerRenderMode === 'light'");
    expect(source.match(/:line-gap="appearancePreview.playerLineGap"/g)).toHaveLength(2);
    expect(source).toContain("'--lyrics-line-gap': appearancePreview.value.playerLineGap.toString()");
    expect(source).toContain("'--lyrics-font-scale': appearancePreview.value.playerFontScale.toString()");
    expect(source).toContain(':font-scale="appearancePreview.playerFontScale"');
    expect(source).toContain(':style="lyricsPlayerStyle"');
  });

  it('passes playing, low-power, and explicit clock/seek revisions to AMLL', () => {
    expect(source).toContain(':playing="isPlaying"');
    expect(source).toContain(':low-power="shouldReduceLyricsRendering"');
    expect(source.match(/:time-sync-key="lyricsTimeSyncKey"/g)).toHaveLength(2);
    expect(source.match(/:seek-key="seekRevision"/g)).toHaveLength(2);
    expect(source).toContain('clockRevision.value');
  });

  it('starts playback at original source timing even after AMLL adds a display lead-in', () => {
    expect(source).toContain('getAmlLineSourceStartTime(event.line.getLine())');
    expect(source).toContain('getPlaybackSeekSecondsForAmlLine(lineStartTimeMs, audioDelay.value)');
    expect(source).toContain('await playAt(targetSeconds)');
    expect(source).not.toContain('await seekTo(');
  });

  it('refreshes font layout after imported fonts finish registering', () => {
    expect(source).toContain('importedLyricsFontsRevision.value');
    expect(source).toContain(':layout-version="lyricsLayoutVersion"');
  });

  it('targets actual AMLL 0.6 classes and preserves native duet alignment and subline order', () => {
    expect(officialStyles).toMatch(/\.[\w-]+_lyricLineWrapper\s*\{/);
    expect(officialStyles).toMatch(/\.[\w-]+_lyricDuetLine\s*\{/);
    expect(source).toContain('[class*="_lyricLineWrapper"]');
    expect(source).toContain(':not([class*="_lyricDuetLine"])');
    expect(source).toContain('padding-top: calc(0.4em * var(--lyrics-line-gap, 1))');
    expect(source).toContain('padding-bottom: calc(0.4em * var(--lyrics-line-gap, 1))');
    expect(source).not.toContain('nth-child');
    expect(source).not.toContain('calcLayout');
    expect(source).not.toContain('[class*="_lyricLine_"]');
  });

  it('compiles the extracted playback template', () => {
    const { descriptor } = parse(source);
    const result = compileTemplate({
      source: descriptor.template!.content,
      filename: 'LyricsView.vue',
      id: 'lyrics-view',
    });
    expect(result.errors).toEqual([]);
  });
});
