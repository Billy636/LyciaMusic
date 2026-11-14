import type { CoverColorProfile } from '../../composables/colorExtraction';

interface HslColor {
  hue: number;
  saturation: number;
  lightness: number;
}

export interface MistPalette {
  base: string;
  glow: string;
  shade: string;
  glowOpacity: number;
  shadeOpacity: number;
}

const NEUTRAL_COLOR: HslColor = { hue: 0, saturation: 0, lightness: 50 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseHsl(color: string): HslColor | null {
  const values = color.match(/^hsla?\(\s*(-?[\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i);
  if (!values) return null;
  const [hue, saturation, lightness] = values.slice(1).map(Number);
  if (![hue, saturation, lightness].every(Number.isFinite)) return null;
  return {
    hue: ((hue % 360) + 360) % 360,
    saturation: clamp(saturation, 0, 100),
    lightness: clamp(lightness, 0, 100),
  };
}

function formatHsl(hue: number, saturation: number, lightness: number) {
  return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}

export function createMistPalette(profile: CoverColorProfile, dark = false, immersive = false): MistPalette {
  const candidates = profile.colors.flatMap(({ color, weight }) => {
    const parsed = parseHsl(color);
    return parsed && Number.isFinite(weight) && weight > 0 ? [{ ...parsed, weight }] : [];
  }).sort((first, second) => second.weight - first.weight);
  // Preserve the largest cover area as the base, including black, white and gray.
  // Secondary hues belong to separate light fields and retain their absolute area.
  const anchor = candidates[0] ?? { ...NEUTRAL_COLOR, weight: 1 };
  const accents = candidates.slice(1).filter(color => color.weight >= 0.04);
  const glow = accents[0] ?? anchor;
  const shade = accents[1] ?? anchor;
  const mistSaturation = (color: HslColor) => color.saturation >= 12
    ? dark
      ? clamp(6 + color.saturation * 0.4, 12, 36)
      : immersive
        ? clamp(8 + color.saturation * 0.42, 14, 36)
        : clamp(8 + color.saturation * 0.46, 14, 40)
    : Math.min(6, color.saturation * 0.5);
  // Keep each cover's brightness differences while respecting foreground text.
  const mistLightness = (color: HslColor) => dark
    ? clamp(16 + color.lightness * 0.14, 16, 30)
    : immersive
      ? clamp(32 + color.lightness * 0.19, 34, 51)
      : clamp(64 + color.lightness * 0.2, 64, 82);
  // A real secondary color keeps more depth than the same-hue white highlight.
  const glowLift = accents[0] ? (dark ? 6 : 4) : (dark ? 10 : immersive ? 7 : 12);
  const glowLightness = clamp(mistLightness(glow) + glowLift, 0, dark ? 44 : immersive ? 58 : 94);
  const shadeLightness = Math.max(dark ? 9 : immersive ? 25 : 50, mistLightness(shade) - (dark || immersive ? 8 : 10));
  const glowOpacity = accents[0]
    ? (dark ? 0.5 : immersive ? 0.58 : 0.68) * clamp(glow.weight / 0.5, 0, 1)
    : dark ? 0.28 : 0.42;
  const shadeOpacity = accents[1]
    ? (dark ? 0.3 : 0.4) * clamp(shade.weight / 0.5, 0, 1)
    : dark ? 0.14 : 0.18;

  return {
    base: formatHsl(anchor.hue, mistSaturation(anchor), mistLightness(anchor)),
    glow: formatHsl(glow.hue, mistSaturation(glow) * 0.85, glowLightness),
    shade: formatHsl(shade.hue, mistSaturation(shade) * 0.9, shadeLightness),
    glowOpacity,
    shadeOpacity,
  };
}
