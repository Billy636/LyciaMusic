import { onScopeDispose, reactive, watch } from 'vue';

import {
  DEFAULT_PLAYER_TRANSLATION_FONT_SCALE,
  MAX_PLAYER_FONT_SCALE,
  MAX_PLAYER_LINE_GAP,
  MAX_PLAYER_OFFSET_X,
  MAX_PLAYER_OFFSET_Y,
  MAX_PLAYER_TRANSLATION_FONT_SCALE,
  MIN_PLAYER_FONT_SCALE,
  MIN_PLAYER_LINE_GAP,
  MIN_PLAYER_OFFSET_X,
  MIN_PLAYER_OFFSET_Y,
  MIN_PLAYER_TRANSLATION_FONT_SCALE,
} from '../../composables/lyrics/constants';
import type { LyricsSettings } from '../../types';

export type LyricsAppearanceDraft = Pick<
  LyricsSettings,
  'playerFontScale' | 'playerLineGap' | 'playerOffsetX' | 'playerOffsetY'
> & Partial<Pick<LyricsSettings, 'playerTranslationFontScale'>>;

type DraftKey = keyof LyricsAppearanceDraft;

export const LYRICS_APPEARANCE_COMMIT_DELAY_MS = 180;

const DRAFT_LIMITS: Record<DraftKey, { min: number; max: number; decimals: number }> = {
  playerFontScale: { min: MIN_PLAYER_FONT_SCALE, max: MAX_PLAYER_FONT_SCALE, decimals: 2 },
  playerTranslationFontScale: {
    min: MIN_PLAYER_TRANSLATION_FONT_SCALE,
    max: MAX_PLAYER_TRANSLATION_FONT_SCALE,
    decimals: 2,
  },
  playerLineGap: { min: MIN_PLAYER_LINE_GAP, max: MAX_PLAYER_LINE_GAP, decimals: 2 },
  playerOffsetX: { min: MIN_PLAYER_OFFSET_X, max: MAX_PLAYER_OFFSET_X, decimals: 0 },
  playerOffsetY: { min: MIN_PLAYER_OFFSET_Y, max: MAX_PLAYER_OFFSET_Y, decimals: 0 },
};
const DRAFT_KEYS = Object.keys(DRAFT_LIMITS) as DraftKey[];

export function readLyricsAppearanceDraft(settings: LyricsAppearanceDraft): Required<LyricsAppearanceDraft> {
  return {
    playerFontScale: settings.playerFontScale,
    playerTranslationFontScale: settings.playerTranslationFontScale ?? DEFAULT_PLAYER_TRANSLATION_FONT_SCALE,
    playerLineGap: settings.playerLineGap,
    playerOffsetX: settings.playerOffsetX,
    playerOffsetY: settings.playerOffsetY,
  };
}

/** Keep slider previews local; persist a single patch after interaction settles. */
export function useLyricsAppearanceDraft(
  readSettings: () => LyricsAppearanceDraft,
  persist: (patch: Partial<LyricsAppearanceDraft>) => void,
  onPreview: (draft: Required<LyricsAppearanceDraft>) => void,
) {
  const draft = reactive(readLyricsAppearanceDraft(readSettings()));
  let commitTimer: ReturnType<typeof setTimeout> | undefined;

  function clearCommitTimer() {
    if (commitTimer === undefined) return;
    clearTimeout(commitTimer);
    commitTimer = undefined;
  }

  function commit() {
    clearCommitTimer();
    const settings = readLyricsAppearanceDraft(readSettings());
    const patch: Partial<LyricsAppearanceDraft> = {};
    for (const key of DRAFT_KEYS) {
      if (draft[key] !== settings[key]) patch[key] = draft[key];
    }
    if (Object.keys(patch).length > 0) persist(patch);
  }

  function setField(key: DraftKey, value: number, immediately = true) {
    if (!Number.isFinite(value)) return;
    const limits = DRAFT_LIMITS[key];
    draft[key] = Number(Math.min(limits.max, Math.max(limits.min, value)).toFixed(limits.decimals));
    clearCommitTimer();
    if (immediately) {
      commit();
    } else {
      commitTimer = setTimeout(commit, LYRICS_APPEARANCE_COMMIT_DELAY_MS);
    }
  }

  // Observe fields separately so an external update cannot discard an unrelated pending slider.
  for (const key of DRAFT_KEYS) {
    watch(() => readLyricsAppearanceDraft(readSettings())[key], (value) => {
      draft[key] = value;
    }, { flush: 'sync' });
  }
  watch(() => DRAFT_KEYS.map((key) => draft[key]), () => {
    onPreview(readLyricsAppearanceDraft(draft));
  }, { immediate: true, flush: 'sync' });

  onScopeDispose(commit);
  return { draft, setField, commit };
}
