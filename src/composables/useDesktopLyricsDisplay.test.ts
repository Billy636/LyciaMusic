import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useDesktopLyricsDisplay } from './useDesktopLyricsDisplay';
import type { DesktopLyricsStatePayload } from '../features/desktopLyrics/shared';

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(),
}));

function createPayload(enableWordEffect: boolean): DesktopLyricsStatePayload {
  return {
    song: null,
    parsedLyrics: [{
      time: 1,
      endTime: 5,
      text: 'hello world',
      translation: '',
      romaji: '',
      words: [
        { text: 'hello ', start: 1, end: 3, romaji: '' },
        { text: 'world', start: 3, end: 5, romaji: '' },
      ],
    }],
    lyricsStatus: 'ready',
    fallbackText: 'Instrumental / No lyrics',
    playbackTime: 2,
    syncedAt: Date.now(),
    isPlaying: false,
    audioDelay: 0,
    themeColors: [],
    customLyricsFonts: [],
    settings: {
      showTranslation: true,
      showRomaji: false,
      isAlwaysOnTop: false,
      alwaysShowShadowBackground: false,
      autoHideWhenFullscreen: true,
      autoHideWhenPaused: false,
      showDoubleLine: false,
      enableWordEffect,
      isLocked: false,
      persistLock: false,
      colorScheme: 'auto',
      customPlayedColor: '#EC4141',
      customUnplayedColor: '#FFFFFF',
      customRomajiPlayedColor: '#BFDBFE',
      customRomajiUnplayedColor: '#FFFFFF',
      customRomajiColor: '#BFDBFE',
      customTranslationColor: '#FBCFE8',
      textOpacity: 1,
      textShadowColor: '#000000',
      firstLineTextShadowStrength: 0,
      secondLineTextShadowStrength: 0,
      playerFontScale: 1,
      playerLineGap: 1,
      playerOffsetX: 0,
      playerOffsetY: 0,
      playerAlignment: 'center',
      playerFontPreset: 'system',
    },
  };
}

