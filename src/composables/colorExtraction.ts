import { MemoryCache } from '../utils/MemoryCache';

interface HslColor {
  h: number;
  s: number;
  l: number;
}

interface BucketAccumulator {
  count: number;
  rSum: number;
  gSum: number;
  bSum: number;
  sSum: number;
  lSum: number;
  hxSum: number;
  hySum: number;
}

interface PaletteCandidate extends HslColor {
  count: number;
  score: number;
}

interface ExtractColorOptions {
  colorBoost?: number;
  depth?: number;
  preserveSourceColors?: boolean;
}

export interface CoverColorProfile {
  colors: { color: string; weight: number }[];
}

interface CoverColorBucket {
  count: number;
  sSum: number;
  lSum: number;
  hxSum: number;
  hySum: number;
}

const FALLBACK_PALETTE = [
  'hsl(220, 28%, 34%)',
  'hsl(196, 58%, 56%)',
  'hsl(340, 52%, 58%)',
  'hsl(42, 72%, 60%)',
];
const SOURCE_FALLBACK_PALETTE = [
  'hsl(0, 0%, 34%)',
  'hsl(0, 0%, 52%)',
  'hsl(0, 0%, 42%)',
  'hsl(0, 0%, 62%)',
];

const CANVAS_SIZE = 56;
const SAMPLE_STEP = 2;
const DEFAULT_COUNT = 4;
const PALETTE_CACHE_LIMIT = 128;
const PALETTE_CACHE_TTL_MS = 15 * 60 * 1000;
const paletteCache = new MemoryCache<string, string[]>({
  maxEntries: PALETTE_CACHE_LIMIT,
  ttlMs: PALETTE_CACHE_TTL_MS,
});
const coverProfileCache = new MemoryCache<string, CoverColorProfile>({
  maxEntries: PALETTE_CACHE_LIMIT,
  ttlMs: PALETTE_CACHE_TTL_MS,
});
const coverProfileRequests = new Map<string, Promise<CoverColorProfile>>();
let coverProfileGeneration = 0;

export function clearPaletteCache() {
  paletteCache.clear();
  coverProfileCache.clear();
  coverProfileGeneration += 1;
  coverProfileRequests.clear();
}

function createFallbackPalette(count: number, preserveSourceColors = false): string[] {
  return (preserveSourceColors ? SOURCE_FALLBACK_PALETTE : FALLBACK_PALETTE).slice(0, count);
}

function buildPaletteCacheKey(imageUrl: string, count: number, options: ExtractColorOptions): string {
  return JSON.stringify({
    imageUrl,
    count,
    colorBoost: options.colorBoost ?? 56,
    depth: options.depth ?? 58,
    preserveSourceColors: options.preserveSourceColors ?? false,
  });
}

function getCachedPalette(cacheKey: string): string[] | undefined {
  const cached = paletteCache.get(cacheKey);
  return cached ? [...cached] : undefined;
}

function setCachedPalette(cacheKey: string, palette: string[]) {
  paletteCache.set(cacheKey, [...palette]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function normalizeHue(hue: number): number {
  const normalized = hue % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function angularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeHue(a) - normalizeHue(b));
  return Math.min(diff, 360 - diff);
}

function rgbToHsl(r: number, g: number, b: number): HslColor {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: lightness };
  }

  const delta = max - min;
  const saturation =
    lightness > 0.5
      ? delta / (2 - max - min)
      : delta / (max + min);

  let hue = 0;
  if (max === rNorm) {
    hue = (gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0);
  } else if (max === gNorm) {
    hue = (bNorm - rNorm) / delta + 2;
  } else {
    hue = (rNorm - gNorm) / delta + 4;
  }

  return {
    h: normalizeHue((hue / 6) * 360),
    s: saturation,
    l: lightness,
  };
}

