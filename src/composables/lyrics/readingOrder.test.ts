import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LYRICS_READING_ORDER,
  LYRICS_READING_ORDER_OPTIONS,
  createLyricsReadingOrderOverridePatch,
  getLyricsReadingRoles,
  normalizeLyricsReadingOrder,
  normalizeLyricsReadingOrderOverrides,
  resolveLyricsReadingOrder,
} from './readingOrder';

describe('lyrics reading-order configuration', () => {
  it('defines all six unique permutations and derives two rows by removing romanization', () => {
    expect(LYRICS_READING_ORDER_OPTIONS).toHaveLength(6);
    expect(new Set(LYRICS_READING_ORDER_OPTIONS.map(({ value }) => value)).size).toBe(6);
    for (const option of LYRICS_READING_ORDER_OPTIONS) {
      expect(option.roles.join('-')).toBe(option.value);
      expect([...option.roles].sort()).toEqual(['main', 'roman', 'translation']);
      expect(getLyricsReadingRoles(option.value, 3)).toEqual(option.roles);
      expect(getLyricsReadingRoles(option.value, 2)).toEqual(option.roles.filter((role) => role !== 'roman'));
      expect(getLyricsReadingRoles(option.value, 1)).toEqual(['main']);
      expect(normalizeLyricsReadingOrder(option.value)).toBe(option.value);
    }
    expect(getLyricsReadingRoles('translation-main-roman', 2)).toEqual(['translation', 'main']);
    expect(getLyricsReadingRoles('roman-main-translation', 2)).toEqual(['main', 'translation']);
  });

  it('uses the new default only for absent or invalid global orders', () => {
    expect(DEFAULT_LYRICS_READING_ORDER).toBe('main-translation-roman');
    for (const invalid of [undefined, null, '', 'auto', 'main-roman', 42, {}]) {
      expect(normalizeLyricsReadingOrder(invalid)).toBe(DEFAULT_LYRICS_READING_ORDER);
    }
  });

  it('cleans malformed overrides while preserving exact nonempty path keys', () => {
    const value = Object.assign(Object.create({ inherited: 'roman-main-translation' }), {
      'D:/Music/Track.flac': 'roman-main-translation',
      'remote://source/歌.flac': 'translation-main-roman',
      ' spaced key ': 'main-roman-translation',
      '': 'main-translation-roman',
      '   ': 'main-translation-roman',
      invalid: 'guess-language',
      missing: null,
    });
    expect(normalizeLyricsReadingOrderOverrides(value)).toEqual({
      'D:/Music/Track.flac': 'roman-main-translation',
      'remote://source/歌.flac': 'translation-main-roman',
      ' spaced key ': 'main-roman-translation',
    });
    for (const invalid of [undefined, null, [], 'main-translation-roman', 3]) {
      expect(normalizeLyricsReadingOrderOverrides(invalid)).toEqual({});
    }
  });

  it('resolves only an own valid song override before the global default', () => {
    const settings = {
      readingOrder: 'translation-main-roman' as const,
      readingOrderOverrides: { song: 'roman-main-translation' as const },
    };
    expect(resolveLyricsReadingOrder(settings, 'song')).toBe('roman-main-translation');
    expect(resolveLyricsReadingOrder(settings, 'other')).toBe('translation-main-roman');
    expect(resolveLyricsReadingOrder(settings)).toBe('translation-main-roman');
    expect(resolveLyricsReadingOrder(settings, 'toString')).toBe('translation-main-roman');
    expect(resolveLyricsReadingOrder({})).toBe(DEFAULT_LYRICS_READING_ORDER);
  });

  it('sets and removes one song without mutating settings or deleting other overrides', () => {
    const settings = {
      readingOrder: DEFAULT_LYRICS_READING_ORDER,
      readingOrderOverrides: Object.freeze({ first: 'roman-main-translation' as const }),
    };
    const added = createLyricsReadingOrderOverridePatch(settings, 'second', 'translation-roman-main');
    expect(added.readingOrderOverrides).toEqual({ first: 'roman-main-translation', second: 'translation-roman-main' });
    expect(settings.readingOrderOverrides).toEqual({ first: 'roman-main-translation' });
    expect(createLyricsReadingOrderOverridePatch(added, 'first', null).readingOrderOverrides).toEqual({ second: 'translation-roman-main' });
    expect(createLyricsReadingOrderOverridePatch(settings, '  ', 'translation-roman-main').readingOrderOverrides).toEqual(settings.readingOrderOverrides);
  });

  it('does not use special object keys as prototype assignments', () => {
    const settings = createLyricsReadingOrderOverridePatch({}, '__proto__', 'roman-main-translation');
    expect(Object.getPrototypeOf(settings.readingOrderOverrides)).toBe(Object.prototype);
    expect(resolveLyricsReadingOrder(settings, '__proto__')).toBe('roman-main-translation');
    expect(normalizeLyricsReadingOrderOverrides(settings.readingOrderOverrides)).toEqual(settings.readingOrderOverrides);
  });
});
