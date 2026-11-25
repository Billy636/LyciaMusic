import { computed, onMounted, ref, watch } from 'vue';

import { useThemeSettings } from './useThemeSettings';
import { useWindowMaterial, type WindowMaterialMode } from './windowMaterial';
import type { ThemeSettings } from '../types';

const clampValue = (value: number, min: number, max: number) => (
  Math.min(max, Math.max(min, Math.round(value)))
);
type SelectableWindowMaterialMode = Exclude<WindowMaterialMode, 'none'>;
type WindowMaterialDisabledReason = 'windows' | 'windows11' | 'unsupported' | 'transparency' | 'theme-conflict' | null;

type ActiveDynamicBgType = Exclude<ThemeSettings['dynamicBgType'], 'none'>;
// 关闭后再启用时恢复到用户上次选中的模式，避免每次都回到同一个默认值。
let lastDynamicBgType: ActiveDynamicBgType = 'blur';
let lastWindowMaterialMode: SelectableWindowMaterialMode = 'acrylic';
const DYNAMIC_BG_TYPES: readonly ActiveDynamicBgType[] = ['flow', 'blur', 'mist'];
const MATERIAL_MODES: readonly SelectableWindowMaterialMode[] = ['acrylic', 'mica', 'blur', 'transparent'];

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

  // 「关闭」改由滑动开关表达：开关状态即是否为 none；关掉再打开时恢复上次模式。
  const isDynamicBgEnabled = computed(() => theme.value.dynamicBgType !== 'none');
  const isWindowMaterialEnabled = computed(() => materialMode.value !== 'none');

  watch(() => theme.value.dynamicBgType, (value) => {
    if (value !== 'none' && DYNAMIC_BG_TYPES.includes(value)) lastDynamicBgType = value;
  }, { immediate: true });
  watch(materialMode, (value) => {
    if (value !== 'none' && MATERIAL_MODES.includes(value as SelectableWindowMaterialMode)) {
      lastWindowMaterialMode = value as SelectableWindowMaterialMode;
    }
  }, { immediate: true });

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

  const isWindowMaterialButtonDisabled = (mode: WindowMaterialMode) => (
    mode !== 'none' && materialMode.value !== mode && isWindowMaterialModeDisabled(mode)
  );

  /** 与「动态背景」一致的单选语义：点选即选中；关闭使用独立的滑动开关。 */
  const selectWindowMaterial = (mode: WindowMaterialMode) => {
    if (mode !== 'none' && isWindowMaterialModeDisabled(mode)) return;
    if (materialMode.value === mode && mode !== 'none') return;

    materialMode.value = mode;
    if (mode !== 'blur') showBlurTuning.value = false;
    if (mode !== 'transparent') showTransparentTuning.value = false;
  };

  const toggleDynamicBackground = () => {
    if (isDynamicBgDisabled.value) return;
    setDynamicBackgroundType(isDynamicBgEnabled.value ? 'none' : lastDynamicBgType);
  };

  const toggleWindowMaterial = () => {
    if (isWindowMaterialDisabled.value) return;
    if (isWindowMaterialEnabled.value) {
      selectWindowMaterial('none');
      return;
    }
    // 优先恢复上次模式；该模式当前不可用时退到第一个可用模式，全部不可用则不启用。
    const candidates = [lastWindowMaterialMode, ...MATERIAL_MODES];
    const available = candidates.find(mode => !isWindowMaterialModeDisabled(mode));
    if (available) selectWindowMaterial(available);
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
    selectWindowMaterial,
    isDynamicBgEnabled,
    isWindowMaterialEnabled,
    toggleDynamicBackground,
    toggleWindowMaterial,
    openCustomModal,
    toggleBlurTuning,
    setWindowBlurTint,
    toggleTransparentTuning,
    setWindowTransparentOpacity,
    toggleRetainMaterialOnUnfocus,
  };
}
