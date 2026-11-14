import type { CoverColorProfile } from '../../composables/colorExtraction';
import type { PlayerBackgroundPalette } from '../../types';

interface Tone {
  h: number;
  s: number;
  l: number;
}

interface CoverTone extends Tone {
  weight: number;
}

export interface PlayerBackgroundColors {
  key: string;
  base: string;
  end: string;
  left: string;
  glow: string;
  accent: string;
  quiet: string;
}

type ToneSet = readonly [Tone, Tone, Tone];

const PRESETS: Record<Exclude<PlayerBackgroundPalette, 'cover'>, ToneSet> = {
  indigo: [{ h: 235, s: 45, l: 40 }, { h: 275, s: 36, l: 40 }, { h: 190, s: 46, l: 45 }],
  rose: [{ h: 350, s: 38, l: 40 }, { h: 17, s: 42, l: 40 }, { h: 35, s: 48, l: 45 }],
  teal: [{ h: 187, s: 40, l: 40 }, { h: 220, s: 43, l: 40 }, { h: 165, s: 36, l: 45 }],
};
const NEUTRAL_TONE: Tone = { h: 0, s: 0, l: 40 };
const MINIMUM_COLOR_AREA = 0.04;
const MINIMUM_SECONDARY_SHARE = 0.25;
const DISTINCT_HUE_GAP = 28;
const HSL_PATTERN = /^hsl\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:deg)?(?:\s*,\s*|\s+)([+-]?(?:\d+(?:\.\d*)?|\.\d+))%(?:\s*,\s*|\s+)([+-]?(?:\d+(?:\.\d*)?|\.\d+))%\s*\)$/i;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeHue(value: number): number {
  return ((value % 360) + 360) % 360;
}

function hueDistance(first: number, second: number): number {
  const distance = Math.abs(normalizeHue(first) - normalizeHue(second));
  return Math.min(distance, 360 - distance);
}

function parseTone(color: string): Tone | null {
  const match = color.trim().match(HSL_PATTERN);
  if (!match) return null;
  const h = Number(match[1]);
  const s = Number(match[2]);
  const l = Number(match[3]);
  if (![h, s, l].every(Number.isFinite)) return null;
  return { h: normalizeHue(h), s: clamp(s, 0, 100), l: clamp(l, 0, 100) };
}

function isNeutral(tone: Tone): boolean {
  const chroma = (1 - Math.abs(2 * tone.l / 100 - 1)) * tone.s / 100;
  // HSL hue can be vivid numerical noise close to black/white. Match the
  // actual-area extractor's chroma guard before normalizing background tones.
  return tone.s < 12 || chroma < 10 / 255
    || ((tone.l < 8 || tone.l > 94) && chroma < 24 / 255);
}

function readCoverTones(profile: CoverColorProfile): CoverTone[] {
  const entries: CoverTone[] = [];
  const weights: number[] = [];
  for (const entry of Array.isArray(profile?.colors) ? profile.colors : []) {
    if (!entry || !Number.isFinite(entry.weight) || entry.weight <= 0) continue;
    weights.push(entry.weight);
    if (typeof entry.color !== 'string') continue;
    const parsed = parseTone(entry.color);
    if (!parsed) continue;
    const tone = isNeutral(parsed) ? { ...parsed, h: 0, s: 0 } : parsed;
    entries.push({ ...tone, weight: entry.weight });
  }
  if (!entries.length) return [];

  // Normalize area shares without overflowing on malformed large weights.
  // Never promote a tiny saturated swatch with a separate colorfulness score.
  const maximumWeight = weights.reduce((maximum, weight) => Math.max(maximum, weight), 0);
  const total = weights.reduce((sum, weight) => sum + weight / maximumWeight, 0);
  // Missing/invalid source colors must not inflate a small remaining swatch.
  const divisor = Math.max(total, 1 / maximumWeight);
  return entries
    .map(entry => ({ ...entry, weight: entry.weight / maximumWeight / divisor }))
    .filter(entry => entry.weight >= MINIMUM_COLOR_AREA)
    .sort((first, second) => second.weight - first.weight || first.h - second.h || first.s - second.s || first.l - second.l);
}

