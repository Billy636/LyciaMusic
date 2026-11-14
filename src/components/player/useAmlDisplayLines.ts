import { computed, type Ref } from 'vue';

import { applyNativeAmlDisplaySettings, type NativeAmlLyricLine } from '../../composables/lyrics/ttml';
import type { LyricsSettings } from '../../types';

/** Keep renderer data stable when the settings store replaces its whole object. */
export function useAmlDisplayLines(
  source: Readonly<Ref<NativeAmlLyricLine[]>>,
  readSettings: () => Pick<LyricsSettings, 'showTranslation' | 'showRomaji'>,
) {
  // Primitive computed values stop unrelated appearance/settings updates from
  // allocating a new line array and forcing the official player to rebuild.
  const showTranslation = computed(() => readSettings().showTranslation);
  const showRomaji = computed(() => readSettings().showRomaji);

  return computed(() => applyNativeAmlDisplaySettings(
    source.value,
    showTranslation.value,
    showRomaji.value,
  ));
}
