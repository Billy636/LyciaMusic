import { watch } from 'vue';

import { useSettings } from '../features/settings/useSettings';
import { registerImportedLyricsFonts } from './lyrics/fontUtils';

export function useImportedLyricsFonts() {
  const { settings } = useSettings();

  watch(
    () => settings.value.customLyricsFonts,
    fonts => registerImportedLyricsFonts(fonts),
    { deep: true, immediate: true },
  );
}