function getBucketKey(color: HslColor): string {
  const lightBucket = Math.round(color.l * 4);

  if (color.s < 0.12) {
    return `neutral-${lightBucket}`;
  }

  const hueBucket = Math.round(normalizeHue(color.h) / 18);
  const satBucket = Math.round(color.s * 5);
  return `${hueBucket}-${satBucket}-${lightBucket}`;
}

function createCandidate(bucket: BucketAccumulator): PaletteCandidate {
  const averageHue = normalizeHue((Math.atan2(bucket.hySum, bucket.hxSum) * 180) / Math.PI);
  const averageSaturation = bucket.sSum / bucket.count;
  const averageLightness = bucket.lSum / bucket.count;
  const midtoneAffinity = 1 - Math.min(1, Math.abs(averageLightness - 0.5) / 0.5) * 0.45;
  const saturationWeight = 0.78 + averageSaturation * 1.4;
  const neutralPenalty = averageSaturation < 0.12 ? 0.52 : 1;
  const extremePenalty = averageLightness < 0.08 || averageLightness > 0.92 ? 0.3 : 1;

  return {
    h: averageHue,
    s: averageSaturation,
    l: averageLightness,
    count: bucket.count,
    score: bucket.count * saturationWeight * midtoneAffinity * neutralPenalty * extremePenalty,
  };
}

function polishColor(candidate: HslColor, role: number, colorBoost: number, depth: number): string {
  const hue = Math.round(normalizeHue(candidate.h));
  const saturation = candidate.s * 100;
  const lightness = candidate.l * 100;
  const boost = clamp(colorBoost / 100, 0, 1);
  const depthFactor = clamp(depth / 100, 0, 1);

  if (role === 0) {
    const refinedSaturation = saturation < 14
      ? lerp(18, 30, boost)
      : clamp(saturation * lerp(0.84, 1.02, boost) + lerp(8, 18, boost), 24, lerp(50, 68, boost));
    const refinedLightness = clamp(
      lightness * lerp(0.84, 0.58, depthFactor) + lerp(10, 4, depthFactor),
      lerp(32, 18, depthFactor),
      lerp(54, 38, depthFactor),
    );

    return `hsl(${hue}, ${Math.round(refinedSaturation)}%, ${Math.round(refinedLightness)}%)`;
  }

  const refinedSaturation = saturation < 14
    ? lerp(24 + role * 6, 36 + role * 5, boost)
    : clamp(
      saturation * lerp(0.9, 1.08, boost) + lerp(12, 22, boost),
      lerp(34, 42, boost),
      lerp(66, 82, boost),
    );
  const refinedLightness = clamp(
    lightness * lerp(0.9, 0.7, depthFactor) + lerp(12 + role * 2, 8 + role, depthFactor),
    lerp(46, 34, depthFactor),
    lerp(72, 58, depthFactor),
  );

  return `hsl(${hue}, ${Math.round(refinedSaturation)}%, ${Math.round(refinedLightness)}%)`;
}

