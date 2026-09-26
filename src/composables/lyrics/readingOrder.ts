import type { LyricsReadingOrder, LyricsSettings } from '../../types';

export type LyricsReadingRole = 'main' | 'translation' | 'roman';
export const DEFAULT_LYRICS_READING_ORDER: LyricsReadingOrder = 'main-translation-roman';

export const LYRICS_READING_ORDER_OPTIONS = [
  { value: 'main-translation-roman', label: '原文 → 翻译 → 罗马音', roles: ['main', 'translation', 'roman'] },
  { value: 'main-roman-translation', label: '原文 → 罗马音 → 翻译', roles: ['main', 'roman', 'translation'] },
  { value: 'roman-main-translation', label: '罗马音 → 原文 → 翻译', roles: ['roman', 'main', 'translation'] },
  { value: 'roman-translation-main', label: '罗马音 → 翻译 → 原文', roles: ['roman', 'translation', 'main'] },
  { value: 'translation-main-roman', label: '翻译 → 原文 → 罗马音', roles: ['translation', 'main', 'roman'] },
  { value: 'translation-roman-main', label: '翻译 → 罗马音 → 原文', roles: ['translation', 'roman', 'main'] },
] as const satisfies ReadonlyArray<{
  value: LyricsReadingOrder;
  label: string;
  roles: readonly [LyricsReadingRole, LyricsReadingRole, LyricsReadingRole];
}>;

type ReadingPreferences = Partial<Pick<LyricsSettings, 'readingOrder' | 'readingOrderOverrides'>>;

function isLyricsReadingOrder(value: unknown): value is LyricsReadingOrder {
  return LYRICS_READING_ORDER_OPTIONS.some((option) => option.value === value);
}

export function normalizeLyricsReadingOrder(value: unknown): LyricsReadingOrder {
  return isLyricsReadingOrder(value) ? value : DEFAULT_LYRICS_READING_ORDER;
}

export function normalizeLyricsReadingOrderOverrides(value: unknown): Record<string, LyricsReadingOrder> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  // Preserve exact song.path identity. Empty keys and invalid orders are not overrides.
  return Object.fromEntries(Object.entries(value).filter(([path, order]) => (
    path.trim().length > 0 && isLyricsReadingOrder(order)
  ))) as Record<string, LyricsReadingOrder>;
}

export function resolveLyricsReadingOrder(settings: ReadingPreferences, songPath?: string): LyricsReadingOrder {
  const overrides = settings.readingOrderOverrides;
  if (songPath?.trim() && overrides && typeof overrides === 'object' && !Array.isArray(overrides)
    && Object.prototype.hasOwnProperty.call(overrides, songPath)
    && isLyricsReadingOrder(overrides[songPath])) {
    return overrides[songPath];
  }
  return normalizeLyricsReadingOrder(settings.readingOrder);
}

/** Unmarked lines only: two rows omit romanization, one row is always the main lyric. */
export function getLyricsReadingRoles(
  order: unknown,
  lineCount: 1 | 2 | 3 = 3,
): LyricsReadingRole[] {
  if (lineCount === 1) return ['main'];
  const normalized = normalizeLyricsReadingOrder(order);
  const roles = LYRICS_READING_ORDER_OPTIONS.find((option) => option.value === normalized)!.roles;
  return lineCount === 2 ? roles.filter((role) => role !== 'roman') : [...roles];
}

/** The settings store replaces this complete map; null removes only this song's override. */
export function createLyricsReadingOrderOverridePatch(
  settings: ReadingPreferences,
  songPath: string,
  order: LyricsReadingOrder | null,
): Pick<LyricsSettings, 'readingOrderOverrides'> {
  const overrides = normalizeLyricsReadingOrderOverrides(settings.readingOrderOverrides);
  if (!songPath.trim()) return { readingOrderOverrides: overrides };
  if (order === null) {
    delete overrides[songPath];
    return { readingOrderOverrides: overrides };
  }
  return { readingOrderOverrides: { ...overrides, [songPath]: normalizeLyricsReadingOrder(order) } };
}