function coverTones(profile: CoverColorProfile): ToneSet {
  const entries = readCoverTones(profile);
  const anchor = entries[0];
  if (!anchor) return [NEUTRAL_TONE, NEUTRAL_TONE, NEUTRAL_TONE];

  const first: Tone = {
    h: anchor.h,
    s: anchor.s === 0 ? 0 : clamp(anchor.s, 30, 48),
    l: 40,
  };
  const sibling = entries.slice(1).find(entry => (
    entry.weight >= anchor.weight * MINIMUM_SECONDARY_SHARE
    && (first.s === 0 ? entry.s > 0 : entry.s === 0 || hueDistance(entry.h, first.h) > DISTINCT_HUE_GAP)
  ));
  const second: Tone = sibling ?? {
    h: normalizeHue(first.h - 28),
    s: first.s * 0.85,
    l: 40,
  };
  const third: Tone = {
    h: normalizeHue(first.h + 24),
    s: first.s === 0 ? 0 : first.s + 6,
    l: 45,
  };
  return [first, second, third];
}

function relativeLuminance(tone: Tone): number {
  const saturation = tone.s / 100;
  const lightness = tone.l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = normalizeHue(tone.h) / 60;
  const secondary = chroma * (1 - Math.abs(sector % 2 - 1));
  const channels = sector < 1 ? [chroma, secondary, 0]
    : sector < 2 ? [secondary, chroma, 0]
      : sector < 3 ? [0, chroma, secondary]
        : sector < 4 ? [0, secondary, chroma]
          : sector < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
  const offset = lightness - chroma / 2;
  const linear = channels.map(channel => {
    const value = channel + offset;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function saturationOffset(tone: Tone, offset: number): number {
  return tone.s === 0 ? 0 : tone.s + offset;
}

function backgroundColor(h: number, s: number, l: number, ceiling: number): string {
  const tone = {
    h: s === 0 ? 0 : normalizeHue(Math.round(normalizeHue(h) * 10) / 10),
    s: Math.round((s === 0 ? 0 : clamp(s, 20, 58)) * 10) / 10,
    l: clamp(l, 0, 100),
  };
  // These are new colored surfaces, not a black layer on top of artwork.
  // Keep the accepted preview's tone targets and bound luminance beforehand.
  while (relativeLuminance(tone) > ceiling && tone.l > 0) tone.l = Math.max(0, tone.l - 0.25);
  tone.l = Math.round(tone.l * 10) / 10;
  // Check the serialized precision too, so rounding cannot lift the ceiling.
  if (relativeLuminance(tone) > ceiling) tone.l = Math.max(0, tone.l - 0.1);
  return `hsl(${tone.h.toFixed(1)} ${tone.s.toFixed(1)}% ${tone.l.toFixed(1)}%)`;
}

function lightBackgroundColor(h: number, s: number, l: number): string {
  const tone = { h, s: s === 0 ? 0 : clamp(s, 20, 58), l };
  // Keep saturated color fields bright enough for the main window's dark text.
  while (relativeLuminance(tone) < 0.32 && tone.l < 100) tone.l += 0.25;
  return backgroundColor(tone.h, tone.s, tone.l, 1);
}

/** Use the same cover hues with tone targets suited to each foreground. */
export function createPlayerBackgroundPalette(
  choice: PlayerBackgroundPalette,
  profile: CoverColorProfile,
  light = false,
): PlayerBackgroundColors {
  const [first, second, third] = choice === 'cover'
    ? coverTones(profile)
    : PRESETS[choice === 'rose' || choice === 'teal' ? choice : 'indigo'];
  const colors = light ? {
    base: lightBackgroundColor(first.h, saturationOffset(first, 6), 73),
    end: lightBackgroundColor(second.h, saturationOffset(second, 6), 68),
    left: lightBackgroundColor(third.h, saturationOffset(third, 8), 70),
    glow: lightBackgroundColor(first.h - 12, saturationOffset(first, 7), 82),
    accent: lightBackgroundColor(second.h, saturationOffset(second, 10), 65),
    quiet: lightBackgroundColor(first.h + 12, first.s, 72),
  } : {
    base: backgroundColor(first.h, first.s, 36, 0.105),
    end: backgroundColor(second.h, second.s, 33, 0.075),
    left: backgroundColor(third.h, third.s, 47, 0.21),
    glow: backgroundColor(first.h - 12, saturationOffset(first, 7), 56, 0.24),
    accent: backgroundColor(second.h, saturationOffset(second, 6), 43, 0.14),
    quiet: backgroundColor(first.h + 12, saturationOffset(first, -5), 36, 0.105),
  };
  // Key the transition by visible CSS colors, not cover URL or noisy raw input.
  return { key: Object.values(colors).join(':'), ...colors };
}
