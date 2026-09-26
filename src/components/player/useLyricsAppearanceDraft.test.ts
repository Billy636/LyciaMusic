import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, reactive, type EffectScope } from 'vue';

import { useLyricsAppearanceDraft, type LyricsAppearanceDraft } from './useLyricsAppearanceDraft';

const scopes: EffectScope[] = [];

function createDraft() {
  const settings = reactive<LyricsAppearanceDraft>({
    playerFontScale: 1,
    playerLineGap: 1,
    playerOffsetX: 0,
    playerOffsetY: 0,
  });
  const persist = vi.fn((patch: Partial<LyricsAppearanceDraft>) => Object.assign(settings, patch));
  const preview = vi.fn();
  const scope = effectScope();
  scopes.push(scope);
  const controls = scope.run(() => useLyricsAppearanceDraft(() => settings, persist, preview))!;
  return { ...controls, settings, persist, preview, scope };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.useRealTimers();
});

describe('lyrics appearance drafts', () => {
  it('previews immediately while coalescing all sliders into one 180 ms settings patch', () => {
    const { setField, draft, settings, persist, preview } = createDraft();
    setField('playerFontScale', 1.5, false);
    vi.advanceTimersByTime(100);
    setField('playerLineGap', 1.8, false);
    setField('playerOffsetX', 12, false);
    setField('playerOffsetY', -4, false);

    expect(preview).toHaveBeenLastCalledWith({ ...draft });
    expect(settings.playerFontScale).toBe(1);
    vi.advanceTimersByTime(179);
    expect(persist).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(persist).toHaveBeenCalledExactlyOnceWith({
      playerFontScale: 1.5,
      playerLineGap: 1.8,
      playerOffsetX: 12,
      playerOffsetY: -4,
    });
  });

  it('commits pending changes immediately on change/close and cancels the trailing timer', () => {
    const { setField, commit, persist } = createDraft();
    setField('playerFontScale', 1.4, false);
    commit();
    expect(persist).toHaveBeenCalledExactlyOnceWith({ playerFontScale: 1.4 });
    vi.runAllTimers();
    commit();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('flushes the pending draft on disposal without leaving a delayed write', () => {
    const { setField, persist, scope } = createDraft();
    setField('playerOffsetX', 9, false);
    scope.stop();
    expect(persist).toHaveBeenCalledExactlyOnceWith({ playerOffsetX: 9 });
    vi.runAllTimers();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('applies external settings without losing a different pending slider', () => {
    const { setField, draft, settings, commit, persist, preview } = createDraft();
    setField('playerFontScale', 1.5, false);
    settings.playerOffsetY = 8;
    expect(draft.playerFontScale).toBe(1.5);
    expect(draft.playerOffsetY).toBe(8);
    expect(preview).toHaveBeenLastCalledWith({ ...draft });
    commit();
    expect(persist).toHaveBeenCalledExactlyOnceWith({ playerFontScale: 1.5 });
  });

  it('clamps, rounds, and immediately persists button adjustments', () => {
    const { setField, settings, persist } = createDraft();
    setField('playerFontScale', 99);
    setField('playerLineGap', -1);
    setField('playerOffsetX', 99);
    setField('playerOffsetY', -99);
    expect(settings).toEqual({ playerFontScale: 3, playerLineGap: 0.5, playerOffsetX: 30, playerOffsetY: -25 });
    setField('playerFontScale', 1.234);
    setField('playerOffsetX', 9.7);
    expect(settings.playerFontScale).toBe(1.23);
    expect(settings.playerOffsetX).toBe(10);
    const calls = persist.mock.calls.length;
    setField('playerFontScale', NaN);
    setField('playerOffsetY', Infinity);
    expect(persist).toHaveBeenCalledTimes(calls);
  });
});
