export type CustomBackgroundMediaType = 'image' | 'video';

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm']);

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
      video.oncanplay = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };

    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.oncanplay = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      cleanup();
      if (width > 0 && height > 0) {
        resolve({ width, height });
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
