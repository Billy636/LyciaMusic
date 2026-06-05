import type { Ref } from 'vue';

import type { AppSettings } from '../../types';

type DesktopLyricsVisibilitySettings = Pick<AppSettings, 'showDesktopLyrics'>;

export function applyDesktopLyricsVisibilityPreference(
  visible: Ref<boolean>,
  preferredVisible: boolean,
) {
  if (visible.value === preferredVisible) return;
  visible.value = preferredVisible;
}

export function persistDesktopLyricsVisibilityPreference(
  settings: DesktopLyricsVisibilitySettings,
  patchSettings: (patch: DesktopLyricsVisibilitySettings) => void,
  visible: boolean,
) {
  if (settings.showDesktopLyrics === visible) return;
  patchSettings({ showDesktopLyrics: visible });
}
