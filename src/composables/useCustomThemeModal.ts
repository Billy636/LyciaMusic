import { open } from '@tauri-apps/plugin-dialog';
import { ref } from 'vue';

import { normalizeForegroundStyle } from '../features/settings/store';
import { resolveCustomBackgroundMediaType } from './customBackgroundMedia';
import { useThemeSettings } from './useThemeSettings';

export function useCustomThemeModal() {
  const { theme, patchTheme } = useThemeSettings();
  const preview = ref({
    ...theme.value.customBackground,
    foregroundStyle: normalizeForegroundStyle(theme.value.customBackground.foregroundStyle),
  });

  const handleSelectMedia = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
          { name: '视频', extensions: ['mp4', 'webm'] },
        ],
      });

      if (selected && typeof selected === 'string') {
        return {
          path: selected,
          mediaType: resolveCustomBackgroundMediaType(selected),
        };
      }
    } catch {
      // Ignore dialog cancellation.
    }

    return null;
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
    handleSelectMedia,
    handleCancel: () => undefined,
    handleSave,
  };
}
