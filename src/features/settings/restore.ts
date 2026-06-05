import {
  LEGACY_DESKTOP_LYRICS_SETTINGS_KEY,
  LEGACY_LYRICS_SETTINGS_KEY,
  normalizeDesktopLyricsSettingsPatch,
  normalizeLyricsSettingsPatch,
} from '../../composables/lyrics/constants';
import { playerStorage } from '../../services/storage/playerStorage';
import type { AppSettings } from '../../types';
import { mergeAppSettings } from './store';

const readLegacyLyricsSettings = <T extends object>(key: string): Partial<T> | null => {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<T>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const resolveLegacyLyricsSettingsPatch = (
  saved: Partial<AppSettings>,
): Partial<Pick<AppSettings, 'lyrics' | 'desktopLyrics'>> => {
  const patch: Partial<Pick<AppSettings, 'lyrics' | 'desktopLyrics'>> = {};

  if (!saved.lyrics) {
    const legacyLyrics = readLegacyLyricsSettings<AppSettings['lyrics']>(LEGACY_LYRICS_SETTINGS_KEY);
    if (legacyLyrics) {
      patch.lyrics = normalizeLyricsSettingsPatch(legacyLyrics);
    }
  }

  if (!saved.desktopLyrics) {
    const legacyDesktopLyrics = readLegacyLyricsSettings<AppSettings['desktopLyrics']>(LEGACY_DESKTOP_LYRICS_SETTINGS_KEY)
      ?? readLegacyLyricsSettings<AppSettings['desktopLyrics']>(LEGACY_LYRICS_SETTINGS_KEY);
    if (legacyDesktopLyrics) {
      patch.desktopLyrics = normalizeDesktopLyricsSettingsPatch(legacyDesktopLyrics);
    }
  }

  return patch;
};

export function restorePersistedAppSettings(
  currentSettings: AppSettings,
  replaceSettings: (settings: AppSettings) => void,
  readSettings: () => AppSettings | null = () => playerStorage.readSettings(),
) {
  const storedSettings = readSettings();
  if (!storedSettings) return;

  try {
    const saved = storedSettings as Partial<typeof currentSettings>;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    type SavedThemeShape = Partial<typeof currentSettings.theme> & {
      enableDynamicBg?: boolean;
      dynamicBgType?: string;
      windowMaterial?: string;
    };

    const savedTheme =
      (saved.theme && typeof saved.theme === 'object' ? saved.theme : {}) as SavedThemeShape;
    const savedSidebar =
      (saved.sidebar && typeof saved.sidebar === 'object' ? saved.sidebar : {}) as Partial<typeof currentSettings.sidebar>;
    const savedCustomBackground =
      savedTheme.customBackground && typeof savedTheme.customBackground === 'object'
        ? savedTheme.customBackground
        : {} as Partial<typeof currentSettings.theme.customBackground>;
    const legacyLyricsSettingsPatch = resolveLegacyLyricsSettingsPatch(saved);

    let dynamicBgType = savedTheme.dynamicBgType;
    if (dynamicBgType === undefined && savedTheme.enableDynamicBg !== undefined) {
      dynamicBgType = savedTheme.enableDynamicBg ? 'flow' : 'none';
    }

    const savedWindowMaterial = typeof savedTheme.windowMaterial === 'string'
      && ['none', 'mica', 'acrylic', 'blur'].includes(savedTheme.windowMaterial)
      ? savedTheme.windowMaterial as typeof currentSettings.theme.windowMaterial
      : currentSettings.theme.windowMaterial;

    replaceSettings(mergeAppSettings(currentSettings, {
      ...saved,
      ...legacyLyricsSettingsPatch,
      theme: {
        ...savedTheme,
        windowMaterial: savedWindowMaterial,
        dynamicBgType:
          savedWindowMaterial !== 'none'
            ? 'none'
            : (dynamicBgType || currentSettings.theme.dynamicBgType),
        customBackground: savedCustomBackground,
      },
      sidebar: savedSidebar,
    }));
  } catch (error) {
    console.error('Failed to parse settings:', error);
  }
}
