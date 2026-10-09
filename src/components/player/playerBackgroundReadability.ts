/** A region in CSS pixels, relative to the background viewport. */
export interface BackgroundRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PlayerForeground = 'light' | 'dark';

export interface PlayerBackgroundSample {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  viewport: { width: number; height: number };
}

interface RegionLuminances {
  luminances: Float64Array;
  weights: Float64Array;
  columns: number;
  rows: number;
}

const SAMPLE_EDGE = 96;
const REGION_SAMPLE_EDGE = 12;
const IMAGE_TIMEOUT_MS = 5000;
const BRIGHT_REGION_THRESHOLD = 0.21;
const ENTER_DARK_THRESHOLD = 0.24;
const EXIT_DARK_THRESHOLD = 0.18;
const CHROME_SWITCH_MARGIN = 1.1;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const LINEAR_CHANNELS = Float64Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});
const DARK_LUMINANCE = LINEAR_CHANNELS[12] * 0.2126 + LINEAR_CHANNELS[16] * 0.7152 + LINEAR_CHANNELS[23] * 0.0722;

function chooseLyricForeground(
  luminances: Float64Array,
  columns: number,
  rows: number,
  previous?: PlayerForeground,
): PlayerForeground {
  const sorted = Array.from(luminances).filter(Number.isFinite).sort((first, second) => first - second);
  if (sorted.length < 2) return previous ?? 'light';
  // The upper decile detects bright areas even when most of the lyric region
  // is dark. Do not let a single brightest sample decide a small region.
  const percentileIndex = Math.max(0, Math.min(sorted.length - 2, Math.ceil(sorted.length * 0.9) - 1));
  let brightness = sorted[percentileIndex];
  // A contiguous bright patch can occupy less than the upper decile. Sliding
  // 3 x 3 blocks detect it, while trimming their brightest point rejects an
  // isolated highlight. This stays bounded by the 12 x 12 sampling grid.
  for (let row = 0; row <= rows - 3; row += 1) {
    for (let column = 0; column <= columns - 3; column += 1) {
      let sum = 0;
      let brightest = 0;
      let count = 0;
      for (let blockY = 0; blockY < 3; blockY += 1) {
        for (let blockX = 0; blockX < 3; blockX += 1) {
          const luminance = luminances[(row + blockY) * columns + column + blockX];
          if (!Number.isFinite(luminance)) continue;
          sum += luminance;
          brightest = Math.max(brightest, luminance);
          count += 1;
        }
      }
      if (count >= 6) brightness = Math.max(brightness, (sum - brightest) / (count - 1));
    }
  }
  // The neutral threshold is near the crossover of dark/white contrast.
  // Separate entry/exit thresholds keep the whole lyric column stable when
  // brightness changes slightly during a cover or layout transition.
  const threshold = previous === 'light' ? ENTER_DARK_THRESHOLD
    : previous === 'dark' ? EXIT_DARK_THRESHOLD : BRIGHT_REGION_THRESHOLD;
  return brightness >= threshold ? 'dark' : 'light';
}

function weightedPercentile(values: { value: number; weight: number }[], percentile: number): number {
  values.sort((first, second) => first.value - second.value);
  const target = values.reduce((sum, sample) => sum + sample.weight, 0) * percentile;
  let weight = 0;
  for (const sample of values) {
    weight += sample.weight;
    if (weight >= target) return sample.value;
  }
  return values[values.length - 1]?.value ?? 0;
}

function chooseChromeForeground(samples: RegionLuminances, previous?: PlayerForeground): PlayerForeground {
  const lightContrasts: { value: number; weight: number }[] = [];
  const darkContrasts: { value: number; weight: number }[] = [];
  for (let index = 0; index < samples.luminances.length; index += 1) {
    const luminance = samples.luminances[index];
    if (!Number.isFinite(luminance)) continue;
    const weight = samples.weights[index];
    lightContrasts.push({ value: 1.05 / (luminance + 0.05), weight });
    darkContrasts.push({
      value: (Math.max(luminance, DARK_LUMINANCE) + 0.05) / (Math.min(luminance, DARK_LUMINANCE) + 0.05),
      weight,
    });
  }
  if (lightContrasts.length === 0) return previous ?? 'light';
  const lightScore = weightedPercentile(lightContrasts, 0.2);
  const darkScore = weightedPercentile(darkContrasts, 0.2);
  const preferred = darkScore > lightScore ? 'dark' : 'light';
  if (previous && preferred !== previous) {
    const previousScore = previous === 'light' ? lightScore : darkScore;
    const preferredScore = preferred === 'light' ? lightScore : darkScore;
    if (preferredScore < previousScore * CHROME_SWITCH_MARGIN) return previous;
  }
  return preferred;
}