function createDerivedAccent(anchor: HslColor, role: number, colorBoost: number, depth: number): string {
  const hueShifts = [24, -28, 52, -58];
  const lightnessShifts = [10, 4, 14, 8];
  const shift = hueShifts[(role - 1) % hueShifts.length];
  const lightnessShift = lightnessShifts[(role - 1) % lightnessShifts.length];
  const saturationBase = anchor.s * 100;
  const lightnessBase = anchor.l * 100;
  const boost = clamp(colorBoost / 100, 0, 1);
  const depthFactor = clamp(depth / 100, 0, 1);

  const hue = Math.round(normalizeHue(anchor.h + shift));
  const saturation = saturationBase < 12
    ? lerp(30 + role * 4, 40 + role * 4, boost)
    : clamp(saturationBase * lerp(0.88, 1.02, boost) + lerp(16, 26, boost), 40, lerp(68, 84, boost));
  const lightness = clamp(
    lightnessBase * lerp(0.92, 0.74, depthFactor) + lerp(lightnessShift, lightnessShift - 6, depthFactor),
    lerp(48, 34, depthFactor),
    lerp(70, 56, depthFactor),
  );

  return `hsl(${hue}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}

function selectPalette(candidates: PaletteCandidate[], count: number): HslColor[] {
  if (candidates.length === 0) {
    return [];
  }

  const remaining = [...candidates].sort((a, b) => b.score - a.score);
  const selected: PaletteCandidate[] = [remaining.shift() as PaletteCandidate];

  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const minGap = selected.reduce((closest, current) => {
        const hueGap = angularDistance(candidate.h, current.h) / 180;
        const saturationGap = Math.abs(candidate.s - current.s);
        const lightnessGap = Math.abs(candidate.l - current.l);
        const distance = hueGap * 0.65 + saturationGap * 0.2 + lightnessGap * 0.15;
        return Math.min(closest, distance);
      }, Number.POSITIVE_INFINITY);

      const diversifiedScore = candidate.score * (0.8 + minGap * 1.85);
      if (diversifiedScore > bestScore) {
        bestScore = diversifiedScore;
        bestIndex = index;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected.slice(0, count);
}

function createSourcePalette(selected: HslColor[], count: number): string[] {
  if (selected.length === 0) {
    return createFallbackPalette(count, true);
  }

  const palette = [...selected];
  while (palette.length < count) {
    const role = palette.length;
    const anchor = selected[role % selected.length];
    const direction = anchor.l < 0.28 ? 1 : anchor.l > 0.72 ? -1 : role % 2 === 0 ? -1 : 1;

    // Sparse/monochrome covers get lightness variants, never invented hues or saturation.
    palette.push({
      ...anchor,
      l: clamp(anchor.l + direction * Math.min(0.24, 0.08 + role * 0.05), 0, 1),
    });
  }

  return palette.slice(0, count).map(color => (
    `hsl(${Math.round(normalizeHue(color.h))}, ${Math.round(color.s * 100)}%, ${Math.round(color.l * 100)}%)`
  ));
}

export async function extractDominantColors(
  imageUrl: string,
  count: number = DEFAULT_COUNT,
  options: ExtractColorOptions = {},
): Promise<string[]> {
  const cacheKey = buildPaletteCacheKey(imageUrl, count, options);
  const cachedPalette = getCachedPalette(cacheKey);
  if (cachedPalette) {
    return cachedPalette;
  }

  return new Promise(resolve => {
    const colorBoost = options.colorBoost ?? 56;
    const depth = options.depth ?? 58;
    const preserveSourceColors = options.preserveSourceColors ?? false;
    const image = new Image();
    let canvas: HTMLCanvasElement | null = null;
    let settled = false;

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      image.src = '';

      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas = null;
      }
    };

    const finish = (palette: string[]) => {
      if (settled) {
        return;
      }

      settled = true;
      setCachedPalette(cacheKey, palette);
      cleanup();
      resolve(palette);
    };

    image.onload = () => {
      try {
        canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          finish(createFallbackPalette(count, preserveSourceColors));
          return;
        }

        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        context.drawImage(image, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

        const imageData = context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
        const buckets = new Map<string, BucketAccumulator>();

        for (let y = 0; y < CANVAS_SIZE; y += SAMPLE_STEP) {
          for (let x = 0; x < CANVAS_SIZE; x += SAMPLE_STEP) {
            const offset = (y * CANVAS_SIZE + x) * 4;
            const alpha = imageData[offset + 3];
            if (alpha < 160) {
              continue;
            }

            const red = imageData[offset];
            const green = imageData[offset + 1];
            const blue = imageData[offset + 2];
            const hsl = rgbToHsl(red, green, blue);

            if (!preserveSourceColors && (hsl.l < 0.02 || hsl.l > 0.98)) {
              continue;
            }

            const key = getBucketKey(hsl);
            const bucket = buckets.get(key) ?? {
              count: 0,
              rSum: 0,
              gSum: 0,
              bSum: 0,
              sSum: 0,
              lSum: 0,
              hxSum: 0,
              hySum: 0,
            };

            bucket.count += 1;
            bucket.rSum += red;
            bucket.gSum += green;
            bucket.bSum += blue;
            bucket.sSum += hsl.s;
            bucket.lSum += hsl.l;
            bucket.hxSum += Math.cos((hsl.h * Math.PI) / 180);
            bucket.hySum += Math.sin((hsl.h * Math.PI) / 180);

            buckets.set(key, bucket);
          }
        }

        const candidates = [...buckets.values()]
          .map(createCandidate)
          .filter(candidate => candidate.count > 3)
          .sort((a, b) => b.score - a.score);

        if (candidates.length === 0) {
          finish(createFallbackPalette(count, preserveSourceColors));
          return;
        }

        const selected = selectPalette(candidates, count);
        if (preserveSourceColors) {
          finish(createSourcePalette(selected, count));
          return;
        }

        const polished = selected.map((candidate, index) => polishColor(candidate, index, colorBoost, depth));
        const anchor = selected[0] ?? { h: 220, s: 0.35, l: 0.38 };

        while (polished.length < count) {
          polished.push(createDerivedAccent(anchor, polished.length, colorBoost, depth));
        }

        finish(polished.slice(0, count));
      } catch {
        finish(createFallbackPalette(count, preserveSourceColors));
      }
    };

    image.onerror = () => {
      finish(createFallbackPalette(count, preserveSourceColors));
    };

    image.crossOrigin = 'Anonymous';
    image.src = imageUrl;
  });
}

function cloneCoverColorProfile(profile: CoverColorProfile): CoverColorProfile {
  return { colors: profile.colors.map(color => ({ ...color })) };
}

function createNeutralCoverProfile(): CoverColorProfile {
  return { colors: [{ color: 'hsl(0, 0%, 50%)', weight: 1 }] };
}

function getCoverBucketHue(bucket: CoverColorBucket): number {
  return normalizeHue((Math.atan2(bucket.hySum, bucket.hxSum) * 180) / Math.PI);
}

function mergeCoverHueBuckets(buckets: CoverColorBucket[]): CoverColorBucket[] {
  const merged = buckets.map(bucket => ({ ...bucket }));

  // Merge neighboring hues across brightness/saturation and across the 0°/360° boundary.
  // Counts, rather than saturation, determine both the merged hue and its area.
  while (merged.length > 1) {
    let closestDistance = 24;
    let closestPair: [number, number] | undefined;
    for (let first = 0; first < merged.length - 1; first += 1) {
      for (let second = first + 1; second < merged.length; second += 1) {
        const distance = angularDistance(getCoverBucketHue(merged[first]), getCoverBucketHue(merged[second]));
        if (distance <= closestDistance) {
          closestDistance = distance;
          closestPair = [first, second];
        }
      }
    }

    if (!closestPair) {
      break;
    }

    const [first, second] = closestPair;
    const target = merged[first];
    const source = merged[second];
    target.count += source.count;
    target.sSum += source.sSum;
    target.lSum += source.lSum;
    target.hxSum += source.hxSum;
    target.hySum += source.hySum;
    merged.splice(second, 1);
  }

  return merged;
}

function createCoverColorProfile(pixels: Uint8ClampedArray): CoverColorProfile {
  const hueBuckets = new Map<number, CoverColorBucket>();
  const neutral: CoverColorBucket = { count: 0, sSum: 0, lSum: 0, hxSum: 0, hySum: 0 };
  let neutralRedSum = 0;
  let neutralGreenSum = 0;
  let neutralBlueSum = 0;
  let sampleCount = 0;

  for (let y = 0; y < CANVAS_SIZE; y += SAMPLE_STEP) {
    for (let x = 0; x < CANVAS_SIZE; x += SAMPLE_STEP) {
      const offset = (y * CANVAS_SIZE + x) * 4;
      if (pixels[offset + 3] < 160) {
        continue;
      }

      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const color = rgbToHsl(red, green, blue);
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      sampleCount += 1;

      // Near-black/white hue noise should stay neutral even when HSL saturation is high.
      const nearBlackOrWhite = color.l < 0.08 || color.l > 0.94;
      if (color.s < 0.12 || chroma < 10 || (nearBlackOrWhite && chroma < 24)) {
        neutral.count += 1;
        neutralRedSum += red;
        neutralGreenSum += green;
        neutralBlueSum += blue;
        continue;
      }

      const key = Math.round(color.h / 18) % 20;
      const bucket = hueBuckets.get(key) ?? { count: 0, sSum: 0, lSum: 0, hxSum: 0, hySum: 0 };
      bucket.count += 1;
      bucket.sSum += color.s;
      bucket.lSum += color.l;
      bucket.hxSum += Math.cos((color.h * Math.PI) / 180);
      bucket.hySum += Math.sin((color.h * Math.PI) / 180);
      hueBuckets.set(key, bucket);
    }
  }

  if (sampleCount === 0) {
    return createNeutralCoverProfile();
  }

  const groups = mergeCoverHueBuckets([...hueBuckets.values()]);
  const colors = groups.map(bucket => ({
    color: `hsl(${Math.round(getCoverBucketHue(bucket))}, ${Math.round(bucket.sSum / bucket.count * 100)}%, ${Math.round(bucket.lSum / bucket.count * 100)}%)`,
    weight: bucket.count / sampleCount,
  }));
  if (neutral.count > 0) {
    const neutralColor = rgbToHsl(
      neutralRedSum / neutral.count,
      neutralGreenSum / neutral.count,
      neutralBlueSum / neutral.count,
    );
    colors.push({
      color: `hsl(${Math.round(neutralColor.h)}, ${Math.round(Math.min(neutralColor.s, 0.11) * 100)}%, ${Math.round(neutralColor.l * 100)}%)`,
      weight: neutral.count / sampleCount,
    });
  }

  return { colors: colors.sort((first, second) => second.weight - first.weight) };
}

/** Extract actual cover area shares without the contrast/accent scoring used by other backgrounds. */
export async function extractCoverColorProfile(imageUrl: string): Promise<CoverColorProfile> {
  if (!imageUrl) {
    return createNeutralCoverProfile();
  }

  const cached = coverProfileCache.get(imageUrl);
  if (cached) {
    return cloneCoverColorProfile(cached);
  }

  const existingRequest = coverProfileRequests.get(imageUrl);
  if (existingRequest) {
    return cloneCoverColorProfile(await existingRequest);
  }

  const generation = coverProfileGeneration;
  const request = new Promise<CoverColorProfile>(resolve => {
    const image = new Image();
    let canvas: HTMLCanvasElement | null = null;
    let settled = false;

    const finish = (profile: CoverColorProfile) => {
      if (settled) {
        return;
      }

      settled = true;
      if (generation === coverProfileGeneration) {
        coverProfileCache.set(imageUrl, cloneCoverColorProfile(profile));
      }
      image.onload = null;
      image.onerror = null;
      image.src = '';
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas = null;
      }
      resolve(profile);
    };

    image.onload = () => {
      try {
        canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          finish(createNeutralCoverProfile());
          return;
        }

        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        context.drawImage(image, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        finish(createCoverColorProfile(context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data));
      } catch {
        finish(createNeutralCoverProfile());
      }
    };
    image.onerror = () => finish(createNeutralCoverProfile());
    image.crossOrigin = 'Anonymous';
    image.src = imageUrl;
  });

  coverProfileRequests.set(imageUrl, request);
  try {
    return cloneCoverColorProfile(await request);
  } finally {
    if (coverProfileRequests.get(imageUrl) === request) {
      coverProfileRequests.delete(imageUrl);
    }
  }
}
