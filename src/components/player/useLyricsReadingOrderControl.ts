import { computed, ref, watch } from 'vue';

import {
  createLyricsReadingOrderOverridePatch,
  DEFAULT_LYRICS_READING_ORDER,
  getLyricsReadingRoles,
  LYRICS_READING_ORDER_OPTIONS,
  normalizeLyricsReadingOrder,
  resolveLyricsReadingOrder,
} from '../../composables/lyrics/readingOrder';
import type { LyricsReadingOrder, LyricsSettings } from '../../types';

type ReadingPreferences = Pick<LyricsSettings, 'readingOrder' | 'readingOrderOverrides'>;
export type LyricsReadingOrderScope = 'song' | 'default';

/** Immediate scoped settings updates; no delayed write can follow a song change. */
export function useLyricsReadingOrderControl(
  readSettings: () => ReadingPreferences,
  readSongPath: () => string,
  persist: (patch: Partial<ReadingPreferences>) => void,
) {
  const songPath = computed(readSongPath);
  const hasSong = computed(() => songPath.value.trim().length > 0);
  const scope = ref<LyricsReadingOrderScope>('default');
  const expanded = ref(false);
  const selectionToken = ref(0);
  let selectionTarget: { path: string; scope: LyricsReadingOrderScope } | null = null;

  const hasSongOverride = computed(() => hasSong.value
    && Object.prototype.hasOwnProperty.call(readSettings().readingOrderOverrides, songPath.value));
  const selectedOrder = computed(() => scope.value === 'song'
    ? resolveLyricsReadingOrder(readSettings(), songPath.value)
    : normalizeLyricsReadingOrder(readSettings().readingOrder));
  const selectedOption = computed(() => LYRICS_READING_ORDER_OPTIONS
    .find((option) => option.value === selectedOrder.value)!);
  const twoLineRoles = computed(() => getLyricsReadingRoles(selectedOrder.value, 2));
  const canReset = computed(() => scope.value === 'song'
    ? hasSongOverride.value
    : selectedOrder.value !== DEFAULT_LYRICS_READING_ORDER);

  function closeOptions() {
    expanded.value = false;
    selectionTarget = null;
  }

  function openOptions() {
    selectionTarget = { path: songPath.value, scope: scope.value };
    selectionToken.value += 1;
    expanded.value = true;
  }

  function setScope(value: LyricsReadingOrderScope) {
    closeOptions();
    scope.value = value === 'song' && !hasSong.value ? 'default' : value;
  }

  function selectOrder(value: LyricsReadingOrder, token: number) {
    if (!expanded.value || token !== selectionToken.value || !selectionTarget
      || selectionTarget.path !== songPath.value || selectionTarget.scope !== scope.value) return false;

    const order = normalizeLyricsReadingOrder(value);
    const settings = readSettings();
    if (scope.value === 'default') {
      if (normalizeLyricsReadingOrder(settings.readingOrder) !== order) persist({ readingOrder: order });
    } else {
      if (!hasSong.value) return false;
      if (!hasSongOverride.value || settings.readingOrderOverrides[songPath.value] !== order) {
        persist(createLyricsReadingOrderOverridePatch(settings, songPath.value, order));
      }
    }
    return true;
  }

  function reset(expectedSongPath: string, expectedScope: LyricsReadingOrderScope) {
    // A button rendered for the previous track must never clear the next track.
    if (songPath.value !== expectedSongPath || scope.value !== expectedScope || !canReset.value) return false;
    closeOptions();
    if (scope.value === 'song') {
      persist(createLyricsReadingOrderOverridePatch(readSettings(), songPath.value, null));
    } else {
      persist({ readingOrder: DEFAULT_LYRICS_READING_ORDER });
    }
    return true;
  }

  watch(songPath, (path) => {
    closeOptions();
    if (!path.trim()) scope.value = 'default';
  }, { flush: 'sync' });

  return {
    songPath, hasSong, scope, expanded, selectionToken, hasSongOverride,
    selectedOrder, selectedOption, twoLineRoles, canReset,
    openOptions, closeOptions, setScope, selectOrder, reset,
  };
}
