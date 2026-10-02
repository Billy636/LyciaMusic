import { computed, type Ref } from 'vue';

import { useThemeSettings } from './useThemeSettings';

interface UseAppShellThemeOptions {
  showPlayerDetail: Ref<boolean>;
  hasWindowMaterial: Ref<boolean>;
  isMicaWindowMaterial: Ref<boolean>;
}

export function useAppShellTheme({
  showPlayerDetail,
  hasWindowMaterial,
  isMicaWindowMaterial,
}: UseAppShellThemeOptions) {
  const { theme } = useThemeSettings();

  const mainBlurStyle = computed(() => {
    if (showPlayerDetail.value) {
      return 'none';
    }

    const { dynamicBgType, mode, customBackground } = theme.value;

    if (mode === 'custom') {
      const blur = isMicaWindowMaterial.value
        ? Math.min(customBackground.blur, 8)
        : hasWindowMaterial.value ? Math.min(customBackground.blur, 16) : customBackground.blur;
      return blur <= 0 ? 'none' : `blur(${blur}px)`;
    }

    // Flow color boundaries are already soft; blurring the entire
    // moving surface again flattens the colors and adds a full-window GPU pass.
    if (dynamicBgType === 'flow') {
      return 'none';
    }

    if (isMicaWindowMaterial.value && dynamicBgType === 'blur') {
      return 'blur(6px)';
    }

    if (dynamicBgType === 'blur') {
      return hasWindowMaterial.value ? 'blur(20px)' : 'blur(40px)';
    }

    return 'none';
  });

  const mainContainerClass = computed(() => {
    if (theme.value.mode === 'custom' || hasWindowMaterial.value) {
      return 'bg-transparent';
    }

    return theme.value.dynamicBgType === 'flow'
      ? 'bg-white/10 dark:bg-black/10'
      : 'bg-white/30 dark:bg-black/60';
  });

  const footerBlurStyle = computed(() => mainBlurStyle.value);
  const footerContainerClass = computed(() => (
    showPlayerDetail.value ? 'bg-transparent' : mainContainerClass.value
  ));

  return {
    theme,
    mainBlurStyle,
    mainContainerClass,
    footerBlurStyle,
    footerContainerClass,
  };
}
