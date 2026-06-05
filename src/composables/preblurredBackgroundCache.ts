interface PreblurOptions {
  blur: number;
  brightness: number;
}

const CACHE_LIMIT = 3;
const CACHE_TTL_MS = 3 * 60 * 1000;
const MAX_CANVAS_SIZE = 512;
const MIN_CANVAS_SIZE = 384;

type CacheEntry = {
  url: string;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

function buildCacheKey(src: string, options: PreblurOptions) {
  return JSON.stringify({
    src,
    blur: Math.round(options.blur),
    brightness: Math.round(options.brightness * 100) / 100,
    max: MAX_CANVAS_SIZE,
  });
}

function revokeEntry(entry: CacheEntry | undefined) {
  if (entry) {
    URL.revokeObjectURL(entry.url);
  }
}

function pruneCache() {
  const now = Date.now();

  for (const [key, entry] of cache) {
    if (entry.expiresAt > now) {
      continue;
    }

    revokeEntry(entry);
    cache.delete(key);
  }

  while (cache.size > CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }

    revokeEntry(cache.get(oldestKey));
    cache.delete(oldestKey);
  }
}

function getCachedUrl(key: string) {
  pruneCache();

  const entry = cache.get(key);
  if (!entry) {
    return '';
  }

  cache.delete(key);
  cache.set(key, {
    url: entry.url,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return entry.url;
}

function setCachedUrl(key: string, url: string) {
  revokeEntry(cache.get(key));
  cache.delete(key);
  cache.set(key, {
    url,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  pruneCache();
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load background image'));
    image.crossOrigin = 'Anonymous';
    image.decoding = 'async';
    image.src = src;
  });
}

function getCanvasSize(image: HTMLImageElement) {
  const largestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
  if (largestSide <= 0) {
    return MIN_CANVAS_SIZE;
  }

  return Math.round(Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, largestSide)));
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Failed to encode preblurred background'));
      },
      'image/webp',
      0.82,
    );
  });
}

async function createPreblurredUrl(src: string, options: PreblurOptions) {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  const size = getCanvasSize(image);
  const context = canvas.getContext('2d');

  if (!context) {
    return src;
  }

  canvas.width = size;
  canvas.height = size;

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const sourceSize = Math.min(sourceWidth, sourceHeight);
  const sourceX = Math.max(0, (sourceWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (sourceHeight - sourceSize) / 2);
  const blurAtCanvasScale = Math.max(8, Math.round(options.blur * (size / MAX_CANVAS_SIZE)));

  context.filter = `blur(${blurAtCanvasScale}px) brightness(${options.brightness})`;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    size,
    size,
  );

  const blob = await canvasToBlob(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return URL.createObjectURL(blob);
}

export async function getPreblurredBackgroundUrl(src: string, options: PreblurOptions) {
  if (!src || typeof document === 'undefined') {
    return src;
  }

  const key = buildCacheKey(src, options);
  const cached = getCachedUrl(key);
  if (cached) {
    return cached;
  }

  const existingRequest = inFlight.get(key);
  if (existingRequest) {
    return existingRequest;
  }

  const request = createPreblurredUrl(src, options)
    .then(url => {
      if (url !== src) {
        setCachedUrl(key, url);
      }
      return url;
    })
    .catch(() => src)
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export function clearPreblurredBackgroundCache() {
  for (const entry of cache.values()) {
    revokeEntry(entry);
  }

  cache.clear();
}
