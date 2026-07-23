import { tauriInvoke } from '../services/tauri/invoke';
import type { PreparedCustomBackgroundImage } from '../services/tauri/contracts';

export type CustomBackgroundMediaType = 'image' | 'video';

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm']);
export const CUSTOM_BACKGROUND_VIDEO_MAX_PIXELS = 3840 * 2160;
export const CUSTOM_BACKGROUND_VIDEO_MAX_EDGE = 3840;

export interface CustomBackgroundRenderTarget {
  width: number;
  height: number;
  devicePixelRatio: number;
}

const CUSTOM_BACKGROUND_DOWNSCALE_BLUR_THRESHOLD = 4;

export function optimizeCustomBackgroundRenderTarget(
  target: CustomBackgroundRenderTarget,
  blurCssPixels: number,
): CustomBackgroundRenderTarget {
  if (blurCssPixels < CUSTOM_BACKGROUND_DOWNSCALE_BLUR_THRESHOLD || target.devicePixelRatio <= 1) {
    return target;
  }

  const quantize = (value: number) => Math.max(256, Math.ceil(value / 64) * 64);
  return {
    width: quantize(target.width / target.devicePixelRatio),
    height: quantize(target.height / target.devicePixelRatio),
    devicePixelRatio: 1,
  };
}

export function getCustomBackgroundRenderTarget(): CustomBackgroundRenderTarget {
  const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const quantize = (value: number) => Math.max(256, Math.ceil(value / 64) * 64);
  return {
    width: quantize(window.screen.width * devicePixelRatio),
    height: quantize(window.screen.height * devicePixelRatio),
    devicePixelRatio,
  };
}

export function prepareCustomBackgroundImage(
  path: string,
  options: { target?: CustomBackgroundRenderTarget; blurCssPixels?: number } = {},
): Promise<PreparedCustomBackgroundImage> {
  const blurCssPixels = Math.max(0, options.blurCssPixels ?? 0);
  const target = optimizeCustomBackgroundRenderTarget(
    options.target ?? getCustomBackgroundRenderTarget(),
    blurCssPixels,
  );
  return tauriInvoke('prepare_custom_background_image', {
    sourcePath: path,
    targetWidth: target.width,
    targetHeight: target.height,
    blurRadius: blurCssPixels * target.devicePixelRatio,
  });
}

export function isCustomBackgroundVideoWithinLimit(width: number, height: number) {
  return width > 0
    && height > 0
    && Math.max(width, height) <= CUSTOM_BACKGROUND_VIDEO_MAX_EDGE
    && width * height <= CUSTOM_BACKGROUND_VIDEO_MAX_PIXELS;
}

export function resolveCustomBackgroundMediaType(
  path: string,
  mediaType?: CustomBackgroundMediaType,
): CustomBackgroundMediaType {
  if (mediaType === 'video' || mediaType === 'image') {
    return mediaType;
  }

  const extension = path.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTENSIONS.has(extension) ? 'video' : 'image';
}

export interface CustomBackgroundMediaMetadata {
  width: number;
  height: number;
}

export function loadCustomBackgroundMediaMetadata(
  src: string,
  mediaType: CustomBackgroundMediaType,
): Promise<CustomBackgroundMediaMetadata> {
  if (mediaType === 'image') {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('无法加载所选图片'));
      image.src = src;
    });
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      cleanup();
      if (isCustomBackgroundVideoWithinLimit(width, height)) {
        resolve({ width, height });
      } else if (width > 0 && height > 0) {
        reject(new Error('视频分辨率超过 4K，请选择不高于 3840×2160 的视频'));
      } else {
        reject(new Error('无法读取视频画面尺寸'));
      }
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('视频无法解码，请选择 H.264 MP4 或 VP8/VP9 WebM 文件'));
    };
    video.src = src;
    video.load();
  });
}
