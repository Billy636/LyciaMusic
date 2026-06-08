import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import type {
  AppSettings,
  AudioSettings,
  DesktopLyricsSettings,
  EqualizerPreset,
  ImportedLyricsFont,
  LyricsSettings,
  SidebarSettings,
  ThemeSettings,
} from '../../types';
import {
  createDefaultDesktopLyricsSettings,
  createDefaultLyricsSettings,
  mergeDesktopLyricsSettings,
  mergeLyricsSettings,
  normalizeImportedLyricsFonts,
} from '../../composables/lyrics/constants';
import {
  createDefaultShortcutSettings,
  mergeShortcutSettings,
  type ShortcutSettingsPatch,
} from './shortcuts';
import { playerStorage } from '../../services/storage/playerStorage';

const createUserPresetId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `user_${crypto.randomUUID()}`
    : `user_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export type ThemeSettingsPatch = Partial<Omit<ThemeSettings, 'customBackground'>> & {
  customBackground?: Partial<ThemeSettings['customBackground']>;
};

export type SidebarSettingsPatch = Partial<SidebarSettings>;

export type LyricsSettingsPatch = Partial<LyricsSettings>;
export type DesktopLyricsSettingsPatch = Partial<DesktopLyricsSettings>;
type LegacyVolumeBalanceSettingsPatch = Partial<AudioSettings['volumeBalance']> & {
  targetLufs?: number;
};
export type AudioSettingsPatch = Partial<Omit<AudioSettings, 'volumeBalance'>> & {
  volumeBalance?: LegacyVolumeBalanceSettingsPatch | boolean;
};
export type ImportedLyricsFontsPatch = ImportedLyricsFont[];

export interface AppSettingsPatch
  extends Partial<Omit<AppSettings, 'theme' | 'sidebar' | 'shortcuts' | 'lyrics' | 'desktopLyrics' | 'audio' | 'customLyricsFonts'>> {
  theme?: ThemeSettingsPatch;
  sidebar?: SidebarSettingsPatch;
  shortcuts?: ShortcutSettingsPatch;
  lyrics?: LyricsSettingsPatch;
  desktopLyrics?: DesktopLyricsSettingsPatch;
  audio?: AudioSettingsPatch;
  customLyricsFonts?: ImportedLyricsFontsPatch;
}

export interface DeprecatedAppSettingsPatch extends AppSettingsPatch {
  minimizeToTray?: boolean;
}

export const normalizeForegroundStyle = (
  foregroundStyle: string | null | undefined,
): ThemeSettings['customBackground']['foregroundStyle'] => (foregroundStyle === 'dark' ? 'dark' : 'light');

export const defaultThemeSettings: ThemeSettings = {
  mode: 'light',
  dynamicBgType: 'none',
  windowMaterial: 'none',
  flowColorBoost: 25,
  flowDepth: 30,
  flowSpeed: 52,
  flowTexture: 34,
  windowBlurTint: 50,
  customBgPath: '',
  opacity: 0.8,
  blur: 20,
  customBackground: {
    imagePath: '',
    blur: 20,
    opacity: 1,
    maskColor: '#000000',
    maskAlpha: 0.4,
    scale: 1,
    foregroundStyle: 'light',
    translateX: 0,
    translateY: 0,
  },
};

export const defaultSidebarSettings: SidebarSettings = {
  showLocalMusic: true,
  showArtists: true,
  showAlbums: true,
  showFavorites: true,
  showRecent: true,
  showFolders: true,
  showStatistics: true,
};

export const defaultAudioSettings: AudioSettings = {
  outputMode: 'shared',
  volumeBalance: {
    enabled: false,
    gainOffsetDb: 0,
    preventClipping: true,
  },
  equalizer: {
    enabled: false,
    preamp: 0.0,
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  showEqualizerInFooter: true,
};

export const defaultAppSettings: AppSettings = {
  closeToTray: true,
  showDesktopLyrics: false,
  showQualityBadges: true,
  showSongComments: true,
  enableScrollToTopButton: true,
  libraryMinDurationSeconds: 0,
  // Deprecated compat field. Main folder-source behavior no longer depends on it.
  linkFoldersToLibrary: false,
  lyricsSyncOffset: 0,
  organizeRoot: 'D:\\Music',
  enableAutoOrganize: true,
  organizeRule: '{Artist}/{Album}/{Title}',
  audio: defaultAudioSettings,
  customLyricsFonts: [],
  lyrics: createDefaultLyricsSettings(),
  desktopLyrics: createDefaultDesktopLyricsSettings(),
  theme: defaultThemeSettings,
  sidebar: defaultSidebarSettings,
  shortcuts: createDefaultShortcutSettings(),
  showTaskbarPlayer: false,
  taskbarPlayerCanDrag: false,
  gpuAcceleration: true,
};

export const createDefaultThemeSettings = (): ThemeSettings => ({
  ...defaultThemeSettings,
  customBackground: {
    ...defaultThemeSettings.customBackground,
  },
});

export const createDefaultSidebarSettings = (): SidebarSettings => ({
  ...defaultSidebarSettings,
});

export const createDefaultAudioSettings = (): AudioSettings => ({
  ...defaultAudioSettings,
  volumeBalance: {
    ...defaultAudioSettings.volumeBalance,
  },
  equalizer: {
    ...defaultAudioSettings.equalizer,
    gains: [...defaultAudioSettings.equalizer.gains],
  },
});

export const normalizeLibraryMinDurationSeconds = (
  value: number | null | undefined,
): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return Math.round(numericValue);
};

export const createDefaultAppSettings = (): AppSettings => ({
  ...defaultAppSettings,
  customLyricsFonts: [],
  lyrics: createDefaultLyricsSettings(),
  desktopLyrics: createDefaultDesktopLyricsSettings(),
  audio: createDefaultAudioSettings(),
  theme: createDefaultThemeSettings(),
  sidebar: createDefaultSidebarSettings(),
  shortcuts: createDefaultShortcutSettings(),
});

export const mergeThemeSettings = (
  base: ThemeSettings,
  patch: ThemeSettingsPatch,
): ThemeSettings => {
  const mergedCustomBackground = {
    ...base.customBackground,
    ...(patch.customBackground ?? {}),
  };

  return {
    ...base,
    ...patch,
    customBackground: {
      ...mergedCustomBackground,
      foregroundStyle: normalizeForegroundStyle(mergedCustomBackground.foregroundStyle),
    },
  };
};

export const mergeSidebarSettings = (
  base: SidebarSettings,
  patch: SidebarSettingsPatch,
): SidebarSettings => ({
  ...base,
  ...patch,
});

export const mergeAudioSettings = (
  base: AudioSettings,
  patch: AudioSettingsPatch,
): AudioSettings => {
  const volumeBalancePatch = patch.volumeBalance;
  let enabled = base.volumeBalance?.enabled ?? false;
  let gainOffsetDb = base.volumeBalance?.gainOffsetDb ?? 0;
  let preventClipping = base.volumeBalance?.preventClipping ?? true;

  if (typeof volumeBalancePatch === 'boolean') {
    enabled = volumeBalancePatch;
  } else if (volumeBalancePatch && typeof volumeBalancePatch === 'object') {
    enabled = volumeBalancePatch.enabled ?? enabled;
    gainOffsetDb = volumeBalancePatch.gainOffsetDb
      ?? (volumeBalancePatch.targetLufs !== undefined ? volumeBalancePatch.targetLufs - (-18) : gainOffsetDb);
    preventClipping = volumeBalancePatch.preventClipping ?? preventClipping;
  }

  const equalizerPatch = patch.equalizer;
  let eqEnabled = base.equalizer?.enabled ?? false;
  let eqPreamp = base.equalizer?.preamp ?? 0.0;
  let eqGains = base.equalizer?.gains ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let eqCurrentPresetId = base.equalizer?.currentPresetId ?? null;

  if (equalizerPatch && typeof equalizerPatch === 'object') {
    eqEnabled = equalizerPatch.enabled ?? eqEnabled;
    eqPreamp = equalizerPatch.preamp ?? eqPreamp;
    eqGains = equalizerPatch.gains ? [...equalizerPatch.gains] : eqGains;
    if ('currentPresetId' in equalizerPatch) {
      eqCurrentPresetId = equalizerPatch.currentPresetId ?? null;
    }
  }

  const nextOutputMode =
    patch.outputMode === 'wasapiExclusive' || patch.outputMode === 'shared'
      ? patch.outputMode
      : base.outputMode ?? 'shared';

  return {
    ...base,
    outputMode: nextOutputMode,
    volumeBalance: {
      enabled,
      gainOffsetDb,
      preventClipping,
    },
    equalizer: {
      enabled: eqEnabled,
      preamp: eqPreamp,
      gains: eqGains,
      currentPresetId: eqCurrentPresetId,
    },
    showEqualizerInFooter: patch.showEqualizerInFooter ?? base.showEqualizerInFooter ?? true,
  };
};

export const mergeAppSettings = (
  base: AppSettings,
  patch: DeprecatedAppSettingsPatch,
): AppSettings => {
  const {
    minimizeToTray: _deprecated,
    libraryMinDurationSeconds,
    ...rest
  } = patch;

  return {
    // Ignore removed legacy fields that may still exist in persisted settings.
    ...base,
    ...rest,
    libraryMinDurationSeconds: normalizeLibraryMinDurationSeconds(
      libraryMinDurationSeconds ?? base.libraryMinDurationSeconds,
    ),
    lyrics: mergeLyricsSettings(base.lyrics, patch.lyrics ?? {}),
    desktopLyrics: mergeDesktopLyricsSettings(base.desktopLyrics, patch.desktopLyrics ?? {}),
    audio: mergeAudioSettings(base.audio ?? createDefaultAudioSettings(), patch.audio ?? {}),
    customLyricsFonts: normalizeImportedLyricsFonts(patch.customLyricsFonts ?? base.customLyricsFonts),
    theme: mergeThemeSettings(base.theme, patch.theme ?? {}),
    sidebar: mergeSidebarSettings(base.sidebar, patch.sidebar ?? {}),
    shortcuts: mergeShortcutSettings(base.shortcuts, patch.shortcuts ?? {}),
  };
};

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(createDefaultAppSettings());
  const audioDelay = computed(() => settings.value.lyricsSyncOffset);
  const theme = computed<ThemeSettings>({
    get: () => settings.value.theme,
    set: nextTheme => {
      settings.value = {
        ...settings.value,
        theme: mergeThemeSettings(createDefaultThemeSettings(), nextTheme),
      };
    },
  });
  const sidebar = computed<SidebarSettings>({
    get: () => settings.value.sidebar,
    set: nextSidebar => {
      settings.value = {
        ...settings.value,
        sidebar: mergeSidebarSettings(createDefaultSidebarSettings(), nextSidebar),
      };
    },
  });

  const replaceSettings = (nextSettings: AppSettings) => {
    settings.value = mergeAppSettings(createDefaultAppSettings(), nextSettings);
  };

  const patchSettings = (partialSettings: AppSettingsPatch) => {
    settings.value = mergeAppSettings(settings.value, partialSettings);
  };

  const resetSettings = () => {
    settings.value = createDefaultAppSettings();
  };

  const replaceTheme = (nextTheme: ThemeSettings) => {
    theme.value = nextTheme;
  };

  const patchTheme = (partialTheme: ThemeSettingsPatch) => {
    settings.value = {
      ...settings.value,
      theme: mergeThemeSettings(settings.value.theme, partialTheme),
    };
  };

  const replaceSidebar = (nextSidebar: SidebarSettings) => {
    sidebar.value = nextSidebar;
  };

  const patchSidebar = (partialSidebar: SidebarSettingsPatch) => {
    settings.value = {
      ...settings.value,
      sidebar: mergeSidebarSettings(settings.value.sidebar, partialSidebar),
    };
  };

  // 均衡器预设管理
  const equalizerPresets = ref<EqualizerPreset[]>(
    playerStorage.readEqualizerPresets()
  );
  
  const userPresets = computed(() => 
    equalizerPresets.value.filter(p => !p.isBuiltin)
  );
  
  const saveEqualizerPreset = (name: string) => {
    const newPreset: EqualizerPreset = {
      id: createUserPresetId(),
      name,
      preamp: settings.value.audio.equalizer.preamp,
      gains: [...settings.value.audio.equalizer.gains],
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    equalizerPresets.value.push(newPreset);
    playerStorage.writeEqualizerPresets(userPresets.value);
    
    // 使用patchSettings替换整个equalizer对象
    patchSettings({
      audio: {
        equalizer: {
          ...settings.value.audio.equalizer,
          currentPresetId: newPreset.id,
        },
      },
    });
    
    return newPreset;
  };
  
  const updateEqualizerPreset = (presetId: string, name: string) => {
    const preset = equalizerPresets.value.find(p => p.id === presetId);
    if (preset && !preset.isBuiltin) {
      preset.name = name;
      preset.preamp = settings.value.audio.equalizer.preamp;
      preset.gains = [...settings.value.audio.equalizer.gains];
      preset.updatedAt = Date.now();
      playerStorage.writeEqualizerPresets(userPresets.value);
    }
  };
  
  const deleteEqualizerPreset = (presetId: string) => {
    const index = equalizerPresets.value.findIndex(p => p.id === presetId);
    if (index !== -1 && !equalizerPresets.value[index].isBuiltin) {
      equalizerPresets.value.splice(index, 1);
      playerStorage.writeEqualizerPresets(userPresets.value);
      
      // 如果删除的是当前预设，清除当前预设ID
      if (settings.value.audio.equalizer.currentPresetId === presetId) {
        patchSettings({
          audio: {
            equalizer: {
              ...settings.value.audio.equalizer,
              currentPresetId: null,
            },
          },
        });
      }
    }
  };
  
  const loadEqualizerPreset = (presetId: string) => {
    const preset = equalizerPresets.value.find(p => p.id === presetId);
    if (preset) {
      patchSettings({
        audio: {
          equalizer: {
            enabled: true,
            preamp: preset.preamp,
            gains: [...preset.gains],
            currentPresetId: presetId,
          },
        },
      });
    }
  };

  return {
    settings,
    audioDelay,
    theme,
    sidebar,
    equalizerPresets,
    userPresets,
    replaceSettings,
    patchSettings,
    resetSettings,
    replaceTheme,
    patchTheme,
    replaceSidebar,
    patchSidebar,
    saveEqualizerPreset,
    updateEqualizerPreset,
    deleteEqualizerPreset,
    loadEqualizerPreset,
  };
});
