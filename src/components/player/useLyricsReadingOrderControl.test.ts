import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';

import { DEFAULT_LYRICS_READING_ORDER, LYRICS_READING_ORDER_OPTIONS } from '../../composables/lyrics/readingOrder';
import { useSettingsStore } from '../../features/settings/store';
import type { LyricsSettings } from '../../types';
import { useLyricsReadingOrderControl } from './useLyricsReadingOrderControl';

const scopes: EffectScope[] = [];
const firstSong = '/music/first.flac';
const secondSong = '/music/second.flac';
type ReadingPatch = Partial<Pick<LyricsSettings, 'readingOrder' | 'readingOrderOverrides'>>;

function createControl(initialSong = firstSong) {
  const settingsStore = useSettingsStore();
  const path = ref(initialSong);
  const persist = vi.fn((patch: ReadingPatch) => {
    settingsStore.patchSettings({ lyrics: patch });
  });
  const scope = effectScope();
  scopes.push(scope);
  const control = scope.run(() => useLyricsReadingOrderControl(
    () => settingsStore.settings.lyrics,
    () => path.value,
    persist,
  ))!;
  return { ...control, path, persist, settingsStore };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
  setActivePinia(createPinia());
});
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.unstubAllGlobals();
});

describe('reading order UI scope and persistence', () => {
  it('starts on the default scope even when a song is present', () => {
    const control = createControl();
    expect(control.scope.value).toBe('default');
    expect(control.selectedOrder.value).toBe(DEFAULT_LYRICS_READING_ORDER);
    expect(control.hasSongOverride.value).toBe(false);
    expect(control.canReset.value).toBe(false);
    expect(control.persist).not.toHaveBeenCalled();

    control.settingsStore.patchSettings({ lyrics: { readingOrder: 'translation-main-roman' } });
    expect(control.selectedOrder.value).toBe('translation-main-roman');
    expect(control.twoLineRoles.value).toEqual(['translation', 'main']);
  });

  it('immediately persists only the current song override and preserves other songs', () => {
    const control = createControl();
    control.setScope('song');
    control.settingsStore.patchSettings({ lyrics: {
      readingOrderOverrides: { [secondSong]: 'roman-main-translation' },
    } });
    control.openOptions();

    expect(control.selectOrder('translation-main-roman', control.selectionToken.value)).toBe(true);
    expect(control.persist).toHaveBeenCalledExactlyOnceWith({ readingOrderOverrides: {
      [firstSong]: 'translation-main-roman',
      [secondSong]: 'roman-main-translation',
    } });
    expect(control.settingsStore.settings.lyrics.readingOrder).toBe(DEFAULT_LYRICS_READING_ORDER);
    expect(control.selectedOrder.value).toBe('translation-main-roman');
    expect(control.hasSongOverride.value).toBe(true);

    control.selectOrder('translation-main-roman', control.selectionToken.value);
    expect(control.persist).toHaveBeenCalledOnce();
  });

  it('edits the default without overwriting a current-song override', () => {
    const control = createControl();
    control.settingsStore.patchSettings({ lyrics: {
      readingOrderOverrides: { [firstSong]: 'roman-main-translation' },
    } });
    control.setScope('default');
    control.openOptions();
    control.selectOrder('translation-main-roman', control.selectionToken.value);

    expect(control.persist).toHaveBeenCalledExactlyOnceWith({ readingOrder: 'translation-main-roman' });
    expect(control.settingsStore.settings.lyrics.readingOrderOverrides[firstSong]).toBe('roman-main-translation');
    expect(control.selectedOrder.value).toBe('translation-main-roman');
    control.setScope('song');
    expect(control.selectedOrder.value).toBe('roman-main-translation');
  });

  it('clears only the current song override and immediately follows the latest default', () => {
    const control = createControl();
    control.setScope('song');
    control.settingsStore.patchSettings({ lyrics: {
      readingOrder: 'translation-main-roman',
      readingOrderOverrides: {
        [firstSong]: 'roman-main-translation',
        [secondSong]: 'main-roman-translation',
      },
    } });
    control.openOptions();
    expect(control.reset(firstSong, 'song')).toBe(true);

    expect(control.persist).toHaveBeenCalledExactlyOnceWith({
      readingOrderOverrides: { [secondSong]: 'main-roman-translation' },
    });
    expect(control.hasSongOverride.value).toBe(false);
    expect(control.selectedOrder.value).toBe('translation-main-roman');
    expect(control.expanded.value).toBe(false);
  });

  it('closes the old menu on a song change and rejects its stale selection and reset handlers', () => {
    const control = createControl();
    control.setScope('song');
    control.settingsStore.patchSettings({ lyrics: { readingOrderOverrides: {
      [firstSong]: 'roman-main-translation',
      [secondSong]: 'translation-main-roman',
    } } });
    control.openOptions();
    const oldToken = control.selectionToken.value;
    control.path.value = secondSong;

    expect(control.expanded.value).toBe(false);
    expect(control.scope.value).toBe('song');
    expect(control.selectedOrder.value).toBe('translation-main-roman');
    expect(control.selectOrder('main-roman-translation', oldToken)).toBe(false);
    expect(control.reset(firstSong, 'song')).toBe(false);
    control.openOptions();
    expect(control.selectOrder('main-roman-translation', oldToken)).toBe(false);
    expect(control.persist).not.toHaveBeenCalled();
    expect(control.settingsStore.settings.lyrics.readingOrderOverrides[firstSong]).toBe('roman-main-translation');
    expect(control.settingsStore.settings.lyrics.readingOrderOverrides[secondSong]).toBe('translation-main-roman');
  });

  it('uses the default scope without a song and never writes an empty-path override', () => {
    const control = createControl('');
    expect(control.scope.value).toBe('default');
    expect(control.hasSong.value).toBe(false);
    control.setScope('song');
    expect(control.scope.value).toBe('default');
    control.openOptions();
    control.selectOrder('roman-translation-main', control.selectionToken.value);
    expect(control.persist).toHaveBeenCalledExactlyOnceWith({ readingOrder: 'roman-translation-main' });
    expect(control.settingsStore.settings.lyrics.readingOrderOverrides).toEqual({});

    control.path.value = firstSong;
    expect(control.scope.value).toBe('default');
    expect(control.expanded.value).toBe(false);
    expect(control.selectedOrder.value).toBe('roman-translation-main');
  });

  it('keeps the default scope across song changes even when the songs have overrides', () => {
    const control = createControl();
    control.settingsStore.patchSettings({ lyrics: { readingOrderOverrides: {
      [firstSong]: 'roman-main-translation',
      [secondSong]: 'translation-main-roman',
    } } });
    control.openOptions();
    control.path.value = secondSong;

    expect(control.scope.value).toBe('default');
    expect(control.expanded.value).toBe(false);
    expect(control.selectedOrder.value).toBe(DEFAULT_LYRICS_READING_ORDER);
    expect(control.persist).not.toHaveBeenCalled();
  });

  it('retains a manually selected song scope until the song becomes unavailable', () => {
    const control = createControl();
    control.setScope('song');
    control.path.value = secondSong;
    expect(control.scope.value).toBe('song');

    control.path.value = '';
    expect(control.scope.value).toBe('default');
    control.path.value = firstSong;
    expect(control.scope.value).toBe('default');
    expect(control.persist).not.toHaveBeenCalled();
  });

  it('resets the global default without clearing any song override', () => {
    const control = createControl();
    control.settingsStore.patchSettings({ lyrics: {
      readingOrder: 'roman-translation-main',
      readingOrderOverrides: { [secondSong]: 'translation-main-roman' },
    } });
    control.setScope('default');
    expect(control.reset(firstSong, 'default')).toBe(true);
    expect(control.persist).toHaveBeenCalledExactlyOnceWith({ readingOrder: DEFAULT_LYRICS_READING_ORDER });
    expect(control.settingsStore.settings.lyrics.readingOrderOverrides[secondSong]).toBe('translation-main-roman');
  });

  it('invalidates an open selection when switching scope', () => {
    const control = createControl();
    control.openOptions();
    const token = control.selectionToken.value;
    control.setScope('song');
    expect(control.expanded.value).toBe(false);
    expect(control.selectOrder('roman-translation-main', token)).toBe(false);
    expect(control.persist).not.toHaveBeenCalled();
  });

  it.each(LYRICS_READING_ORDER_OPTIONS)('derives the two-row hint for $value by dropping only roman', (option) => {
    const control = createControl();
    control.openOptions();
    control.selectOrder(option.value, control.selectionToken.value);
    expect(control.selectedOption.value.roles).toEqual(option.roles);
    expect(control.twoLineRoles.value).toEqual(option.roles.filter((role) => role !== 'roman'));
    expect(control.twoLineRoles.value).toHaveLength(2);
  });
});