function centerWeight(x: number, y: number): number {
  const horizontal = Math.max(0, 1 - Math.abs(x - 0.5) * 2);
  const vertical = Math.max(0, 1 - Math.abs(y - 0.5) * 2);
  return 1 + 2 * horizontal * vertical;
}

function loadImage(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    let finished = false;
    const finish = (loaded: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (!loaded) image.src = '';
      resolve(loaded ? image : null);
    };
    const timer = setTimeout(() => finish(false), IMAGE_TIMEOUT_MS);
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.src = source;
  });
}

/**
 * Render the cover once into a small canvas and keep its complete pixel buffer.
 * Lyric-region foreground selection reuses these pixels without another readback.
 * Callers own stale-request protection and caching across cover/layout changes.
 */
export async function samplePlayerCoverBackground(
  coverSrc: string,
  viewport: { width: number; height: number },
  largeViewport: boolean,
): Promise<PlayerBackgroundSample | null> {
  if (
    !coverSrc || typeof Image === 'undefined' || typeof document === 'undefined'
    || ![viewport.width, viewport.height].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0
  ) return null;
  const dimensions = { width: viewport.width, height: viewport.height };

  const image = await loadImage(coverSrc).catch(() => null);
  if (!image) return null;
  let canvas: HTMLCanvasElement | null = null;
  let coverCanvas: HTMLCanvasElement | null = null;
  try {
    const scale = Math.min(1, SAMPLE_EDGE / Math.max(dimensions.width, dimensions.height));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(dimensions.width * scale));
    canvas.height = Math.max(1, Math.round(dimensions.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || typeof context.filter !== 'string') return null;
    const scaleX = canvas.width / dimensions.width;
    const scaleY = canvas.height / dimensions.height;
    context.fillStyle = '#0b1222';
    context.fillRect(0, 0, canvas.width, canvas.height);
    // CSS transforms scale the already filtered element, including its blur.
    const blur = (largeViewport ? 40 : 52) * 1.1 * Math.max(scaleX, scaleY);
    context.filter = largeViewport
      ? `blur(${blur}px) brightness(0.78) saturate(1.42) contrast(1.16)`
      : `blur(${blur}px) brightness(0.72) saturate(1.36) contrast(1.14)`;
    if (context.filter === 'none') return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    // First crop into the image element's viewport-sized box. Filtering and
    // scaling an uncropped natural image would include different edge colors.
    coverCanvas = document.createElement('canvas');
    coverCanvas.width = canvas.width;
    coverCanvas.height = canvas.height;
    const coverContext = coverCanvas.getContext('2d');
    if (!coverContext) return null;
    coverContext.imageSmoothingEnabled = true;
    coverContext.imageSmoothingQuality = 'high';
    const coverScale = Math.max(dimensions.width / image.naturalWidth, dimensions.height / image.naturalHeight);
    const drawWidth = image.naturalWidth * coverScale;
    const drawHeight = image.naturalHeight * coverScale;
    coverContext.drawImage(
      image,
      (dimensions.width - drawWidth) * scaleX / 2,
      (dimensions.height - drawHeight) * scaleY / 2,
      drawWidth * scaleX,
      drawHeight * scaleY,
    );
    context.drawImage(coverCanvas, -canvas.width * 0.05, -canvas.height * 0.05, canvas.width * 1.1, canvas.height * 1.1);

    // These are the existing full-background vignettes, not a new text backing.
    // They matter when selecting dark text near the bottom of a midtone cover.
    context.filter = 'none';
    const horizontalVignette = context.createLinearGradient(0, 0, canvas.width, 0);
    horizontalVignette.addColorStop(0, 'rgba(0, 0, 0, 0.06)');
    horizontalVignette.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
    horizontalVignette.addColorStop(1, 'rgba(0, 0, 0, 0.06)');
    context.fillStyle = horizontalVignette;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const verticalVignette = context.createLinearGradient(0, 0, 0, canvas.height);
    verticalVignette.addColorStop(0, 'rgba(0, 0, 0, 0.03)');
    verticalVignette.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
    verticalVignette.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
    context.fillStyle = verticalVignette;
    context.fillRect(0, 0, canvas.width, canvas.height);

    return {
      width: canvas.width,
      height: canvas.height,
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
      viewport: dimensions,
    };
  } catch {
    return null;
  } finally {
    image.src = '';
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    if (coverCanvas) {
      coverCanvas.width = 0;
      coverCanvas.height = 0;
    }
  }
}

