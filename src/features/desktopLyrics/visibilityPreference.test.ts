import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import {
  applyDesktopLyricsVisibilityPreference,
  persistDesktopLyricsVisibilityPreference,
} from './visibilityPreference';

describe('desktop lyrics visibility preference', () => {
  it('applies the persisted visibility to the runtime state', () => {
    const visible = ref(false);

    applyDesktopLyricsVisibilityPreference(visible, true);

    expect(visible.value).toBe(true);
  });

  it('persists runtime visibility changes only when the value changed', () => {
    const patchSettings = vi.fn();
    const settings = { showDesktopLyrics: false };

    persistDesktopLyricsVisibilityPreference(settings, patchSettings, true);
    persistDesktopLyricsVisibilityPreference({ showDesktopLyrics: true }, patchSettings, true);

    expect(patchSettings).toHaveBeenCalledTimes(1);
    expect(patchSettings).toHaveBeenCalledWith({ showDesktopLyrics: true });
  });
});