describe('useDesktopLyricsDisplay', () => {
  it('aligns playback time when playback state changes', () => {
    const display = useDesktopLyricsDisplay(ref(false));

    display.playbackTime.value = 10;
    display.isPlaying.value = true;
    display.handlePlaybackPayload({
      playbackTime: 9.8,
      syncedAt: Date.now(),
      isPlaying: false,
      audioDelay: 0,
    });

    expect(display.isPlaying.value).toBe(false);
    expect(display.playbackTime.value).toBe(9.8);
  });

  it('renders the main line as one text block when desktop word effect is disabled', () => {
    const display = useDesktopLyricsDisplay(ref(false));

    display.handlePayload(createPayload(false));

    expect(display.visibleLyricLines.value[0]?.line.text).toBe('hello world');
    expect(display.visibleLyricLines.value[0]?.words).toEqual([]);
  });

  it('splits untimed CJK desktop lyrics into sequential pseudo word segments', () => {
    const display = useDesktopLyricsDisplay(ref(false));
    const payload = createPayload(true);

    display.handlePayload({
      ...payload,
      parsedLyrics: [{
        time: 1,
        endTime: 3,
        text: '你我',
        translation: '',
        romaji: '',
        words: [],
      }],
    });

    expect(display.visibleLyricLines.value[0]?.words).toEqual([
      { text: '你', start: 1, end: 2, romaji: '' },
      { text: '我', start: 2, end: 3, romaji: '' },
    ]);
  });

  it('keeps latin words intact when creating pseudo word segments', () => {
    const display = useDesktopLyricsDisplay(ref(false));
    const payload = createPayload(true);

    display.handlePayload({
      ...payload,
      parsedLyrics: [{
        time: 1,
        endTime: 4,
        text: 'into the mall',
        translation: '',
        romaji: '',
        words: [],
      }],
    });

    expect(display.visibleLyricLines.value[0]?.words.map((word) => word.text)).toEqual([
      'into ',
      'the ',
      'mall',
    ]);
  });

  it('exposes desktop readability settings as CSS variables', () => {
    const display = useDesktopLyricsDisplay(ref(false));
    const payload = createPayload(true);

    display.handlePayload({
      ...payload,
      settings: {
        ...payload.settings,
        textOpacity: 0.82,
        textShadowColor: '#112233',
        firstLineTextShadowStrength: 25,
        secondLineTextShadowStrength: 75,
      } as any,
    });

    expect(display.widgetStyle.value).toMatchObject({
      '--desktop-text-opacity': '0.82',
      '--desktop-text-shadow-color': '17 34 51',
      '--desktop-first-line-text-shadow-alpha': '0.25',
      '--desktop-first-line-text-shadow-blur': '6px',
      '--desktop-second-line-text-shadow-alpha': '0.75',
      '--desktop-second-line-text-shadow-blur': '18px',
    });
  });

  it('keeps imported desktop lyrics fonts available from state payloads', () => {
    const display = useDesktopLyricsDisplay(ref(false));
    const payload = createPayload(true);

    display.handlePayload({
      ...payload,
      customLyricsFonts: [{
        id: 'font-1',
        name: 'My Lyrics Font',
        family: 'Lycia Imported Lyrics Font font-1',
        filePath: 'C:\\Fonts\\my-lyrics-font.ttf',
        importedAt: 1,
        format: 'truetype',
      }],
      settings: {
        ...payload.settings,
        playerFontPreset: 'Lycia Imported Lyrics Font font-1',
      },
    });

    expect(display.availableFontOptions.value[0]).toMatchObject({
      value: 'Lycia Imported Lyrics Font font-1',
      label: 'My Lyrics Font',
      isImported: true,
    });
    expect(display.selectedFontLabel.value).toBe('My Lyrics Font');
  });

  it('exposes independent desktop romaji played and unplayed colors in custom schemes', () => {
    const display = useDesktopLyricsDisplay(ref(false));
    const payload = createPayload(true);

    display.handlePayload({
      ...payload,
      playbackTime: 2,
      settings: {
        ...payload.settings,
        colorScheme: 'custom',
        customRomajiPlayedColor: '#123456',
        customRomajiUnplayedColor: '#ABCDEF',
      } as any,
    });

    expect(display.widgetStyle.value).toMatchObject({
      '--desktop-romaji-played-color': '#123456',
      '--desktop-romaji-unplayed-color': '#ABCDEF',
    });
    expect(display.getRomajiWordStyle(1, 3).backgroundImage).toContain('var(--desktop-romaji-played-color) 0%');
    expect(display.getRomajiWordStyle(1, 3).backgroundImage).toContain('var(--desktop-romaji-unplayed-color) 50%');
  });

  it('uses word-level romaji on desktop only when every displayed word has romaji', () => {
    const display = useDesktopLyricsDisplay(ref(false));
    const payload = createPayload(true);

    display.handlePayload({
      ...payload,
      parsedLyrics: [{
        time: 12.651,
        endTime: 18.056,
        text: 'か弱い光が指差す先',
        translation: '追寻着那道微弱光线所指的方向',
        romaji: 'ka yo wa i hi ka ri ga yu bi sa su sa ki',
        words: [
          { text: 'か', start: 12.651, end: 12.884, romaji: 'ka' },
          { text: '弱', start: 12.884, end: 13.476, romaji: 'yo wa' },
          { text: 'い', start: 13.476, end: 13.678, romaji: 'i' },
        ],
      }],
      settings: {
        ...payload.settings,
        showRomaji: true,
        showTranslation: true,
      },
    });

    expect(display.visibleLyricLines.value[0]?.hasAlignedRomaji).toBe(true);
    expect(display.visibleLyricLines.value[0]?.secondaryLines).toEqual([
      { kind: 'translation', text: '追寻着那道微弱光线所指的方向' },
    ]);
  });

  it('falls back to a desktop romaji secondary line when word romaji is incomplete', () => {
    const display = useDesktopLyricsDisplay(ref(false));
    const payload = createPayload(true);

    display.handlePayload({
      ...payload,
      parsedLyrics: [{
        time: 12.651,
        endTime: 18.056,
        text: 'か弱い',
        translation: '微弱',
        romaji: 'ka yo wa i',
        words: [
          { text: 'か', start: 12.651, end: 12.884, romaji: 'ka' },
          { text: '弱', start: 12.884, end: 13.476, romaji: '' },
          { text: 'い', start: 13.476, end: 13.678, romaji: 'i' },
        ],
      }],
      settings: {
        ...payload.settings,
        showRomaji: true,
        showTranslation: true,
      },
    });

    expect(display.visibleLyricLines.value[0]?.hasAlignedRomaji).toBe(false);
    expect(display.visibleLyricLines.value[0]?.secondaryLines).toEqual([
      { kind: 'romaji', text: 'ka yo wa i' },
      { kind: 'translation', text: '微弱' },
    ]);
  });

  it('exposes split-corner alignment only for desktop double-line placement', () => {
    const display = useDesktopLyricsDisplay(ref(false));
    const payload = createPayload(true);

    display.handlePayload({
      ...payload,
      settings: {
        ...payload.settings,
        showDoubleLine: true,
        playerAlignment: 'split-corners',
      },
    });

    expect(display.lyricsAlignmentClass.value).toBe('lyrics-align-split-corners');

    display.handlePayload({
      ...payload,
      settings: {
        ...payload.settings,
        showDoubleLine: false,
        playerAlignment: 'split-corners',
      },
    });

    expect(display.lyricsAlignmentClass.value).toBe('lyrics-align-left');
  });
});