function sampleRegionLuminances(
  sample: PlayerBackgroundSample,
  region: BackgroundRegion,
): RegionLuminances | null {
  const { width, height, pixels, viewport } = sample;
  if (
    !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || width > SAMPLE_EDGE || height > SAMPLE_EDGE || pixels.length < width * height * 4
    || ![viewport.width, viewport.height, region.x, region.y, region.width, region.height].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0 || region.width <= 0 || region.height <= 0
  ) return null;
  const left = clamp(region.x, 0, viewport.width);
  const top = clamp(region.y, 0, viewport.height);
  const right = clamp(region.x + region.width, 0, viewport.width);
  const bottom = clamp(region.y + region.height, 0, viewport.height);
  if (right <= left || bottom <= top) return null;
  const scaleX = width / viewport.width;
  const scaleY = height / viewport.height;
  const firstX = Math.floor(left * scaleX);
  const firstY = Math.floor(top * scaleY);
  const lastX = Math.min(width, Math.ceil(right * scaleX));
  const lastY = Math.min(height, Math.ceil(bottom * scaleY));
  const columns = Math.min(REGION_SAMPLE_EDGE, lastX - firstX);
  const rows = Math.min(REGION_SAMPLE_EDGE, lastY - firstY);
  const luminances = new Float64Array(columns * rows).fill(Number.NaN);
  const weights = new Float64Array(columns * rows);
  // Cover/layout changes reuse the buffer; cap each decision at 12 x 12 reads.
  for (let row = 0; row < rows; row += 1) {
    const y = firstY + Math.floor((row + 0.5) * (lastY - firstY) / rows);
    for (let column = 0; column < columns; column += 1) {
      const x = firstX + Math.floor((column + 0.5) * (lastX - firstX) / columns);
      const offset = (y * width + x) * 4;
      // The sampler paints an opaque base. Invalid external buffers should
      // retain the previous choice instead of interpreting transparent RGB.
      if (pixels[offset + 3] < 160) continue;
      luminances[row * columns + column] = LINEAR_CHANNELS[pixels[offset]] * 0.2126
        + LINEAR_CHANNELS[pixels[offset + 1]] * 0.7152
        + LINEAR_CHANNELS[pixels[offset + 2]] * 0.0722;
      weights[row * columns + column] = centerWeight(
        clamp(((x + 0.5) / scaleX - left) / (right - left)),
        clamp(((y + 0.5) / scaleY - top) / (bottom - top)),
      );
    }
  }
  return { luminances, weights, columns, rows };
}

/** Choose one uniform foreground for the entire supplied lyric region. */
export function selectPlayerForeground(
  sample: PlayerBackgroundSample,
  region: BackgroundRegion,
  previous?: PlayerForeground,
): PlayerForeground {
  const samples = sampleRegionLuminances(sample, region);
  return samples
    ? chooseLyricForeground(samples.luminances, samples.columns, samples.rows, previous)
    : previous ?? 'light';
}

/** Keep title/control selection based on overall contrast, independently of lyrics. */
export function selectPlayerChromeForeground(
  sample: PlayerBackgroundSample,
  previous?: PlayerForeground,
): PlayerForeground {
  const samples = sampleRegionLuminances(sample, {
    x: 0,
    y: 0,
    width: sample.viewport.width,
    height: sample.viewport.height,
  });
  return samples ? chooseChromeForeground(samples, previous) : previous ?? 'light';
}
