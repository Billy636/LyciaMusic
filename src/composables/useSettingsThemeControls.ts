import { computed, onMounted, ref } from 'vue';

import { useThemeSettings } from './useThemeSettings';
import { useWindowMaterial, type WindowMaterialMode } from './windowMaterial';
import type { ThemeSettings } from '../types';

const clampValue = (value: number, min: number, max: number) => (
  Math.min(max, Math.max(min, Math.round(value)))
);
type SelectableWindowMaterialMode = Exclude<WindowMaterialMode, 'none'>;
type WindowMaterialDisabledReason = 'windows' | 'windows11' | 'unsupported' | 'transparency' | 'theme-conflict' | null;

export function useSettingsThemeControls() {
  const { theme, patchTheme, setThemeMode, setDynamicBackgroundType, setWindowMaterial } = useThemeSettings();
  const { capabilities, loadWindowMaterialCapabilities } = useWindowMaterial();
  const showCustomModal = ref(false);
  const showBlurTuning = ref(false);
  const showTransparentTuning = ref(false);

  const colorScheme = computed({
    get: () => theme.value.mode,
    set: (value: 'system' | 'light' | 'dark' | 'custom') => {
      setThemeMode(value);
    },
  });

  const materialMode = computed({
    get: () => theme.value.windowMaterial,
    set: (value: WindowMaterialMode) => {
      setWindowMaterial(value);
    },
  });

  const isWindows11 = computed(
    () => capabilities.value.isWindows && (capabilities.value.windowsBuildNumber ?? 0) >= 22000,
  );
  const hasWindowMaterialSelected = computed(() => materialMode.value !== 'none');
  const hasWindowMaterialThemeConflict = computed(
    () => colorScheme.value === 'custom' || theme.value.dynamicBgType !== 'none',
  );
  const windowMaterialSharedDisabledReason = computed<'theme-conflict' | null>(() => {
    if (hasWindowMaterialThemeConflict.value) {
      return 'theme-conflict';
    }

    return null;
  });
  const windowMaterialDisabledReason = computed<WindowMaterialDisabledReason>(() => {
    if (!capabilities.value.isWindows) return 'windows';
    if (windowMaterialSharedDisabledReason.value) return windowMaterialSharedDisabledReason.value;
    if (capabilities.value.systemTransparencyEnabled === false) return 'transparency';
    return null;
  });
  const isWindowMaterialDisabled = computed(
    () => !capabilities.value.isWindows || hasWindowMaterialThemeConflict.value,
  );
  const isDynamicBgDisabled = computed(
    () => colorScheme.value === 'custom' || hasWindowMaterialSelected.value,
  );

  const setColorScheme = (mode: 'system' | 'light' | 'dark' | 'custom') => {
    colorScheme.value = mode;
  };

  const setDynamicType = (type: ThemeSettings['dynamicBgType']) => {
    if (isDynamicBgDisabled.value) {
      return;
    }

    setDynamicBackgroundType(type);
  };

  const getWindowMaterialModeDisabledReason = (mode: SelectableWindowMaterialMode): WindowMaterialDisabledReason => {
    if (!capabilities.value.isWindows) {
      return 'windows';
    }

    if ((mode === 'acrylic' || mode === 'mica') && !isWindows11.value) {
      return 'windows11';
    }

    const supported = {
      acrylic: capabilities.value.supportsAcrylic,
      mica: capabilities.value.supportsMica,
      blur: capabilities.value.supportsBlur,
      transparent: capabilities.value.isWindows,
    }[mode];
    if (!supported) {
      return 'unsupported';
    }

    if (mode !== 'transparent' && capabilities.value.systemTransparencyEnabled === false) {
      return 'transparency';
    }

    return windowMaterialSharedDisabledReason.value;
  };

  const isWindowMaterialModeDisabled = (mode: SelectableWindowMaterialMode) => (
    getWindowMaterialModeDisabledReason(mode) !== null
  );

  const isWindowMaterialButtonDisabled = (mode: SelectableWindowMaterialMode) => (
    materialMode.value !== mode && isWindowMaterialModeDisabled(mode)
  );

  const toggleWindowMaterial = (mode: SelectableWindowMaterialMode) => {
    if (materialMode.value === mode) {
      materialMode.value = 'none';
      if (mode === 'blur') {
        showBlurTuning.value = false;
      }
      if (mode === 'transparent') {
        showTransparentTuning.value = false;
      }
      return;
    }

    if (isWindowMaterialModeDisabled(mode)) {
      return;
    }

    materialMode.value = mode;
    if (mode !== 'blur') {
      showBlurTuning.value = false;
    }
    if (mode !== 'transparent') {
      showTransparentTuning.value = false;
    }
  };

  const openCustomModal = () => {
    showCustomModal.value = true;
  };

  const toggleBlurTuning = () => {
    if (materialMode.value !== 'blur') {
      if (isWindowMaterialModeDisabled('blur')) {
        return;
      }

      materialMode.value = 'blur';
      showBlurTuning.value = true;
      showTransparentTuning.value = false;
      return;
    }

    showBlurTuning.value = !showBlurTuning.value;
  };

  const setWindowBlurTint = (value: number) => {
    patchTheme({ windowBlurTint: clampValue(value, 0, 100) });
  };

  const toggleTransparentTuning = () => {
    if (materialMode.value !== 'transparent') {
      if (isWindowMaterialModeDisabled('transparent')) {
        return;
      }

      materialMode.value = 'transparent';
      showTransparentTuning.value = true;
      showBlurTuning.value = false;
      return;
    }

    showTransparentTuning.value = !showTransparentTuning.value;
  };

  const setWindowTransparentOpacity = (value: number) => {
    patchTheme({ windowTransparentOpacity: clampValue(value, 0, 100) });
  };

  const toggleRetainMaterialOnUnfocus = () => {
    patchTheme({ retainMaterialOnUnfocus: !theme.value.retainMaterialOnUnfocus });
  };

  onMounted(() => {
    void loadWindowMaterialCapabilities();
  });

  return {
    theme,
    showCustomModal,
    colorScheme,
    materialMode,
    isWindows11,
    hasWindowMaterialSelected,
    isWindowMaterialDisabled,
    isWindowMaterialButtonDisabled,
    getWindowMaterialModeDisabledReason,
    windowMaterialDisabledReason,
    isDynamicBgDisabled,
    showBlurTuning,
    showTransparentTuning,
    setColorScheme,
    setDynamicType,
    toggleWindowMaterial,
    openCustomModal,
    toggleBlurTuning,
    setWindowBlurTint,
    toggleTransparentTuning,
    setWindowTransparentOpacity,
    toggleRetainMaterialOnUnfocus,
  };
}
