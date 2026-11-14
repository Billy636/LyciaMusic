import type { ThemeSettings } from '../../types';

export type PlayerBackgroundSettings = Required<Pick<ThemeSettings,
  'playerBackgroundMode' | 'playerBackgroundPalette' | 'playerBackgroundMotion'
>>;

const defaults: PlayerBackgroundSettings = {
  playerBackgroundMode: 'original',
  playerBackgroundPalette: 'indigo',
  playerBackgroundMotion: true,
};

/** Preserve the original player background until a new mode is selected. */
export function normalizePlayerBackgroundSettings(theme: Partial<ThemeSettings>): PlayerBackgroundSettings {
  const mode = theme.playerBackgroundMode;
  const palette = theme.playerBackgroundPalette;
  return {
    playerBackgroundMode: mode === 'original' || mode === 'soft' || mode === 'gradient'
      ? mode : defaults.playerBackgroundMode,
    playerBackgroundPalette: palette === 'indigo' || palette === 'rose' || palette === 'teal' || palette === 'cover'
      ? palette : defaults.playerBackgroundPalette,
    playerBackgroundMotion: typeof theme.playerBackgroundMotion === 'boolean'
      ? theme.playerBackgroundMotion : defaults.playerBackgroundMotion,
  };
}
