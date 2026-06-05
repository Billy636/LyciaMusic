import { open } from '@tauri-apps/plugin-dialog';
import { ref } from 'vue';

import { normalizeForegroundStyle } from '../features/settings/store';
import { useThemeSettings } from './useThemeSettings';

export function useCustomThemeModal() {
  const { theme, patchTheme } = useThemeSettings();
  const preview = ref({
    ...theme.value.customBackground,
    foregroundStyle: normalizeForegroundStyle(theme.value.customBackground.foregroundStyle),
  });

  const handleSelectImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });

      if (selected && typeof selected === 'string') {
        preview.value.imagePath = selected;
      }
    } catch {
      // Ignore dialog cancellation.
    }
  };

  const handleSave = () => {
    if (!preview.value.imagePath) {
      return;
    }

    patchTheme({
      mode: 'custom',
      dynamicBgType: 'none',
      windowMaterial: 'none',
      customBackground: { ...preview.value },
    });
  };

  return {
    preview,
    handleSelectImage,
    handleCancel: () => undefined,
    handleSave,
  };
}
